import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * WebzzConnect API key (a `wcak_` account key). Sent as a Bearer token; each key belongs to one
 * account and carries the scopes (and optional inbox allow-list) chosen when it was created.
 */
export class WebzzConnectApi implements ICredentialType {
	name = 'webzzConnectApi';

	displayName = 'WebzzConnect API';

	icon: Icon = {
		light: 'file:../nodes/WebzzConnect/webzzconnect.svg',
		dark: 'file:../nodes/WebzzConnect/webzzconnect.dark.svg',
	};

	documentationUrl = 'https://api-connect.webzz.cloud';

	properties: INodeProperties[] = [
		{
			displayName:
				'Use on self-hosted n8n. Create the key in WebzzConnect > Settings > API keys (admins).',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://connect.webzz.cloud',
			url: '/api/v1/token_info',
		},
	};
}
