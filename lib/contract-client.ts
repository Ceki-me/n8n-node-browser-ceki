/**
 * Minimal Ceki contract client — uses only native fetch (Node 22 global).
 * Zero npm imports (no ws, no axios, no node built-in modules beyond globals).
 *
 * Communicates with Ceki's MCP endpoint via JSON-RPC 2.0 over HTTP POST.
 */

// ── helpers ────────────────────────────────────────────────────────

function cleanArgs<T extends Record<string, unknown>>(o: T): Partial<T> {
	const out = { ...o };
	for (const k of Object.keys(out)) {
		if ((out as any)[k] === undefined || (out as any)[k] === null) delete (out as any)[k];
	}
	return out;
}

function parseBenefitable(value: string | null | undefined): { type: string; value: number } | null {
	if (!value) return null;
	const m = /^(agent|user):(\d+)$/.exec(value);
	if (!m) return null;
	return { type: m[1], value: Number(m[2]) };
}

interface ParticipantSpec {
	participable_id: number;
	type: string;
	role_id: number;
}

function parseParticipant(value: string | null | undefined, roleId: number): ParticipantSpec | null {
	const b = parseBenefitable(value);
	if (!b) return null;
	return { participable_id: b.value, type: b.type, role_id: roleId };
}

function deriveLabel(desc: string | null | undefined): string {
	if (!desc) return '';
	const line = desc.split('\n')[0].trim();
	return line.length > 60 ? line.slice(0, 57) + '...' : line;
}

const ROLE_REVIEWER = 5;
const ROLE_QA = 6;

// ── types ──────────────────────────────────────────────────────────

export interface CreateOptions {
	label: string;
	type?: number;
	status?: number;
	description?: string;
	benefitable?: string;
	reviewer?: string;
	qa?: string;
}

export interface ProposeOptions {
	status?: number;
	label?: string;
	description?: string;
	benefitable?: string;
}

export interface CommentOptions {
	label?: string;
	description?: string;
}

export interface ProgressOptions {
	status?: number;
	desc: string;
}

// ── client ─────────────────────────────────────────────────────────

export class ContractClient {
	private _endpoint: string;
	private _apiBase: string;
	private _token: string;

	constructor(token: string, endpoint?: string, apiBase?: string) {
		this._endpoint = (endpoint ?? 'https://api.ceki.me/mcp').replace(/\/+$/, '');
		this._apiBase = (apiBase ?? 'https://api.ceki.me').replace(/\/+$/, '');
		this._token = token;
	}

	private _headers(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			Authorization: `Bearer ${this._token}`,
		};
	}

	private async _rpc(method: string, params: Record<string, unknown>): Promise<any> {
		const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
		const resp = await fetch(this._endpoint, {
			method: 'POST',
			headers: this._headers(),
			body,
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(`HTTP ${resp.status}: ${text.slice(0, 400)}`);
		}
		return resp.json();
	}

	private async _call(tool: string, args?: Record<string, unknown>): Promise<any> {
		const body = await this._rpc('tools/call', { name: tool, arguments: args ?? {} });
		if (body.error) throw new Error(`${tool} → ${JSON.stringify(body.error).slice(0, 400)}`);
		const result = body.result ?? {};
		const content = result.content;
		if (Array.isArray(content)) {
			const texts = content.filter((c: any) => c.type === 'text').map((c: any) => String(c.text ?? ''));
			const joined = texts.join('\n');
			try { return JSON.parse(joined); } catch { return joined; }
		}
		if (result.structuredContent !== undefined) return result.structuredContent;
		return result;
	}

	// ── domain methods ─────────────────────────────────────────

	async listContracts(): Promise<any> {
		return this._call('list-contracts');
	}

	async members(contractId: number): Promise<any> {
		return this._call('contract-members', { contract_id: contractId });
	}

	async tasks(contractId: number): Promise<any> {
		return this._call('contract-tasks', { contract_id: contractId });
	}

	async myEvents(): Promise<any> {
		return this._call('get-my-events');
	}

	async task(eventId: number): Promise<any> {
		return this._call('get-event', { event_id: eventId });
	}

	async create(contractId: number, opts: CreateOptions): Promise<any> {
		const args = cleanArgs({
			contract_id: contractId,
			label: opts.label,
			type_id: opts.type,
			status_id: opts.status,
			description: opts.description,
			benefitable: opts.benefitable ? parseBenefitable(opts.benefitable) : undefined,
		});
		const users: ParticipantSpec[] = [];
		const rev = parseParticipant(opts.reviewer, ROLE_REVIEWER);
		if (rev) users.push(rev);
		const qa = parseParticipant(opts.qa, ROLE_QA);
		if (qa) users.push(qa);
		if (users.length) (args as any).users = users;
		return this._call('create-contract-event', args);
	}

	async propose(eventId: number, opts: ProposeOptions): Promise<any> {
		return this._call('propose-correction', cleanArgs({
			event_id: eventId,
			status_id: opts.status,
			label: opts.label,
			description: opts.description,
			benefitable: opts.benefitable ? parseBenefitable(opts.benefitable) : undefined,
		}));
	}

	async comment(eventId: number, opts?: CommentOptions): Promise<any> {
		return this._call('comment', cleanArgs({
			event_id: eventId,
			label: opts?.label,
			description: opts?.description,
		}));
	}

	async progress(eventId: number, opts: ProgressOptions): Promise<any> {
		let statusResult: any = null;
		if (opts.status != null) {
			statusResult = await this.propose(eventId, { status: opts.status });
		}
		const commentResult = await this.comment(eventId, { label: deriveLabel(opts.desc), description: opts.desc });
		return { status_correction: statusResult, comment: commentResult };
	}

	async callHuman(eventId: number, kind: 'input' | 'review' | 'stuck', desc: string): Promise<any> {
		if (!['input', 'review', 'stuck'].includes(kind)) throw new Error(`kind must be input|review|stuck, got ${kind}`);
		return this._call('call-human', { event_id: eventId, kind, desc });
	}

	/** GET /agent/polling. Returns [] on 429. */
	async poll(): Promise<any[]> {
		const resp = await fetch(`${this._apiBase}/agent/polling`, {
			headers: { Accept: 'application/json', Authorization: `Bearer ${this._token}` },
		});
		if (resp.status === 429) return [];
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(`poll HTTP ${resp.status}: ${text.slice(0, 300)}`);
		}
		const body = (await resp.json()) as Record<string, unknown>;
		if (Array.isArray(body)) return body;
		if (body && typeof body === 'object') {
			for (const k of ['notifications', 'data', 'items']) {
				if (Array.isArray(body[k])) return body[k] as any[];
			}
		}
		return [];
	}
}
