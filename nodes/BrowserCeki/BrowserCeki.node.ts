import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { connect } from '@ceki/sdk';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_CODE = `// A browser is already rented for you. connect/rent/close are handled by the node.
await browser.navigate('https://ifconfig.me');
const shot = await browser.screenshot();
return [{ json: { ok: true, size: shot.length } }];
`;

/**
 * Browser Ceki — one node, many operations.
 * connect/rent/resume/close happen internally. session_id flows between calls of the node.
 */
export class BrowserCeki implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Ceki',
		name: 'browserCeki',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{ "Ceki: " + $operation }}',
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
				default: 'rent',
				options: [
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
					{ name: 'Run Code', value: 'code' },
				],
			},
			// === Rent / Code: rental parameters ===
			{
				displayName: 'Schedule ID',
				name: 'scheduleId',
				type: 'number',
				default: 0,
				description: '0 — search by the filters below',
				displayOptions: { show: { operation: ['rent', 'code'] } },
			},
			{
				displayName: 'Geo',
				name: 'geo',
				type: 'string',
				default: '',
				placeholder: 'RU, EE, US…',
				displayOptions: { show: { operation: ['rent', 'code'] } },
			},
			{
				displayName: 'Max $/min',
				name: 'maxPrice',
				type: 'number',
				typeOptions: { numberPrecision: 4 },
				default: 0.02,
				displayOptions: { show: { operation: ['rent', 'code'] } },
			},
			{
				displayName: 'Min rating',
				name: 'minRating',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['rent'] } },
			},
			{
				displayName: 'Profile mode',
				name: 'mode',
				type: 'options',
				default: 'main',
				options: [
					{ name: 'main', value: 'main' },
					{ name: 'incognito', value: 'incognito' },
				],
				displayOptions: { show: { operation: ['rent', 'code'] } },
			},
			// === Operations: session_id ===
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '={{ $json.session_id }}',
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
				displayOptions: { show: { operation: ['wait'] } },
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
			{
				displayName: 'JavaScript (a live browser is in scope)',
				name: 'code',
				type: 'string',
				typeOptions: { editor: 'codeNodeEditor', rows: 12 },
				default: DEFAULT_CODE,
				displayOptions: { show: { operation: ['code'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const creds = await this.getCredentials('cekiApi');
		const token = creds.token as string;

		const resolveSid = async (i: number, client: any) => {
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
			const client = await connect(token);
			let browser: any;
			try {
				if (op === 'rent') {
					const sid = await resolveSid(i, client);
					const mode = this.getNodeParameter('mode', i) as 'main' | 'incognito';
					browser = await client.rent(sid, { mode });
					out.push({
						json: { session_id: browser.sessionId, schedule_id: sid, mode },
					});
					await client.disconnect(); // session stays in grace — the next node resumes it
					continue;
				}

				if (op === 'code') {
					const sid = await resolveSid(i, client);
					const mode = this.getNodeParameter('mode', i) as 'main' | 'incognito';
					browser = await client.rent(sid, { mode });
					const code = this.getNodeParameter('code', i) as string;
					// eslint-disable-next-line no-new-func
					const fn = new Function(
						'browser',
						'client',
						`return (async () => {\n${code}\n})();`,
					);
					const result = await fn(browser, client);
					if (Array.isArray(result)) for (const r of result) out.push(r);
					else if (result) out.push({ json: result });
					else out.push({ json: { done: true } });
					await browser.close();
					await client.close();
					continue;
				}

				// remaining operations resume by sessionId
				const sessionId = this.getNodeParameter('sessionId', i) as string;
				browser = await client.resume(sessionId);
				const sid = browser.sessionId;

				switch (op) {
					case 'navigate': {
						const url = this.getNodeParameter('url', i) as string;
						await browser.navigate(url);
						out.push({ json: { session_id: sid, url } });
						break;
					}
					case 'click': {
						const x = this.getNodeParameter('x', i) as number;
						const y = this.getNodeParameter('y', i) as number;
						await browser.click(x, y);
						out.push({ json: { session_id: sid, clicked: [x, y] } });
						break;
					}
					case 'type': {
						const text = this.getNodeParameter('text', i) as string;
						await browser.type(text);
						out.push({ json: { session_id: sid, typed: text } });
						break;
					}
					case 'scroll': {
						const deltaY = this.getNodeParameter('deltaY', i) as number;
						await browser.scroll({ deltaY });
						out.push({ json: { session_id: sid, scrolled: deltaY } });
						break;
					}
					case 'screenshot': {
						const format = this.getNodeParameter('format', i) as 'png' | 'base64';
						const fullPage = this.getNodeParameter('fullPage', i) as boolean;
						const shot = (await browser.screenshot({ format, fullPage })) as any;
						const data = format === 'base64' ? shot.data : shot.toString('base64');
						const binary = await this.helpers.prepareBinaryData(
							Buffer.from(data, 'base64'),
							'screenshot.png',
							'image/png',
						);
						out.push({ json: { session_id: sid }, binary: { data: binary } });
						break;
					}
					case 'snapshot': {
						const snap = await browser.snapshot();
						out.push({
							json: { session_id: sid, ts: (snap as any).ts, chat: (snap as any).chat },
						});
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
								const res = (await browser.send({
									method: 'Runtime.evaluate',
									params: { expression: expr, returnByValue: true },
								})) as any;
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
						break;
					}
					case 'close': {
						await browser.close();
						out.push({ json: { closed: true, session_id: sessionId } });
						break;
					}
				}

				if (op === 'close') {
					await client.close();
				} else {
					await client.disconnect(); // session stays alive for the next node
				}
			} finally {
				// trap
			}
		}
		return [out];
	}
}
