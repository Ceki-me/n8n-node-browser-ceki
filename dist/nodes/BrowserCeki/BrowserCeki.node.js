"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// nodes/BrowserCeki/BrowserCeki.node.ts
var BrowserCeki_node_exports = {};
__export(BrowserCeki_node_exports, {
  BrowserCeki: () => BrowserCeki
});
module.exports = __toCommonJS(BrowserCeki_node_exports);

// lib/ceki-client.ts
function jsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var CekiClient = class {
  constructor(_token, _relayUrl = "wss://browser.ceki.me/ws/agent", _apiUrl = "https://api.ceki.me") {
    this._token = _token;
    this._relayUrl = _relayUrl;
    this._apiUrl = _apiUrl;
    this._ws = null;
    this._connected = false;
    this._pendingRents = /* @__PURE__ */ new Map();
    this._pendingResumes = /* @__PURE__ */ new Map();
    this._pendingCdp = /* @__PURE__ */ new Map();
    this._cdpCounter = 1;
    this._activeSessions = /* @__PURE__ */ new Map();
    this._connectReject = null;
    this._closed = false;
  }
  /** Connect to the relay WebSocket. */
  async connect() {
    if (this._connected) return;
    const protocols = [`bearer.${this._token}`];
    this._ws = new WebSocket(this._relayUrl, protocols);
    this._ws.onopen = () => {
      this._connected = true;
    };
    this._ws.onmessage = (ev) => {
      this._handleMessage(ev.data);
    };
    this._ws.onclose = (ev) => {
      this._connected = false;
      if ((ev.code === 4401 || ev.code === 4403) && this._connectReject) {
        this._connectReject(new Error(`Auth failed: ${ev.reason || String(ev.code)}`));
        this._connectReject = null;
      }
    };
    this._ws.onerror = () => {
      if (!this._connected && this._connectReject) {
        this._connectReject(new Error("WebSocket connection failed"));
        this._connectReject = null;
      }
    };
    if (this._ws.readyState === WebSocket.CONNECTING) {
      await new Promise((resolve, reject) => {
        if (!this._ws) {
          reject(new Error("No WebSocket"));
          return;
        }
        this._connectReject = reject;
        this._ws.onopen = () => {
          this._connected = true;
          resolve();
        };
      });
    }
  }
  _sendRaw(msg) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this._ws.send(JSON.stringify(msg));
  }
  /** Search for available browser providers (HTTP GET). */
  async search(filters, limit) {
    const params = new URLSearchParams();
    if (limit != null) params.set("limit", String(limit));
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v != null) params.set(k, String(v));
      }
    }
    const resp = await fetch(`${this._apiUrl}/api/browsers/search?${params}`, {
      headers: { Authorization: `Bearer ${this._token}` }
    });
    if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
    const body = await resp.json();
    const data = body.data ?? body;
    return Array.isArray(data) ? data : [];
  }
  /** Rent a browser by schedule_id. */
  async rent(scheduleId, opts) {
    const msg = { type: "rent", browser_id: scheduleId };
    if (opts?.mode) msg.mode = opts.mode;
    this._sendRaw(msg);
    return this._awaitRent(`rent:${scheduleId}`, scheduleId, 9e4);
  }
  /** Resume an existing session. */
  async resume(sessionId) {
    this._sendRaw({ type: "resume", session_id: sessionId });
    return this._awaitResume(sessionId);
  }
  /** Close the WS connection — session stays alive in grace. */
  disconnect() {
    this._closed = true;
    this._activeSessions.clear();
    this._pendingRents.clear();
    this._pendingResumes.clear();
    this._closeWs();
  }
  /** Close everything. */
  close() {
    this.disconnect();
  }
  // ── private ────────────────────────────────────────────────
  _awaitRent(key, scheduleId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      timeoutSignal.addEventListener("abort", () => {
        this._pendingRents.delete(key);
        reject(new Error("Rent timed out"));
      }, { once: true });
      this._pendingRents.set(key, {
        resolve: (match) => {
          const browser = new CekiBrowser(this, match);
          this._activeSessions.set(browser.sessionId, browser);
          resolve(browser);
        },
        reject: (err) => {
          reject(err);
        }
      });
    });
  }
  _awaitResume(sessionId) {
    return new Promise((resolve, reject) => {
      const timeoutSignal = AbortSignal.timeout(1e4);
      timeoutSignal.addEventListener("abort", () => {
        this._pendingResumes.delete(sessionId);
        reject(new Error("Resume timed out"));
      }, { once: true });
      this._pendingResumes.set(sessionId, {
        resolve: (match) => {
          const browser = new CekiBrowser(this, match);
          this._activeSessions.set(browser.sessionId, browser);
          resolve(browser);
        },
        reject: (err) => {
          reject(err);
        }
      });
    });
  }
  _closeWs() {
    if (this._ws) {
      try {
        this._ws.onopen = null;
        this._ws.onmessage = null;
        this._ws.onclose = null;
        this._ws.onerror = null;
        this._ws.close();
      } catch {
      }
      this._ws = null;
    }
  }
  _handleMessage(data) {
    const msg = jsonParse(String(data));
    if (!msg || typeof msg !== "object") return;
    const type = String(msg.type ?? "");
    const sid = msg.session_id ? String(msg.session_id) : null;
    switch (type) {
      case "pong":
      case "rent_pending":
        break;
      case "match":
        this._onMatch(msg);
        break;
      case "rent.error":
        this._onRentError(msg);
        break;
      case "resume_ok":
        this._onResumeOk(msg);
        break;
      case "resume_failed":
        this._onResumeFailed(msg);
        break;
      case "cdp_response":
        if (sid) this._onCdpResponse(sid, msg);
        break;
      case "session.ended":
        if (sid) {
          this._activeSessions.delete(sid);
          const b = this._activeSessions.get(sid);
          if (b) b._ended = String(msg.reason ?? "ended");
        }
        break;
    }
  }
  _onMatch(msg) {
    const scheduleId = Number(msg.schedule_id ?? 0);
    const eventId = msg.event_id ? String(msg.event_id) : null;
    let pending = this._pendingRents.get(`event:${eventId}`);
    if (!pending) pending = this._pendingRents.get(`rent:${scheduleId}`);
    if (pending) {
      this._pendingRents.delete(`event:${eventId}`);
      this._pendingRents.delete(`rent:${scheduleId}`);
      pending.resolve({
        session_id: String(msg.session_id ?? ""),
        schedule_id: scheduleId,
        event_id: eventId,
        chat_topic_id: msg.chat_topic_id ? String(msg.chat_topic_id) : null,
        provider_user_id: msg.provider_user_id != null ? Number(msg.provider_user_id) : null,
        browser_info: msg.browser_info ?? {}
      });
    }
  }
  _onRentError(msg) {
    const code = String(msg.code ?? "");
    const message = String(msg.message ?? "");
    for (const [key, pending] of this._pendingRents) {
      this._pendingRents.delete(key);
      pending.reject(new Error(message || `Rent error: ${code}`));
      return;
    }
  }
  _onResumeOk(msg) {
    const sessionId = String(msg.session_id ?? "");
    const pending = this._pendingResumes.get(sessionId);
    if (!pending) return;
    this._pendingResumes.delete(sessionId);
    pending.resolve({
      session_id: sessionId,
      schedule_id: Number(msg.schedule_id ?? 0),
      event_id: msg.event_id ? String(msg.event_id) : null,
      chat_topic_id: msg.chat_topic_id ? String(msg.chat_topic_id) : null,
      provider_user_id: msg.provider_user_id != null ? Number(msg.provider_user_id) : null,
      browser_info: msg.browser_info ?? {}
    });
  }
  _onResumeFailed(msg) {
    const sessionId = String(msg.session_id ?? "");
    const pending = this._pendingResumes.get(sessionId);
    if (!pending) return;
    this._pendingResumes.delete(sessionId);
    pending.reject(new Error(String(msg.reason ?? "Resume failed")));
  }
  _onCdpResponse(sessionId, msg) {
    const browser = this._activeSessions.get(sessionId);
    if (!browser) return;
    const id = Number(msg.id ?? 0);
    const pending = this._pendingCdp.get(id);
    if (!pending) return;
    this._pendingCdp.delete(id);
    if (msg.error) {
      pending.reject(new Error(String(msg.error.message ?? "CDP error")));
    } else {
      pending.resolve(msg.result);
    }
  }
};
var CekiBrowser = class {
  constructor(client, match) {
    this._cdpId = 1;
    this._pendingCdp = /* @__PURE__ */ new Map();
    this._client = client;
    this.sessionId = match.session_id;
    this.scheduleId = match.schedule_id;
    this.chatTopicId = match.chat_topic_id ?? null;
    this.browserInfo = match.browser_info ?? {};
    this.providerUserId = match.provider_user_id ?? null;
  }
  /** Send a CDP command. Uses AbortSignal.timeout() (no restricted setTimeout global). */
  async send(method, params, timeoutMs = 3e4) {
    const id = this._cdpId++;
    const msg = { type: "cdp", session_id: this.sessionId, id, method, params: params ?? {} };
    this._client._sendRaw(msg);
    return new Promise((resolve, reject) => {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      timeoutSignal.addEventListener("abort", () => {
        this._pendingCdp.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, { once: true });
      this._pendingCdp.set(id, {
        resolve: (v) => {
          resolve(v);
        },
        reject: (e) => {
          reject(e);
        }
      });
    });
  }
  async navigate(url, timeoutMs) {
    await this.send("Page.navigate", { url }, timeoutMs);
  }
  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  async type(text) {
    await this.send("Ceki.typeText", { text });
  }
  async scroll(deltaY) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY });
  }
  async screenshot(opts) {
    const format = opts?.format ?? "base64";
    const fullPage = opts?.fullPage ?? false;
    let clip;
    if (fullPage) {
      const metrics = await this.send("Page.getLayoutMetrics");
      const contentSize = metrics?.contentSize;
      if (contentSize) {
        clip = { x: 0, y: 0, width: Number(contentSize.width ?? 1920), height: Math.min(Number(contentSize.height ?? 1080), 16384), scale: 1 };
      }
    }
    const result = await this.send("Page.captureScreenshot", { format: "png", ...clip ? { clip } : {} });
    const data = String(result?.data ?? "");
    if (format === "png") {
      return Buffer.from(data, "base64");
    }
    return { data };
  }
  async snapshot() {
    const ssResult = await this.screenshot({ format: "base64" });
    return { screenshot: ssResult.data, ts: /* @__PURE__ */ new Date() };
  }
  async upload(selector, buf, filename = "file") {
    const b64 = buf.toString("base64");
    const size = buf.length;
    const mime = "application/octet-stream";
    const expression = `(function(){
			var input = document.querySelector(${JSON.stringify(selector)});
			if (!input) return JSON.stringify({ok:false,error:'Element not found'});
			var b = atob(${JSON.stringify(b64)});
			var u = new Uint8Array(b.length);
			for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
			var f = new File([u], ${JSON.stringify(filename)}, {type: ${JSON.stringify(mime)}});
			var dt = new DataTransfer(); dt.items.add(f);
			input.files = dt.files;
			input.dispatchEvent(new Event('change',{bubbles:true}));
			return JSON.stringify({ok:true,filename:${JSON.stringify(filename)},size:${size}});
		})()`;
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true });
    try {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    } catch {
    }
    const resultObj = result?.result;
    if (resultObj?.value) return JSON.parse(String(resultObj.value));
    return { ok: true, filename, size };
  }
  async close() {
    await this.send("Ceki.close", {}).catch(() => {
    });
    this._client._activeSessions.delete(this.sessionId);
  }
};

// nodes/BrowserCeki/BrowserCeki.node.ts
var sleep = (ms) => new Promise((resolve) => {
  AbortSignal.timeout(ms).addEventListener("abort", () => resolve(), { once: true });
});
var BrowserCeki = class {
  constructor() {
    this.description = {
      displayName: "Browser Ceki",
      name: "browserCeki",
      icon: "file:ceki.png",
      group: ["transform"],
      version: 1,
      subtitle: '={{ "Ceki: " + $operation }}',
      description: "Rent a real human browser and control it: rent, navigate, click, type, screenshot, solve captchas, and more",
      defaults: { name: "Browser Ceki" },
      inputs: ["main"],
      outputs: ["main"],
      credentials: [{ name: "cekiApi", required: true }],
      properties: [
        {
          displayName: "Operation",
          name: "operation",
          type: "options",
          default: "rent",
          options: [
            { name: "Rent", value: "rent" },
            { name: "Navigate", value: "navigate" },
            { name: "Click", value: "click" },
            { name: "Type", value: "type" },
            { name: "Scroll", value: "scroll" },
            { name: "Screenshot", value: "screenshot" },
            { name: "Snapshot", value: "snapshot" },
            { name: "Wait", value: "wait" },
            { name: "Wait for Selector", value: "waitForSelector" },
            { name: "Upload", value: "upload" },
            { name: "Close", value: "close" }
          ]
        },
        // === Rent: rental parameters ===
        {
          displayName: "Schedule ID",
          name: "scheduleId",
          type: "number",
          default: 0,
          description: "0 \u2014 search by the filters below",
          displayOptions: { show: { operation: ["rent"] } }
        },
        {
          displayName: "Geo",
          name: "geo",
          type: "string",
          default: "",
          placeholder: "RU, EE, US\u2026",
          displayOptions: { show: { operation: ["rent"] } }
        },
        {
          displayName: "Max $/min",
          name: "maxPrice",
          type: "number",
          typeOptions: { numberPrecision: 4 },
          default: 0.02,
          displayOptions: { show: { operation: ["rent"] } }
        },
        {
          displayName: "Min rating",
          name: "minRating",
          type: "number",
          default: 0,
          displayOptions: { show: { operation: ["rent"] } }
        },
        {
          displayName: "Profile mode",
          name: "mode",
          type: "options",
          default: "main",
          options: [
            { name: "main", value: "main" },
            { name: "incognito", value: "incognito" }
          ],
          displayOptions: { show: { operation: ["rent"] } }
        },
        // === Operations: session_id ===
        {
          displayName: "Session ID",
          name: "sessionId",
          type: "string",
          default: "={{ $json.session_id }}",
          description: "From the Rent operation",
          required: true,
          displayOptions: {
            show: {
              operation: ["navigate", "click", "type", "scroll", "screenshot", "snapshot", "wait", "waitForSelector", "upload", "close"]
            }
          }
        },
        {
          displayName: "URL",
          name: "url",
          type: "string",
          default: "",
          required: true,
          displayOptions: { show: { operation: ["navigate"] } }
        },
        {
          displayName: "X",
          name: "x",
          type: "number",
          default: 0,
          displayOptions: { show: { operation: ["click"] } }
        },
        {
          displayName: "Y",
          name: "y",
          type: "number",
          default: 0,
          displayOptions: { show: { operation: ["click"] } }
        },
        {
          displayName: "Text",
          name: "text",
          type: "string",
          default: "",
          displayOptions: { show: { operation: ["type"] } }
        },
        {
          displayName: "Delta Y",
          name: "deltaY",
          type: "number",
          default: -300,
          displayOptions: { show: { operation: ["scroll"] } }
        },
        {
          displayName: "Format",
          name: "format",
          type: "options",
          default: "png",
          options: [
            { name: "PNG (binary)", value: "png" },
            { name: "Base64", value: "base64" }
          ],
          displayOptions: { show: { operation: ["screenshot"] } }
        },
        {
          displayName: "Full page",
          name: "fullPage",
          type: "boolean",
          default: false,
          displayOptions: { show: { operation: ["screenshot"] } }
        },
        {
          displayName: "Milliseconds",
          name: "ms",
          type: "number",
          default: 1e3,
          typeOptions: { minValue: 0 },
          description: "Fixed delay on the active session",
          displayOptions: { show: { operation: ["wait"] } }
        },
        {
          displayName: "CSS Selector",
          name: "waitSelector",
          type: "string",
          default: "",
          required: true,
          placeholder: "e.g. .results, #content, table tr",
          displayOptions: { show: { operation: ["waitForSelector"] } }
        },
        {
          displayName: "Timeout (ms)",
          name: "waitTimeout",
          type: "number",
          default: 3e4,
          description: "Waits until the selector appears in the DOM",
          displayOptions: { show: { operation: ["waitForSelector"] } }
        },
        {
          displayName: "CSS Selector",
          name: "selector",
          type: "string",
          default: "",
          required: true,
          displayOptions: { show: { operation: ["upload"] } }
        },
        {
          displayName: "Binary Property",
          name: "binaryPropertyName",
          type: "string",
          default: "data",
          displayOptions: { show: { operation: ["upload"] } }
        }
      ]
    };
  }
  async execute() {
    const items = this.getInputData();
    const out = [];
    const creds = await this.getCredentials("cekiApi");
    const token = creds.token;
    const resolveSid = async (i, client) => {
      const scheduleId = this.getNodeParameter("scheduleId", i);
      if (scheduleId) return scheduleId;
      const geo = this.getNodeParameter("geo", i);
      const maxPrice = this.getNodeParameter("maxPrice", i);
      const list = await client.search({
        geo: geo || void 0,
        max_price_per_min: maxPrice
      });
      if (!list.length) throw new Error("No browsers found by filters");
      return list[0].schedule_id;
    };
    for (let i = 0; i < items.length; i++) {
      const op = this.getNodeParameter("operation", i);
      const client = new CekiClient(token);
      await client.connect();
      let browser;
      try {
        if (op === "rent") {
          const sid2 = await resolveSid(i, client);
          const mode = this.getNodeParameter("mode", i);
          browser = await client.rent(sid2, { mode });
          out.push({
            json: { session_id: browser.sessionId, schedule_id: sid2, mode }
          });
          await client.disconnect();
          continue;
        }
        const sessionId = this.getNodeParameter("sessionId", i);
        browser = await client.resume(sessionId);
        const sid = browser.sessionId;
        switch (op) {
          case "navigate": {
            const url = this.getNodeParameter("url", i);
            await browser.navigate(url);
            out.push({ json: { session_id: sid, url } });
            break;
          }
          case "click": {
            const x = this.getNodeParameter("x", i);
            const y = this.getNodeParameter("y", i);
            await browser.click(x, y);
            out.push({ json: { session_id: sid, clicked: [x, y] } });
            break;
          }
          case "type": {
            const text = this.getNodeParameter("text", i);
            await browser.type(text);
            out.push({ json: { session_id: sid, typed: text } });
            break;
          }
          case "scroll": {
            const deltaY = this.getNodeParameter("deltaY", i);
            await browser.scroll(deltaY);
            out.push({ json: { session_id: sid, scrolled: deltaY } });
            break;
          }
          case "screenshot": {
            const format = this.getNodeParameter("format", i);
            const fullPage = this.getNodeParameter("fullPage", i);
            const shot = await browser.screenshot({ format, fullPage });
            const data = format === "base64" ? shot.data : shot.toString("base64");
            const binary = await this.helpers.prepareBinaryData(
              Buffer.from(data, "base64"),
              "screenshot.png",
              "image/png"
            );
            out.push({ json: { session_id: sid }, binary: { data: binary } });
            break;
          }
          case "snapshot": {
            const snap = await browser.snapshot();
            out.push({
              json: { session_id: sid, screenshot: snap.screenshot }
            });
            break;
          }
          case "wait": {
            const ms = this.getNodeParameter("ms", i);
            await sleep(ms);
            out.push({ json: { session_id: sid, waited: ms } });
            break;
          }
          case "waitForSelector": {
            const selector = this.getNodeParameter("waitSelector", i);
            const timeout = this.getNodeParameter("waitTimeout", i);
            const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
            const deadline = Date.now() + timeout;
            let ok = false;
            let lastErr = null;
            while (Date.now() < deadline) {
              try {
                const res = await browser.send("Runtime.evaluate", { expression: expr, returnByValue: true });
                if (res?.result?.value === true) {
                  ok = true;
                  break;
                }
              } catch (e) {
                lastErr = e;
              }
              await sleep(500);
            }
            if (!ok) {
              throw new Error(
                `waitForSelector("${selector}") timed out after ${timeout}ms${lastErr ? `: ${lastErr.message}` : ""}`
              );
            }
            out.push({ json: { session_id: sid, selector, found: true } });
            break;
          }
          case "upload": {
            const selector = this.getNodeParameter("selector", i);
            const bpn = this.getNodeParameter("binaryPropertyName", i);
            const bin = items[i].binary?.[bpn];
            if (!bin) throw new Error(`Binary property "${bpn}" not found on input`);
            const stream = await this.helpers.getBinaryStream(bin.id);
            const chunks = [];
            for await (const c of stream) chunks.push(c);
            const buf = Buffer.concat(chunks);
            const res = await browser.upload(selector, buf);
            out.push({ json: { session_id: sid, uploaded: res } });
            break;
          }
          case "close": {
            await browser.close();
            out.push({ json: { closed: true, session_id: sessionId } });
            break;
          }
        }
        if (op === "close") {
          await client.close();
        } else {
          await client.disconnect();
        }
      } finally {
      }
    }
    return [out];
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BrowserCeki
});
//# sourceMappingURL=BrowserCeki.node.js.map
