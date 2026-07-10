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

// nodes/CekiContract/CekiContract.node.ts
var CekiContract_node_exports = {};
__export(CekiContract_node_exports, {
  CekiContract: () => CekiContract
});
module.exports = __toCommonJS(CekiContract_node_exports);

// lib/contract-client.ts
function cleanArgs(o) {
  const out = { ...o };
  for (const k of Object.keys(out)) {
    if (out[k] === void 0 || out[k] === null) delete out[k];
  }
  return out;
}
function parseBenefitable(value) {
  if (!value) return null;
  const m = /^(agent|user):(\d+)$/.exec(value);
  if (!m) return null;
  return { type: m[1], value: Number(m[2]) };
}
function parseParticipant(value, roleId) {
  const b = parseBenefitable(value);
  if (!b) return null;
  return { participable_id: b.value, type: b.type, role_id: roleId };
}
function deriveLabel(desc) {
  if (!desc) return "";
  const line = desc.split("\n")[0].trim();
  return line.length > 60 ? line.slice(0, 57) + "..." : line;
}
var ROLE_REVIEWER = 5;
var ROLE_QA = 6;
var ContractClient = class {
  constructor(token, endpoint, apiBase) {
    this._endpoint = (endpoint ?? "https://api.ceki.me/mcp").replace(/\/+$/, "");
    this._apiBase = (apiBase ?? "https://api.ceki.me").replace(/\/+$/, "");
    this._token = token;
  }
  _headers() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this._token}`
    };
  }
  async _rpc(method, params) {
    const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
    const resp = await fetch(this._endpoint, {
      method: "POST",
      headers: this._headers(),
      body
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`);
    }
    return resp.json();
  }
  async _call(tool, args) {
    const body = await this._rpc("tools/call", { name: tool, arguments: args ?? {} });
    if (body.error) throw new Error(`${tool} \u2192 ${JSON.stringify(body.error).slice(0, 400)}`);
    const result = body.result ?? {};
    const content = result.content;
    if (Array.isArray(content)) {
      const texts = content.filter((c) => c.type === "text").map((c) => String(c.text ?? ""));
      const joined = texts.join("\n");
      try {
        return JSON.parse(joined);
      } catch {
        return joined;
      }
    }
    if (result.structuredContent !== void 0) return result.structuredContent;
    return result;
  }
  // ── domain methods ─────────────────────────────────────────
  async listContracts() {
    return this._call("list-contracts");
  }
  async members(contractId) {
    return this._call("contract-members", { contract_id: contractId });
  }
  async tasks(contractId) {
    return this._call("contract-tasks", { contract_id: contractId });
  }
  async myEvents() {
    return this._call("get-my-events");
  }
  async task(eventId) {
    return this._call("get-event", { event_id: eventId });
  }
  async create(contractId, opts) {
    const args = cleanArgs({
      contract_id: contractId,
      label: opts.label,
      type_id: opts.type,
      status_id: opts.status,
      description: opts.description,
      benefitable: opts.benefitable ? parseBenefitable(opts.benefitable) : void 0
    });
    const users = [];
    const rev = parseParticipant(opts.reviewer, ROLE_REVIEWER);
    if (rev) users.push(rev);
    const qa = parseParticipant(opts.qa, ROLE_QA);
    if (qa) users.push(qa);
    if (users.length) args.users = users;
    return this._call("create-contract-event", args);
  }
  async propose(eventId, opts) {
    return this._call("propose-correction", cleanArgs({
      event_id: eventId,
      status_id: opts.status,
      label: opts.label,
      description: opts.description,
      benefitable: opts.benefitable ? parseBenefitable(opts.benefitable) : void 0
    }));
  }
  async comment(eventId, opts) {
    return this._call("comment", cleanArgs({
      event_id: eventId,
      label: opts?.label,
      description: opts?.description
    }));
  }
  async progress(eventId, opts) {
    let statusResult = null;
    if (opts.status != null) {
      statusResult = await this.propose(eventId, { status: opts.status });
    }
    const commentResult = await this.comment(eventId, { label: deriveLabel(opts.desc), description: opts.desc });
    return { status_correction: statusResult, comment: commentResult };
  }
  async callHuman(eventId, kind, desc) {
    if (!["input", "review", "stuck"].includes(kind)) throw new Error(`kind must be input|review|stuck, got ${kind}`);
    return this._call("call-human", { event_id: eventId, kind, desc });
  }
  /** GET /agent/polling. Returns [] on 429. */
  async poll() {
    const resp = await fetch(`${this._apiBase}/agent/polling`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${this._token}` }
    });
    if (resp.status === 429) return [];
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`poll HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    const body = await resp.json();
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object") {
      for (const k of ["notifications", "data", "items"]) {
        if (Array.isArray(body[k])) return body[k];
      }
    }
    return [];
  }
};

// nodes/CekiContract/CekiContract.node.ts
var STATUS_OPTIONS = [
  { name: "100 \xB7 Backlog", value: 100 },
  { name: "200 \xB7 Hand (assigned)", value: 200 },
  { name: "222 \xB7 Hand done", value: 222 },
  { name: "300 \xB7 QA", value: 300 },
  { name: "350 \xB7 QA done", value: 350 },
  { name: "499 \xB7 Reviewer", value: 499 }
];
var CekiContract = class {
  constructor() {
    this.description = {
      displayName: "Ceki Contract",
      name: "cekiContract",
      icon: "file:ceki.png",
      group: ["transform"],
      version: 1,
      subtitle: '={{ "Contract: " + $operation }}',
      description: "Work with Ceki contract tasks: list, create, assign, update status, comment, report progress, escalate to a human, and poll",
      defaults: { name: "Ceki Contract" },
      inputs: ["main"],
      outputs: ["main"],
      credentials: [{ name: "cekiApi", required: true }],
      properties: [
        {
          displayName: "Operation",
          name: "operation",
          type: "options",
          default: "myEvents",
          options: [
            { name: "List My Contracts", value: "listContracts" },
            { name: "List Tasks in Contract", value: "listTasks" },
            { name: "Get Task", value: "getTask" },
            { name: "My Assigned Events", value: "myEvents" },
            { name: "Create Task", value: "createTask" },
            { name: "Assign Executor", value: "assign" },
            { name: "Update Status", value: "setStatus" },
            { name: "Comment", value: "comment" },
            { name: "Progress Report", value: "progress" },
            { name: "Call Human", value: "callHuman" },
            { name: "Poll Notifications", value: "poll" }
          ]
        },
        // --- contractId / eventId ---
        {
          displayName: "Contract ID",
          name: "contractId",
          type: "number",
          default: 0,
          description: "ceki contract id",
          displayOptions: { show: { operation: ["listTasks", "createTask"] } }
        },
        {
          displayName: "Event ID",
          name: "eventId",
          type: "number",
          default: 0,
          description: "Task / event id (KalEvent)",
          displayOptions: {
            show: { operation: ["getTask", "assign", "setStatus", "comment", "progress", "callHuman"] }
          }
        },
        // --- createTask fields ---
        {
          displayName: "Label",
          name: "label",
          type: "string",
          default: "",
          required: true,
          displayOptions: { show: { operation: ["createTask"] } }
        },
        {
          displayName: "Description",
          name: "description",
          type: "string",
          typeOptions: { rows: 4 },
          default: "",
          displayOptions: { show: { operation: ["createTask", "comment"] } }
        },
        {
          displayName: "Executor (benefitable)",
          name: "benefitableType",
          type: "options",
          default: "agent",
          options: [
            { name: "Agent", value: "agent" },
            { name: "User (human)", value: "user" }
          ],
          displayOptions: { show: { operation: ["createTask", "assign"] } }
        },
        {
          displayName: "Executor ID",
          name: "benefitableValue",
          type: "number",
          default: 0,
          description: "Agent ID or user ID of the executor",
          displayOptions: { show: { operation: ["createTask", "assign"] } }
        },
        // --- status ---
        {
          displayName: "Status",
          name: "status",
          type: "options",
          options: STATUS_OPTIONS,
          default: 200,
          displayOptions: { show: { operation: ["createTask", "setStatus", "progress"] } }
        },
        // --- progress desc ---
        {
          displayName: "Progress Description",
          name: "progressDesc",
          type: "string",
          typeOptions: { rows: 4 },
          default: "",
          required: true,
          description: "Body of the progress comment (does not overwrite the task spec)",
          displayOptions: { show: { operation: ["progress"] } }
        },
        // --- call human (escalate) ---
        {
          displayName: "Call Kind",
          name: "callKind",
          type: "options",
          default: "review",
          options: [
            { name: "Input (need clarification)", value: "input" },
            { name: "Review (done, take a look)", value: "review" },
            { name: "Stuck (blocked)", value: "stuck" }
          ],
          description: "Type of escalation to a human (the call-human action)",
          displayOptions: { show: { operation: ["callHuman"] } }
        },
        {
          displayName: "Message",
          name: "callDesc",
          type: "string",
          typeOptions: { rows: 4 },
          default: "",
          required: true,
          description: "What to tell the human \u2014 context, question, or what was done",
          displayOptions: { show: { operation: ["callHuman"] } }
        }
      ]
    };
  }
  async execute() {
    const items = this.getInputData();
    const out = [];
    const creds = await this.getCredentials("cekiApi");
    const token = creds.token;
    const client = new ContractClient(token);
    for (let i = 0; i < items.length; i++) {
      const op = this.getNodeParameter("operation", i);
      let result;
      switch (op) {
        case "listContracts":
          result = await client.listContracts();
          break;
        case "listTasks": {
          const contractId = this.getNodeParameter("contractId", i);
          result = await client.tasks(contractId);
          break;
        }
        case "getTask": {
          const eventId = this.getNodeParameter("eventId", i);
          result = await client.task(eventId);
          break;
        }
        case "myEvents":
          result = await client.myEvents();
          break;
        case "createTask": {
          const contractId = this.getNodeParameter("contractId", i);
          const label = this.getNodeParameter("label", i);
          const description = this.getNodeParameter("description", i) || "";
          const status = this.getNodeParameter("status", i);
          const bType = this.getNodeParameter("benefitableType", i);
          const bValue = this.getNodeParameter("benefitableValue", i);
          result = await client.create(contractId, {
            label,
            description: description || void 0,
            status,
            benefitable: bValue ? `${bType}:${bValue}` : void 0
          });
          break;
        }
        case "assign": {
          const eventId = this.getNodeParameter("eventId", i);
          const bType = this.getNodeParameter("benefitableType", i);
          const bValue = this.getNodeParameter("benefitableValue", i);
          if (!bValue) throw new Error("Executor ID is required for Assign");
          result = await client.propose(eventId, { benefitable: `${bType}:${bValue}` });
          break;
        }
        case "setStatus": {
          const eventId = this.getNodeParameter("eventId", i);
          const status = this.getNodeParameter("status", i);
          result = await client.propose(eventId, { status });
          break;
        }
        case "comment": {
          const eventId = this.getNodeParameter("eventId", i);
          const description = this.getNodeParameter("description", i) || "";
          if (!description) throw new Error("Comment text is required");
          result = await client.comment(eventId, { description });
          break;
        }
        case "progress": {
          const eventId = this.getNodeParameter("eventId", i);
          const status = this.getNodeParameter("status", i);
          const desc = this.getNodeParameter("progressDesc", i);
          result = await client.progress(eventId, { status, desc });
          break;
        }
        case "callHuman": {
          const eventId = this.getNodeParameter("eventId", i);
          const kind = this.getNodeParameter("callKind", i);
          const desc = this.getNodeParameter("callDesc", i);
          if (!desc) throw new Error("Message is required for Call Human");
          result = await client.callHuman(eventId, kind, desc);
          break;
        }
        case "poll":
          result = await client.poll();
          break;
        default:
          throw new Error(`Unknown operation: ${op}`);
      }
      out.push({ json: { op, result } });
    }
    return [out];
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CekiContract
});
//# sourceMappingURL=CekiContract.node.js.map
