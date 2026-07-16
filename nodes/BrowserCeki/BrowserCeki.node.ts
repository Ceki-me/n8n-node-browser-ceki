import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { CekiClient } from '../../lib/ceki-client';

const sleep = (ms: number) => new Promise<void>((resolve) => {
	AbortSignal.timeout(ms).addEventListener('abort', () => resolve(), { once: true });
});

/**
 * Browser Ceki — one node, many operations.
 * Uses native WebSocket (not the ws library) — zero external runtime deps.
 *
 * Resume flow:
 *   1. Rent → browser session created, client disconnects (session in grace).
 *   2. Navigate/Screenshot/etc → new client, connect, resume(sessionId) → server
 *      responds with resume_ok, do the op, disconnect.
 *   3. Close → same, sends Ceki.close, client.close().
 *
 * This works because the server supports session resume across different
 * WebSocket connections (same auth token). Each n8n node independently
 * creates a fresh WS connection and resumes the session by ID.
 */
export class BrowserCeki implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Ceki',
		name: 'browserCeki',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{ "Ceki: " + $parameter.operation }}',
		description: 'Rent a real human browser and control it: rent, navigate, click, type, screenshot, solve captchas, and more',
		defaults: { name: 'Browser Ceki' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'cekiApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				default: 'search',
				options: [
					{ name: 'Search', value: 'search' },
					{ name: 'Rent', value: 'rent' },
					{ name: 'Navigate', value: 'navigate' },
					{ name: 'Click', value: 'click' },
					{ name: 'Type', value: 'type' },
					{ name: 'Scroll', value: 'scroll' },
					{ name: 'Screenshot', value: 'screenshot' },
					{ name: 'Snapshot', value: 'snapshot' },
					{ name: 'Wait', value: 'wait' },
					{ name: 'Wait for Selector', value: 'waitForSelector' },
					{ name: 'Upload', value: 'upload' },
					{ name: 'Close', value: 'close' },
					{ name: 'Full: Rent → Navigate → Screenshot', value: 'full' },
				],
			},
			// === Rent: rental parameters ===
			{
				displayName: 'Schedule ID',
				name: 'scheduleId',
				type: 'number',
				default: 0,
				description: '0 — search by the filters below',
				displayOptions: { show: { operation: ['rent'] } },
			},
			{
				displayName: 'Geo',
				name: 'geo',
				type: 'string',
				default: '',
				placeholder: 'RU, EE, US…',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Max $/min',
				name: 'maxPrice',
				type: 'number',
				typeOptions: { numberPrecision: 4 },
				default: 0.02,
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Min rating',
				name: 'minRating',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Profile mode',
				name: 'mode',
				type: 'options',
				default: 'incognito',
				options: [
					{ name: 'main', value: 'main' },
					{ name: 'incognito', value: 'incognito' },
				],
				displayOptions: { show: { operation: ['rent', 'full'] } },
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: 'https://example.com',
				required: true,
				displayOptions: { show: { operation: ['navigate', 'full'] } },
			},
			{
				displayName: 'Demo mode (no browser needed)',
				name: 'demoMode',
				type: 'boolean',
				default: true,
				description: 'Skip actual browser rent and generate demo output',
				displayOptions: { show: { operation: ['full'] } },
			},
			// === Operations: session_id ===


			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				description: 'From the Rent operation',
				required: true,
				displayOptions: {
					show: {
						operation: ['navigate', 'click', 'type', 'scroll', 'screenshot', 'snapshot', 'wait', 'waitForSelector', 'upload', 'close'],
					},
				},
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['navigate'] } },
			},
			{
				displayName: 'X',
				name: 'x',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['click'] } },
			},
			{
				displayName: 'Y',
				name: 'y',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['click'] } },
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['type'] } },
			},
			{
				displayName: 'Delta Y',
				name: 'deltaY',
				type: 'number',
				default: -300,
				displayOptions: { show: { operation: ['scroll'] } },
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				default: 'png',
				options: [
					{ name: 'PNG (binary)', value: 'png' },
					{ name: 'Base64', value: 'base64' },
				],
				displayOptions: { show: { operation: ['screenshot'] } },
			},
			{
				displayName: 'Full page',
				name: 'fullPage',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['screenshot'] } },
			},
			{
				displayName: 'Milliseconds',
				name: 'ms',
				type: 'number',
				default: 1000,
				typeOptions: { minValue: 0 },
				description: 'Fixed delay on the active session',
				displayOptions: { show: { operation: ['wait', 'full'] } },
			},
			{
				displayName: 'CSS Selector',
				name: 'waitSelector',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. .results, #content, table tr',
				displayOptions: { show: { operation: ['waitForSelector'] } },
			},
			{
				displayName: 'Timeout (ms)',
				name: 'waitTimeout',
				type: 'number',
				default: 30000,
				description: 'Waits until the selector appears in the DOM',
				displayOptions: { show: { operation: ['waitForSelector'] } },
			},
			{
				displayName: 'CSS Selector',
				name: 'selector',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['upload'] } },
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { operation: ['upload'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const creds = await this.getCredentials('cekiApi');
		const token = creds.token as string;

		const resolveSid = async (i: number, client: CekiClient) => {
			const scheduleId = this.getNodeParameter('scheduleId', i) as number;
			if (scheduleId) return scheduleId;
			const geo = this.getNodeParameter('geo', i) as string;
			const maxPrice = this.getNodeParameter('maxPrice', i) as number;
			const list = await client.search({
				geo: geo || undefined,
				max_price_per_min: maxPrice,
			});
			if (!list.length) throw new Error('No browsers found by filters');
			return list[0].schedule_id;
		};

		for (let i = 0; i < items.length; i++) {
			const op = this.getNodeParameter('operation', i) as string;
			const client = new CekiClient(token);
			let browser: any;
			let needFullClose = false;
			try {
				await client.connect();

				if (op === 'rent') {
					try {
						const sid = await resolveSid(i, client);
						const mode = this.getNodeParameter('mode', i) as 'main' | 'incognito';
						browser = await client.rent(sid, { mode });
						out.push({
							json: { session_id: browser.sessionId, schedule_id: sid, mode },
						});
					} catch (e) {
						throw new Error(`Rent failed: ${(e as Error).message}`);
					} finally {
						await client.disconnect();
					}
					continue;
				}

				if (op === 'search') {
					try {
						const geo = this.getNodeParameter('geo', i) as string;
						const maxPrice = this.getNodeParameter('maxPrice', i) as number;
						const list = await client.search({
							geo: geo || undefined,
							max_price_per_min: maxPrice,
						});
						out.push({ json: { browsers: list, count: list.length } });
					} catch (e) {
						throw new Error(`Search failed: ${(e as Error).message}`);
					} finally {
						await client.disconnect();
					}
					continue;
				}

				
				if (op === 'full') {
					const demoMode = this.getNodeParameter('demoMode', i) as boolean;
					let sid: number;
					if (demoMode) {
						sid = 99999; // mock
					} else {
						try {
							sid = await resolveSid(i, client);
						} catch (e) {
							throw new Error(`Full: resolve schedule failed: ${(e as Error).message}`);
						}
					}
					const mode = this.getNodeParameter('mode', i) as 'main' | 'incognito';
					const url = this.getNodeParameter('url', i) as string;
					const ms = this.getNodeParameter('ms', i) as number;

					let session_id: string;
					let binary: any;

					try {
						if (demoMode) {
						session_id = 'demo-' + Date.now();
						const demoPng = Buffer.from('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', 'base64');
						binary = await this.helpers.prepareBinaryData(demoPng, 'screenshot.png', 'image/png');
					} else {
						try {
							browser = await client.rent(sid, { mode });
							session_id = browser.sessionId;
							await browser.navigate(url);
							await sleep(ms);
							const shot = await browser.screenshot({ format: 'png', fullPage: true }) as any;
							const data = (shot as Buffer).toString('base64');
							binary = await this.helpers.prepareBinaryData(Buffer.from(data, 'base64'), 'screenshot.png', 'image/png');
							await browser.close();
						} catch (e) {
							throw new Error(`Full op failed at step "${(browser?.sessionId ? 'navigate/screenshot' : 'rent')}": ${(e as Error).message}`);
						}
					}

					out.push({
						json: {
							session_id,
							schedule_id: sid,
							mode,
							url,
							waited: ms,
						},
						binary: { data: binary },
					});
				} finally {
					await client.close().catch(() => {});
				}
				continue;
			}

			// All remaining operations: navigate, click, type, scroll, screenshot,
			// snapshot, wait, waitForSelector, upload, close.
			// Each creates a fresh WS connection and resumes the existing
			// browser session by sessionId (server supports cross-WS resume).
			const sessionId = this.getNodeParameter('sessionId', i) as string;
			try {
				browser = await client.resume(sessionId);
			} catch (e) {
				throw new Error(`Resume session "${sessionId}" failed: ${(e as Error).message}. Session may have expired or still be in grace.`);
			}
			const sid = browser.sessionId;

			switch (op) {
				case 'navigate': {
					try {
						const url = this.getNodeParameter('url', i) as string;
						await browser.navigate(url);
						out.push({ json: { session_id: sid, url } });
					} catch (e) {
						throw new Error(`Navigate failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'click': {
					try {
						const x = this.getNodeParameter('x', i) as number;
						const y = this.getNodeParameter('y', i) as number;
						await browser.click(x, y);
						out.push({ json: { session_id: sid, clicked: [x, y] } });
					} catch (e) {
						throw new Error(`Click at (${x},${y}) failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'type': {
					try {
						const text = this.getNodeParameter('text', i) as string;
						await browser.type(text);
						out.push({ json: { session_id: sid, typed: text } });
					} catch (e) {
						throw new Error(`Type failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'scroll': {
					try {
						const deltaY = this.getNodeParameter('deltaY', i) as number;
						await browser.scroll(deltaY);
						out.push({ json: { session_id: sid, scrolled: deltaY } });
					} catch (e) {
						throw new Error(`Scroll failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'screenshot': {
					try {
						const format = this.getNodeParameter('format', i) as 'png' | 'base64';
						const fullPage = this.getNodeParameter('fullPage', i) as boolean;
						const shot = await browser.screenshot({ format, fullPage }) as any;
						const data = format === 'base64' ? shot.data : (shot as Buffer).toString('base64');
						const binary = await this.helpers.prepareBinaryData(
							Buffer.from(data, 'base64'),
							'screenshot.png',
							'image/png',
						);
						out.push({ json: { session_id: sid }, binary: { data: binary } });
					} catch (e) {
						throw new Error(`Screenshot failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'snapshot': {
					try {
						const snap = await browser.snapshot();
						out.push({
							json: { session_id: sid, screenshot: snap.screenshot },
						});
					} catch (e) {
						throw new Error(`Snapshot failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'wait': {
					const ms = this.getNodeParameter('ms', i) as number;
					await sleep(ms);
					out.push({ json: { session_id: sid, waited: ms } });
					break;
				}
				case 'waitForSelector': {
					const selector = this.getNodeParameter('waitSelector', i) as string;
					const timeout = this.getNodeParameter('waitTimeout', i) as number;
					const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
					const deadline = Date.now() + timeout;
					let ok = false;
					let lastErr: unknown = null;
					while (Date.now() < deadline) {
						try {
							const res = await browser.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as any;
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
							`waitForSelector("${selector}") timed out after ${timeout}ms${lastErr ? `: ${(lastErr as Error).message}` : ''}`,
						);
					}
					out.push({ json: { session_id: sid, selector, found: true } });
					break;
				}
				case 'upload': {
					try {
						const selector = this.getNodeParameter('selector', i) as string;
						const bpn = this.getNodeParameter('binaryPropertyName', i) as string;
						const bin = items[i].binary?.[bpn];
						if (!bin) throw new Error(`Binary property "${bpn}" not found on input`);
						const stream = await this.helpers.getBinaryStream(bin.id as string);
						const chunks: Buffer[] = [];
						for await (const c of stream) chunks.push(c as Buffer);
						const buf = Buffer.concat(chunks);
						const res = await browser.upload(selector, buf);
						out.push({ json: { session_id: sid, uploaded: res } });
					} catch (e) {
						throw new Error(`Upload failed: ${(e as Error).message}`);
					}
					break;
				}
				case 'close': {
					try {
						// Try graceful CDP close first (best-effort)
						await browser.close().catch(() => {});
					} catch {
						// ignore CDP close errors
					}
					// Always send relay stop (force-end session) — CDP can silently fail
					// eslint-disable-next-line no-async-promise-executor
					await new Promise((resolve) => {
						const stopWs = new WebSocket('wss://browser.ceki.me/ws/agent', [`bearer.${token}`]);
						const abortTimer = AbortSignal.timeout(10000);
					const onTimer = () => { try { stopWs.close(); } catch {} resolve(); };
					abortTimer.addEventListener("abort", onTimer, { once: true });
						stopWs.onopen = () => {
							stopWs.send(JSON.stringify({ type: 'stop', session_id: sessionId, reason: 'n8n close' }));
						};
						stopWs.onmessage = (ev) => {
							try {
								const msg = JSON.parse(ev.data);
								if (msg.type === 'session_ended') {
									abortTimer.removeEventListener("abort", onTimer);
									try { stopWs.close(); } catch {}
									resolve();
								}
							} catch {}
						};
						stopWs.onerror = () => { abortTimer.removeEventListener("abort", onTimer); resolve(); };
						stopWs.onclose = () => { abortTimer.removeEventListener("abort", onTimer); resolve(); };
					});
					out.push({ json: { closed: true, session_id: sessionId } });
					break;
				}
			}

			needFullClose = op === 'close';
			} finally {
				try {
					if (needFullClose) {
						await client.close();
					} else {
						await client.disconnect();
					}
				} catch {
					// swallow cleanup errors
				}
			}
		}
		return [out];
	}
}
