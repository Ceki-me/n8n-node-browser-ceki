import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Ceki agent token (ag_...). Авторизует все Ceki-ноды.
 * Получить: панель ceki → профиль агента → API key.
 */
export class CekiApi implements ICredentialType {
	name = 'cekiApi';
	displayName = 'Ceki API';
	documentationUrl = 'https://browser.ceki.me/docs#api-key';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Agent token (ag_...). [Get your API key →](https://browser.ceki.me/docs#api-key)',
			required: true,
		},
	];
}
