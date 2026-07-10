import type { IExecuteFunctions, INodeType, INodeTypeDescription, INodeExecutionData } from 'n8n-workflow';
import { CekiClient } from '../../../lib/ceki-client';

const sleep = (ms: number) => new Promise<void>((resolve) => {
	AbortSignal.timeout(ms).addEventListener('abort', () => resolve(), { once: true });
});

async function waitForSelector(browser: any, selector: string, timeoutMs: number, intervalMs = 500) {
	const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const res = await browser.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as any;
			if (res?.result?.value === true) return true;
		} catch (e) {
			lastErr = e;
		}
		await sleep(intervalMs);
	}
	throw new Error(
		`waitForSelector("${selector}") timed out after ${timeoutMs}ms${lastErr ? `: ${(lastErr as Error).message}` : ''}`,
	);
}

async function extractHtml(browser: any, selector: string): Promise<string> {
	const expr =
		selector.trim() === '' || selector === 'body'
			? `document.body ? document.body.outerHTML : ''`
			: `(function(){ var el = document.querySelector(${JSON.stringify(selector)}); return el ? el.outerHTML : ''; })()`;
	const res = await browser.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as any;
	return (res?.result?.value as string) ?? '';
}

/**
 * Recipe: Captcha-protected Scrape.
 * Rent a human browser → open a URL → (optional) wait for a selector →
 * snapshot/HTML → release.
 *
 * The real human fingerprint bypasses anti-bot protection.
 */
export class CekiCaptchaScrape implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Ceki: Captcha-protected Scrape',
		name: 'cekiCaptchaScrape',
		description: 'Rent a human browser, wait, screenshot/HTML, release',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '=rent in {{ $geo }} → snapshot',
		defaults: { name: 'Browser Ceki: Captcha-protected Scrape' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'cekiApi', required: true }],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: 'https://example.com',
				required: true,
				description: 'Page protected by anti-bot / captcha',
			},
			{
				displayName: 'Geo',
				name: 'geo',
				type: 'string',
				default: 'RU',
				placeholder: 'RU, EE, US…',
			},
			{ displayName: 'Max $/min', name: 'maxPrice', type: 'number', typeOptions: { numberPrecision: 4 }, default: 0.02 },
			{
				displayName: 'Wait for Selector',
				name: 'waitSelector',
				type: 'string',
				default: '',
				placeholder: 'CSS selector (optional)',
				description: 'Wait until this selector appears in the DOM',
			},
			{
				displayName: 'Wait Timeout (ms)',
				name: 'waitTimeout',
				type: 'number',
				default: 30000,
			},
			{
				displayName: 'Extract HTML',
				name: 'extractHtml',
				type: 'boolean',
				default: true,
			},
			{
				displayName: 'HTML Selector',
				name: 'htmlSelector',
				type: 'string',
				default: 'body',
				placeholder: 'CSS selector or "body"',
				description: 'outerHTML of this selector is returned as `html`',
				displayOptions: { show: { extractHtml: [true] } },
			},
			{
				displayName: 'Full Page Screenshot',
				name: 'fullPage',
				type: 'boolean',
				default: false,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const creds = await this.getCredentials('cekiApi');

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const geo = this.getNodeParameter('geo', i) as string;
			const maxPrice = this.getNodeParameter('maxPrice', i) as number;
			const waitSelector = (this.getNodeParameter('waitSelector', i) as string) || '';
			const waitTimeout = this.getNodeParameter('waitTimeout', i) as number;
			const extractHtmlFlag = this.getNodeParameter('extractHtml', i) as boolean;
			const htmlSelector = (this.getNodeParameter('htmlSelector', i) as string) || 'body';
			const fullPage = this.getNodeParameter('fullPage', i) as boolean;

			const client = new CekiClient(creds.token as string);
			await client.connect();
			let browser: any;
			let scheduleId = 0;
			try {
				const list = await client.search({ geo: geo || undefined, max_price_per_min: maxPrice });
				if (!list.length) throw new Error(`No browsers in geo ${geo || '*'}`);
				scheduleId = list[0].schedule_id;
				browser = await client.rent(scheduleId);

				await browser.navigate(url);

				if (waitSelector) {
					await waitForSelector(browser, waitSelector, waitTimeout);
				}

				const shot = await browser.screenshot({ format: 'base64', fullPage }) as any;
				const data = shot.data ?? (shot instanceof Buffer ? shot.toString('base64') : '');
				const binary = await this.helpers.prepareBinaryData(
					Buffer.from(data, 'base64'),
					'captcha-scrape.png',
					'image/png',
				);

				const json: Record<string, unknown> = {
					url,
					geo,
					schedule_id: scheduleId,
				};
				if (extractHtmlFlag) {
					json.html = await extractHtml(browser, htmlSelector);
				}

				out.push({ json: json as any, binary: { data: binary } });
			} finally {
				if (browser) {
					try { await browser.close(); } catch { /* ignore */ }
				}
				try { await client.close(); } catch { /* ignore */ }
			}
		}
		return [out];
	}
}
