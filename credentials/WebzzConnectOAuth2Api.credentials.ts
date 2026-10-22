import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * WebzzConnect OAuth2 (authorization code + PKCE S256) as a public client.
 *
 * The client id belongs to the Webzz-managed "WebzzConnect for n8n" OAuth app and is not a secret.
 * There is no client secret: n8n's `pkce` grant sends `code_challenge` (S256) on authorize and
 * `code_verifier` on the token exchange, and a public client refreshes with `client_id` alone
 * (`authentication: body`).
 */
export class WebzzConnectOAuth2Api implements ICredentialType {
	name = 'webzzConnectOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'WebzzConnect OAuth2 API';

	icon: Icon = {
		light: 'file:../nodes/WebzzConnect/webzzconnect.svg',
		dark: 'file:../nodes/WebzzConnect/webzzconnect.dark.svg',
	};

	documentationUrl = 'https://api-connect.webzz.cloud';

	properties: INodeProperties[] = [
		{
			displayName: 'For n8n Cloud. On self-hosted n8n, use WebzzConnect API.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://connect.webzz.cloud/oauth/authorize',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://connect.webzz.cloud/oauth/token',
			required: true,
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'hidden',
			default: '-nXfHxzbF6UryNF2eXwo2ufe3tbvUA2rbTZ-k6Mz-gM',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'contacts:edit deals:edit conversations:reply conversations:assign conversations:resolve',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];
}
