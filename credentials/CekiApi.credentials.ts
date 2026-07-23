import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Ceki agent token (ag_...). Authorizes every Ceki node.
 * Get it from the Ceki panel → agent profile → API key.
 */
export class CekiApi implements ICredentialType {
	name = 'cekiApi';
	displayName = 'Ceki API';
	icon = { light: 'file:ceki-light.svg', dark: 'file:ceki-dark.svg' } as const;
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

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials?.token}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.ceki.me',
			url: '/api/browsers/search',
			method: 'GET',
		},
	};
}
