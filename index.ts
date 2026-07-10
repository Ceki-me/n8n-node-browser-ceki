import { BrowserCeki } from './nodes/BrowserCeki/BrowserCeki.node';
import { CekiContract } from './nodes/CekiContract/CekiContract.node';
import { CekiCaptchaScrape } from './nodes/recipes/CekiCaptchaScrape/CekiCaptchaScrape.node';
import { CekiScreenshotGeo } from './nodes/recipes/CekiScreenshotGeo/CekiScreenshotGeo.node';
import { CekiApi } from './credentials/CekiApi.credentials';

export const nodes = [
	BrowserCeki,
	CekiContract,
	CekiCaptchaScrape,
	CekiScreenshotGeo,
];

export const credentials = [
	CekiApi,
];
