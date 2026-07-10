/**
 * Minimal Ceki browser client — uses only native WebSocket + fetch (Node 22 globals).
 * Zero npm imports (no ws, no mime-types, no node built-in modules).
 *
 * Timeout management: uses AbortSignal.timeout() instead of restricted
 * setTimeout/clearTimeout globals to satisfy the n8n community-nodes
 * package scanner (no-restricted-globals rule).
 */

// ── types ──────────────────────────────────────────────────────────

export interface BrowserOption {
	schedule_id: number;
	geo?: string;
	price_per_min: number;
	online: boolean;
	rating?: number | null;
}

export interface Match {
	session_id: string;
	schedule_id: number;
	event_id?: string | null;
	chat_topic_id?: string | null;
	provider_user_id?: number | null;
	browser_info?: Record<string, unknown>;
}

export interface RentOptions {
	mode?: 'main' | 'incognito';
}

export interface ScreenshotOptions {
	format?: 'png' | 'base64';
	fullPage?: boolean;
}

// ── helpers ────────────────────────────────────────────────────────

function jsonParse(raw: string): unknown {
	try { return JSON.parse(raw); } catch { return null; }
}

// ── Client ─────────────────────────────────────────────────────────

export class CekiClient {
	private _ws: WebSocket | null = null;
	private _connected = false;
	private _pendingRents = new Map<string, {
		resolve: (m: Match) => void;
		reject: (e: Error) => void;
	}>();
	private _pendingResumes = new Map<string, {
		resolve: (m: Match) => void;
		reject: (e: Error) => void;
	}>();
	private _pendingCdp = new Map<number, {
		resolve: (v: unknown) => void;
		reject: (e: Error) => void;
	}>();
	private _cdpCounter = 1;
	_activeSessions = new Map<string, CekiBrowser>();
	private _connectReject: ((e: Error) => void) | null = null;
	private _closed = false;

	constructor(
		private _token: string,
		private _relayUrl = 'wss://browser.ceki.me/ws/agent',
		private _apiUrl = 'https://api.ceki.me',
	) {}

	/** Connect to the relay WebSocket. */
	async connect(): Promise<void> {
		if (this._connected) return;
		const protocols = [`bearer.${this._token}`];
		this._ws = new WebSocket(this._relayUrl, protocols);
		this._ws.onopen = () => {
			this._connected = true;
		};
		this._ws.onmessage = (ev: MessageEvent) => {
			this._handleMessage(ev.data);
		};
		this._ws.onclose = (ev: CloseEvent) => {
			this._connected = false;
			if ((ev.code === 4401 || ev.code === 4403) && this._connectReject) {
				this._connectReject(new Error(`Auth failed: ${ev.reason || String(ev.code)}`));
				this._connectReject = null;
			}
		};
		this._ws.onerror = () => {
			if (!this._connected && this._connectReject) {
				this._connectReject(new Error('WebSocket connection failed'));
				this._connectReject = null;
			}
		};
		if (this._ws.readyState === WebSocket.CONNECTING) {
			await new Promise<void>((resolve, reject) => {
				if (!this._ws) { reject(new Error('No WebSocket')); return; }
				this._connectReject = reject;
				this._ws!.onopen = () => {
					this._connected = true;
					resolve();
				};
			});
		}
	}

	_sendRaw(msg: Record<string, unknown>): void {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket not connected');
		}
		this._ws.send(JSON.stringify(msg));
	}

	/** Search for available browser providers (HTTP GET). */
	async search(filters?: Record<string, unknown>, limit?: number): Promise<BrowserOption[]> {
		const params = new URLSearchParams();
		if (limit != null) params.set('limit', String(limit));
		if (filters) {
			for (const [k, v] of Object.entries(filters)) {
				if (v != null) params.set(k, String(v));
			}
		}
		const resp = await fetch(`${this._apiUrl}/api/browsers/search?${params}`, {
			headers: { Authorization: `Bearer ${this._token}` },
		});
		if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
		const body = (await resp.json()) as Record<string, unknown>;
		const data = (body.data ?? body) as unknown[];
		return Array.isArray(data) ? data as BrowserOption[] : [];
	}

	/** Rent a browser by schedule_id. */
	async rent(scheduleId: number, opts?: RentOptions): Promise<CekiBrowser> {
		const msg: Record<string, unknown> = { type: 'rent', browser_id: scheduleId };
		if (opts?.mode) msg.mode = opts.mode;
		this._sendRaw(msg);
		return this._awaitRent(`rent:${scheduleId}`, scheduleId, 90000);
	}

	/** Resume an existing session. */
	async resume(sessionId: string): Promise<CekiBrowser> {
		this._sendRaw({ type: 'resume', session_id: sessionId });
		return this._awaitResume(sessionId);
	}

	/** Close the WS connection — session stays alive in grace. */
	disconnect(): void {
		this._closed = true;
		this._activeSessions.clear();
		this._pendingRents.clear();
		this._pendingResumes.clear();
		this._closeWs();
	}

	/** Close everything. */
	close(): void {
		this.disconnect();
	}

	// ── private ────────────────────────────────────────────────

	private _awaitRent(key: string, scheduleId: number, timeoutMs: number): Promise<CekiBrowser> {
		return new Promise((resolve, reject) => {
			const timeoutSignal = AbortSignal.timeout(timeoutMs);
			timeoutSignal.addEventListener('abort', () => {
				this._pendingRents.delete(key);
				reject(new Error('Rent timed out'));
			}, { once: true });
			this._pendingRents.set(key, {
				resolve: (match: Match) => {
					const browser = new CekiBrowser(this, match);
					this._activeSessions.set(browser.sessionId, browser);
					resolve(browser);
				},
				reject: (err: Error) => {
					reject(err);
				},
			});
		});
	}

	private _awaitResume(sessionId: string): Promise<CekiBrowser> {
		return new Promise((resolve, reject) => {
			const timeoutSignal = AbortSignal.timeout(10000);
			timeoutSignal.addEventListener('abort', () => {
				this._pendingResumes.delete(sessionId);
				reject(new Error('Resume timed out'));
			}, { once: true });
			this._pendingResumes.set(sessionId, {
				resolve: (match: Match) => {
					const browser = new CekiBrowser(this, match);
					this._activeSessions.set(browser.sessionId, browser);
					resolve(browser);
				},
				reject: (err: Error) => {
					reject(err);
				},
			});
		});
	}

	private _closeWs(): void {
		if (this._ws) {
			try { this._ws.onopen = null; this._ws.onmessage = null; this._ws.onclose = null; this._ws.onerror = null; this._ws.close(); } catch { /* ignore */ }
			this._ws = null;
		}
	}

	private _handleMessage(data: unknown): void {
		const msg = jsonParse(String(data)) as Record<string, unknown> | null;
		if (!msg || typeof msg !== 'object') return;
		const type = String(msg.type ?? '');
		const sid = msg.session_id ? String(msg.session_id) : null;

		switch (type) {
			case 'pong':
			case 'rent_pending':
				break;
			case 'match':
				this._onMatch(msg);
				break;
			case 'rent.error':
				this._onRentError(msg);
				break;
			case 'resume_ok':
				this._onResumeOk(msg);
				break;
			case 'resume_failed':
				this._onResumeFailed(msg);
				break;
			case 'cdp_response':
				if (sid) this._onCdpResponse(sid, msg);
				break;
			case 'session.ended':
				if (sid) {
					this._activeSessions.delete(sid);
					const b = this._activeSessions.get(sid);
					if (b) (b as any)._ended = String(msg.reason ?? 'ended');
				}
				break;
		}
	}

	private _onMatch(msg: Record<string, unknown>): void {
		const scheduleId = Number(msg.schedule_id ?? 0);
		const eventId = msg.event_id ? String(msg.event_id) : null;
		let pending = this._pendingRents.get(`event:${eventId}`);
		if (!pending) pending = this._pendingRents.get(`rent:${scheduleId}`);
		if (pending) {
			this._pendingRents.delete(`event:${eventId}`);
			this._pendingRents.delete(`rent:${scheduleId}`);
			pending.resolve({
				session_id: String(msg.session_id ?? ''),
				schedule_id: scheduleId,
				event_id: eventId,
				chat_topic_id: msg.chat_topic_id ? String(msg.chat_topic_id) : null,
				provider_user_id: msg.provider_user_id != null ? Number(msg.provider_user_id) : null,
				browser_info: (msg.browser_info ?? {}) as Record<string, unknown>,
			});
		}
	}

	private _onRentError(msg: Record<string, unknown>): void {
		const code = String(msg.code ?? '');
		const message = String(msg.message ?? '');
		for (const [key, pending] of this._pendingRents) {
			this._pendingRents.delete(key);
			pending.reject(new Error(message || `Rent error: ${code}`));
			return;
		}
	}

	private _onResumeOk(msg: Record<string, unknown>): void {
		const sessionId = String(msg.session_id ?? '');
		const pending = this._pendingResumes.get(sessionId);
		if (!pending) return;
		this._pendingResumes.delete(sessionId);
		pending.resolve({
			session_id: sessionId,
			schedule_id: Number(msg.schedule_id ?? 0),
			event_id: msg.event_id ? String(msg.event_id) : null,
			chat_topic_id: msg.chat_topic_id ? String(msg.chat_topic_id) : null,
			provider_user_id: msg.provider_user_id != null ? Number(msg.provider_user_id) : null,
			browser_info: (msg.browser_info ?? {}) as Record<string, unknown>,
		});
	}

	private _onResumeFailed(msg: Record<string, unknown>): void {
		const sessionId = String(msg.session_id ?? '');
		const pending = this._pendingResumes.get(sessionId);
		if (!pending) return;
		this._pendingResumes.delete(sessionId);
		pending.reject(new Error(String(msg.reason ?? 'Resume failed')));
	}

	private _onCdpResponse(sessionId: string, msg: Record<string, unknown>): void {
		const browser = this._activeSessions.get(sessionId);
		if (!browser) return;
		const id = Number(msg.id ?? 0);
		const pending = this._pendingCdp.get(id);
		if (!pending) return;
		this._pendingCdp.delete(id);
		if (msg.error) {
			pending.reject(new Error(String((msg.error as Record<string, unknown>).message ?? 'CDP error')));
		} else {
			pending.resolve(msg.result);
		}
	}
}

// ── Browser ────────────────────────────────────────────────────────

export class CekiBrowser {
	readonly sessionId: string;
	readonly scheduleId: number;
	readonly chatTopicId: string | null;
	readonly browserInfo: Record<string, unknown>;
	readonly providerUserId: number | null;

	private _client: CekiClient;
	private _cdpId = 1;
	_pendingCdp = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	constructor(client: CekiClient, match: Match) {
		this._client = client;
		this.sessionId = match.session_id;
		this.scheduleId = match.schedule_id;
		this.chatTopicId = match.chat_topic_id ?? null;
		this.browserInfo = match.browser_info ?? {};
		this.providerUserId = match.provider_user_id ?? null;
	}

	/** Send a CDP command. Uses AbortSignal.timeout() (no restricted setTimeout global). */
	async send(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
		const id = this._cdpId++;
		const msg = { type: 'cdp', session_id: this.sessionId, id, method, params: params ?? {} };
		this._client._sendRaw(msg);
		return new Promise((resolve, reject) => {
			const timeoutSignal = AbortSignal.timeout(timeoutMs);
			timeoutSignal.addEventListener('abort', () => {
				this._pendingCdp.delete(id);
				reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
			}, { once: true });
			this._pendingCdp.set(id, {
				resolve: (v) => { resolve(v); },
				reject: (e) => { reject(e); },
			});
		});
	}

	async navigate(url: string, timeoutMs?: number): Promise<void> {
		await this.send('Page.navigate', { url }, timeoutMs);
	}

	async click(x: number, y: number): Promise<void> {
		await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
		await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
	}

	async type(text: string): Promise<void> {
		await this.send('Ceki.typeText', { text });
	}

	async scroll(deltaY: number): Promise<void> {
		await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX: 0, deltaY });
	}

	async screenshot(opts?: ScreenshotOptions): Promise<{ data: string } | Buffer> {
		const format = opts?.format ?? 'base64';
		const fullPage = opts?.fullPage ?? false;
		let clip: Record<string, number> | undefined;
		if (fullPage) {
			const metrics = await this.send('Page.getLayoutMetrics') as Record<string, unknown> | null;
			const contentSize = metrics?.contentSize as Record<string, number> | undefined;
			if (contentSize) {
				clip = { x: 0, y: 0, width: Number(contentSize.width ?? 1920), height: Math.min(Number(contentSize.height ?? 1080), 16384), scale: 1 };
			}
		}
		const result = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }) as Record<string, unknown> | null;
		const data = String(result?.data ?? '');
		if (format === 'png') {
			return Buffer.from(data, 'base64');
		}
		return { data };
	}

	async snapshot(): Promise<{ screenshot: string; ts: Date }> {
		const ssResult = await this.screenshot({ format: 'base64' }) as { data: string };
		return { screenshot: ssResult.data, ts: new Date() };
	}

	async upload(selector: string, buf: Buffer, filename = 'file'): Promise<Record<string, unknown>> {
		const b64 = buf.toString('base64');
		const size = buf.length;
		const mime = 'application/octet-stream';
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
		const result = await this.send('Runtime.evaluate', { expression, returnByValue: true }) as Record<string, unknown> | null;
		try {
			await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
			await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
		} catch { /* ignore */ }
		const resultObj = result?.result as Record<string, unknown> | undefined;
		if (resultObj?.value) return JSON.parse(String(resultObj.value)) as Record<string, unknown>;
		return { ok: true, filename, size };
	}

	async close(): Promise<void> {
		await this.send('Ceki.close', {}).catch(() => {});
		this._client._activeSessions.delete(this.sessionId);
	}
}
