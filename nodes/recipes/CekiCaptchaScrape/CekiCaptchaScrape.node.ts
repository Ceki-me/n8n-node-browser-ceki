import type { IExecuteFunctions, INodeType, INodeTypeDescription, INodeExecutionData } from 'n8n-workflow';
import { connect } from '@ceki/sdk';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ждём появления селектора в DOM через CDP Runtime.evaluate.
 * CDP allowlist main-mode разрешает Runtime.evaluate (используется в paste/copy).
 */
async function waitForSelector(browser: any, selector: string, timeoutMs: number, intervalMs = 500) {
	const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const res = (await browser.send({
				method: 'Runtime.evaluate',
				params: { expression: expr, returnByValue: true },
			})) as any;
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

/** Вытащить outerHTML первого элемента по селектору (или весь <body>). */
async function extractHtml(browser: any, selector: string): Promise<string> {
	const expr =
		selector.trim() === '' || selector === 'body'
			? `document.body ? document.body.outerHTML : ''`
			: `(function(){ var el = document.querySelector(${JSON.stringify(selector)}); return el ? el.outerHTML : ''; })()`;
	const res = (await browser.send({
		method: 'Runtime.evaluate',
		params: { expression: expr, returnByValue: true },
	})) as any;
	return (res?.result?.value as string) ?? '';
}

/**
 * Recipe: Captcha-protected Scrape.
 * Арендовать human-браузер → открыть URL → (опц.) дождаться селектора →
 * запросить решение капчи у человека (requestCaptcha) → снять snapshot/HTML → отпустить.
 *
 * Это коронной юзкейс ceki: anti-bot-сайт проходит за счёт реального fingerprint,
 * капчу решает живой человек (provider/solver).
 */
export class CekiCaptchaScrape implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Ceki: Captcha-protected Scrape',
		name: 'cekiCaptchaScrape',
		description: 'Rent a human browser, wait, solve captcha via a human, snapshot/HTML, release',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '=rent in {{ $geo }} → captcha → snapshot',
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
				description: 'Wait until this selector appears in the DOM before requesting captcha',
			},
			{
				displayName: 'Wait Timeout (ms)',
				name: 'waitTimeout',
				type: 'number',
				default: 30000,
			},
			{
				displayName: 'Request Captcha',
				name: 'requestCaptcha',
				type: 'boolean',
				default: true,
				description: 'Ask a human to solve the captcha via requestCaptcha',
			},
			{
				displayName: 'Auto-accept Solved Work',
				name: 'autoAccept',
				type: 'boolean',
				default: true,
				description: 'Automatically accept (pay) the solver when captcha is solved',
			},
			{
				displayName: 'Acceptance Timeout (ms)',
				name: 'acceptanceTimeout',
				type: 'number',
				default: 60000,
				description: 'Time to wait for a human to pick up the captcha task',
			},
			{
				displayName: 'Completion Timeout (ms)',
				name: 'completionTimeout',
				type: 'number',
				default: 180000,
				description: 'Time to wait for the human to solve after pickup',
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
			const wantCaptcha = this.getNodeParameter('requestCaptcha', i) as boolean;
			const autoAccept = this.getNodeParameter('autoAccept', i) as boolean;
			const acceptanceTimeout = this.getNodeParameter('acceptanceTimeout', i) as number;
			const completionTimeout = this.getNodeParameter('completionTimeout', i) as number;
			const extractHtmlFlag = this.getNodeParameter('extractHtml', i) as boolean;
			const htmlSelector = (this.getNodeParameter('htmlSelector', i) as string) || 'body';
			const fullPage = this.getNodeParameter('fullPage', i) as boolean;

			const client = await connect(creds.token as string);
			let browser: any;
			let scheduleId = 0;
			let captchaSolved: boolean | null = null;
			try {
				const list = await client.search({ geo: geo || undefined, max_price_per_min: maxPrice });
				if (!list.length) throw new Error(`No browsers in geo ${geo || '*'}`);
				scheduleId = list[0].schedule_id as number;
				browser = await client.rent(scheduleId);

				await browser.navigate(url);

				if (waitSelector) {
					await waitForSelector(browser, waitSelector, waitTimeout);
				}

				if (wantCaptcha) {
					const result = (await browser.requestCaptcha({
						acceptanceTimeout,
						completionTimeout,
						autoAccept,
					})) as {
						solved: boolean;
						cancelReason: string | null;
						acceptWork: () => Promise<void>;
						rejectWork: (r?: string) => Promise<void>;
					};
					captchaSolved = result.solved;
					if (!result.solved) {
						// не решена — отказываем solver'у (не оплачиваем), кидаем ошибку
						await result.rejectWork(result.cancelReason ?? 'not solved');
						throw new Error(`Captcha not solved: ${result.cancelReason ?? 'unknown'}`);
					}
					// autoAccept=true — SDK уже принял; иначе подтверждаем оплату руками
					if (!autoAccept) await result.acceptWork();
				}

				// после капчи страница обычно перезагружается — снова ждём селектор/стабилизации
				if (waitSelector) {
					try {
						await waitForSelector(browser, waitSelector, waitTimeout);
					} catch {
						/* не критично — снимаем что есть */
					}
				}

				const shot = (await browser.screenshot({ format: 'base64', fullPage })) as any;
				const data = shot.data ?? shot.toString('base64');
				const binary = await this.helpers.prepareBinaryData(
					Buffer.from(data, 'base64'),
					'captcha-scrape.png',
					'image/png',
				);

				const json: Record<string, unknown> = {
					url,
					geo,
					schedule_id: scheduleId,
					captcha_requested: wantCaptcha,
					captcha_solved: captchaSolved,
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
