import type { IExecuteFunctions, INodeType, INodeTypeDescription, INodeExecutionData } from 'n8n-workflow';
import { connect } from '@ceki/sdk';

/**
 * Recipe: Screenshot in Geo.
 * One call — rent a browser in the requested geo, open a URL, take a screenshot, release.
 */
export class CekiScreenshotGeo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Ceki: Screenshot in Geo',
		name: 'cekiScreenshotGeo',
		description: 'Rent a browser in a given geo, screenshot a page, release',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '=rent in {{ $geo }} → screenshot → release',
		defaults: { name: 'Browser Ceki: Screenshot in Geo' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'cekiApi', required: true }],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: 'https://ifconfig.me',
				required: true,
			},
			{ displayName: 'Geo', name: 'geo', type: 'string', default: 'RU', placeholder: 'RU, EE, US…' },
			{ displayName: 'Full page', name: 'fullPage', type: 'boolean', default: false },
			{ displayName: 'Max $/min', name: 'maxPrice', type: 'number', default: 0.02 },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const creds = await this.getCredentials('cekiApi');

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const geo = this.getNodeParameter('geo', i) as string;
			const fullPage = this.getNodeParameter('fullPage', i) as boolean;
			const maxPrice = this.getNodeParameter('maxPrice', i) as number;

			const client = await connect(creds.token as string);
			let browser: any;
			try {
				const list = await client.search({ geo, max_price_per_min: maxPrice });
				if (!list.length) throw new Error(`No browsers in geo ${geo}`);
				browser = await client.rent(list[0].schedule_id);
				await browser.navigate(url);
				const shot = (await browser.screenshot({ format: 'base64', fullPage })) as any;
				const binary = await this.helpers.prepareBinaryData(
					Buffer.from(shot.data, 'base64'),
					'screenshot.png',
					'image/png',
				);
				out.push({
					json: { url, geo, schedule_id: list[0].schedule_id },
					binary: { data: binary },
				});
			} finally {
				if (browser) { try { await browser.close(); } catch {} }
				try { await client.close(); } catch {}
			}
		}
		return [out];
	}
}
