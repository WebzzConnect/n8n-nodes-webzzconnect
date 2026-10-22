import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeProperties,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const BASE_URL = 'https://connect.webzz.cloud';

export const API_KEY_CREDENTIAL = 'webzzConnectApi';
export const PKCE_CREDENTIAL = 'webzzConnectOAuth2Api';

/** Shared "Authentication" selector of both nodes. API key is the default (self-hosted n8n). */
export const authenticationProperty: INodeProperties = {
	displayName: 'Authentication',
	name: 'authentication',
	type: 'options',
	options: [
		{ name: 'API Key', value: 'apiKey' },
		{ name: 'OAuth2', value: 'oAuth2' },
	],
	default: 'apiKey',
	description:
		'For a chatbot flow, use an API key: its messages arrive with sender null ("Sent by &lt;key name&gt;"), so they never match the human-reply rule in the trigger\'s New Message description. Messages sent through OAuth show the connected user as sender.',
};

export type WzContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

interface RequestOptions {
	qs?: IDataObject;
	body?: IDataObject;
	/** Path is used as-is below the base URL instead of below /api/v1/accounts/:id. */
	absolute?: boolean;
}

export interface ErrorInfo {
	status?: number;
	message: string;
	retryAfter?: string;
	body?: IDataObject;
}

export function digitsOnly(value: string): string {
	return value.replace(/\D/g, '');
}

/** Drops the wz_-prefixed keys (internal fields) at any depth. */
export function stripInternalKeys<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((entry) => stripInternalKeys(entry)) as unknown as T;
	}
	if (value !== null && typeof value === 'object') {
		const clean: IDataObject = {};
		for (const [key, entry] of Object.entries(value as IDataObject)) {
			if (key.startsWith('wz_')) continue;
			clean[key] = stripInternalKeys(entry);
		}
		return clean as T;
	}
	return value;
}

/** The credential type selected in the node's Authentication parameter. */
export function getCredentialName(this: WzContext): string {
	// Execute contexts take (name, itemIndex, fallback); load-options and hook contexts (name, fallback).
	const selected =
		'getInputData' in this
			? this.getNodeParameter('authentication', 0, 'apiKey')
			: this.getNodeParameter('authentication', 'apiKey');
	return selected === 'oAuth2' ? PKCE_CREDENTIAL : API_KEY_CREDENTIAL;
}

// token_info lookups for API-key credentials, remembered for the lifetime of one execution context.
const accountIdCache = new WeakMap<object, string>();

async function sendRequest(
	this: WzContext,
	method: IHttpRequestMethods,
	url: string,
	options: RequestOptions,
): Promise<unknown> {
	const requestOptions: IHttpRequestOptions = {
		method,
		url,
		json: true,
		headers: { Accept: 'application/json' },
	};
	if (options.qs && Object.keys(options.qs).length > 0) requestOptions.qs = options.qs;
	if (options.body && Object.keys(options.body).length > 0) requestOptions.body = options.body;
	return await this.helpers.httpRequestWithAuthentication.call(
		this,
		getCredentialName.call(this),
		requestOptions,
	);
}

/** The WebzzConnect account id: from the OAuth token response, else from token_info. */
export async function getAccountId(this: WzContext): Promise<string> {
	const credentialName = getCredentialName.call(this);
	if (credentialName === PKCE_CREDENTIAL) {
		const credentials = await this.getCredentials(credentialName);
		const tokenData = credentials.oauthTokenData as IDataObject | undefined;
		if (tokenData?.account_id !== undefined && tokenData.account_id !== null) {
			return String(tokenData.account_id);
		}
	}
	const cached = accountIdCache.get(this);
	if (cached !== undefined) return cached;
	const info = (await sendRequest.call(
		this,
		'GET',
		`${BASE_URL}/api/v1/token_info`,
		{},
	)) as IDataObject;
	const account = info.account as IDataObject | undefined;
	if (account?.id === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			'Could not determine the WebzzConnect account for this credential. Check the API key, or reconnect the OAuth credential.',
		);
	}
	const accountId = String(account.id);
	accountIdCache.set(this, accountId);
	return accountId;
}

/**
 * An id for a request path. WebzzConnect ids are numbers; anything else (e.g. `5/../contacts/1`)
 * is refused before a request is made, so a mapped value can never change the path.
 */
export function pathId(this: WzContext, value: unknown): string {
	const id = String(value ?? '').trim();
	if (!/^\d+$/.test(id)) {
		throw new NodeOperationError(this.getNode(), `"${String(value)}" is not a valid ID (a number)`);
	}
	return id;
}

/** Request below /api/v1/accounts/:id. Throws the original error (see handleApiError). */
export async function wzRawRequest(
	this: WzContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<unknown> {
	if (options.absolute) {
		return await sendRequest.call(this, method, `${BASE_URL}${path}`, options);
	}
	const accountId = await getAccountId.call(this);
	return await sendRequest.call(
		this,
		method,
		`${BASE_URL}/api/v1/accounts/${pathId.call(this, accountId)}${path}`,
		options,
	);
}

/** Pulls status, server message and Retry-After out of the several shapes n8n errors take. */
export function readErrorInfo(error: unknown): ErrorInfo {
	const err = error as {
		httpCode?: string | number;
		statusCode?: number;
		status?: number;
		message?: string;
		response?: { status?: number; headers?: IDataObject; data?: unknown; body?: unknown };
		cause?: {
			response?: { status?: number; headers?: IDataObject; data?: unknown; body?: unknown };
			status?: number;
		};
		context?: { data?: unknown };
		description?: string;
	};
	const response = err.response ?? err.cause?.response;
	const rawStatus =
		err.httpCode ?? err.statusCode ?? err.status ?? response?.status ?? err.cause?.status;
	const status = rawStatus !== undefined ? Number(rawStatus) : undefined;

	let body: unknown = response?.data ?? response?.body ?? err.context?.data;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body);
		} catch {
			// keep the raw string
		}
	}
	const bodyObject = body !== null && typeof body === 'object' ? (body as IDataObject) : undefined;

	let message = '';
	if (bodyObject) {
		const direct = bodyObject.message ?? bodyObject.error_description ?? bodyObject.error;
		if (typeof direct === 'string') message = direct;
		else if (Array.isArray(bodyObject.errors)) message = (bodyObject.errors as string[]).join(', ');
	} else if (typeof body === 'string') {
		message = body;
	}

	const headers = (response?.headers ?? {}) as IDataObject;
	const retryAfter = headers['retry-after'] ?? headers['Retry-After'];

	return {
		status: Number.isFinite(status) ? status : undefined,
		message: message || err.description || err.message || 'Unknown error',
		retryAfter: retryAfter !== undefined ? String(retryAfter) : undefined,
		body: bodyObject,
	};
}

/** Turns an API failure into a readable NodeApiError. */
export function handleApiError(this: WzContext, error: unknown): never {
	if (error instanceof NodeOperationError) throw error;
	const info = readErrorInfo(error);
	const options: { message: string; description?: string; httpCode?: string } = {
		message: info.message,
	};
	if (info.status !== undefined) options.httpCode = String(info.status);

	if (info.status === 429) {
		options.message = 'WebzzConnect rate limit reached';
		options.description = info.retryAfter
			? `Too many requests. WebzzConnect asks you to retry after ${info.retryAfter} seconds (Retry-After). Add a Wait node or enable "Retry On Fail" for this node.`
			: 'Too many requests. Wait a moment and retry, or enable "Retry On Fail" for this node. Contact search is limited to 100 requests per minute per account.';
	} else if (info.status === 403) {
		options.message = info.message || 'Forbidden';
		options.description =
			'The API key or OAuth consent does not allow this action (insufficient scope or inbox restriction). Check the key\'s permissions in WebzzConnect, or reconnect the OAuth credential and approve all requested permissions.';
	} else if (info.status === 401) {
		options.description =
			'The WebzzConnect API key or access token was rejected. Check the API key (it may have been revoked), or reconnect the OAuth credential. A password change in WebzzConnect revokes OAuth connections.';
	}
	throw new NodeApiError(this.getNode(), error as JsonObject, options);
}

/**
 * The error to throw for a failed item. Re-wrapping a NodeApiError or NodeOperationError hands
 * back the original unchanged (options ignored), so the item index is set on it directly.
 */
export function errorForItem(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, { itemIndex });
}

/** Request below /api/v1/accounts/:id with readable errors. */
export async function wzApiRequest(
	this: WzContext,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<unknown> {
	try {
		return await wzRawRequest.call(this, method, path, options);
	} catch (error) {
		return handleApiError.call(this, error);
	}
}

interface PaginateOptions {
	qs?: IDataObject;
	returnAll: boolean;
	limit: number;
	/** Items per page the endpoint returns. Used to detect the last page. */
	pageSize: number;
	extract: (response: unknown) => IDataObject[];
	hasMore?: (response: unknown, items: IDataObject[]) => boolean;
}

/** Page-number pagination shared by the list and search endpoints. */
export async function wzPaginate(
	this: WzContext,
	path: string,
	options: PaginateOptions,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let page = 1;
	for (let guard = 0; guard < 1000; guard++) {
		const response = await wzApiRequest.call(this, 'GET', path, {
			qs: { ...(options.qs ?? {}), page },
		});
		const items = options.extract(response);
		results.push(...items);
		if (!options.returnAll && results.length >= options.limit) break;
		const more = options.hasMore
			? options.hasMore(response, items)
			: items.length >= options.pageSize;
		if (!more || items.length === 0) break;
		page++;
	}
	return options.returnAll ? results : results.slice(0, options.limit);
}

/** List endpoints answer an array, `{ payload: [...] }` or `{ data: [...] }`. */
export function asArray(response: unknown): IDataObject[] {
	if (Array.isArray(response)) return response as IDataObject[];
	const root = asObject(response);
	for (const key of ['payload', 'data']) {
		if (Array.isArray(root[key])) return root[key] as IDataObject[];
	}
	return [];
}

export function asObject(value: unknown): IDataObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: {};
}

/** Contact endpoints answer `{ payload: { contact } }`, `{ payload: contact }` or the contact itself. */
export function unwrapContact(response: unknown): IDataObject {
	const root = asObject(response);
	const payload = asObject(root.payload);
	if (Object.keys(payload).length > 0) {
		const nested = asObject(payload.contact);
		return Object.keys(nested).length > 0 ? nested : payload;
	}
	return root;
}

/** Keys of a fixedCollection of name/value pairs as an object. */
export function pairsToObject(pairs: IDataObject | undefined): IDataObject {
	const out: IDataObject = {};
	const entries = (pairs?.values as IDataObject[] | undefined) ?? [];
	for (const entry of entries) {
		const key = String(entry.key ?? '').trim();
		if (key) out[key] = entry.value as string;
	}
	return out;
}

/** Loose phone comparison: equal digits, or one is the national form (leading 0s dropped) of the other. */
export function phonesMatch(a: string, b: string): boolean {
	const da = digitsOnly(a);
	const db = digitsOnly(b);
	if (!da || !db) return false;
	if (da === db) return true;
	const sa = da.replace(/^0+/, '');
	const sb = db.replace(/^0+/, '');
	if (sa.length < 7 || sb.length < 7) return false;
	return sa.endsWith(sb) || sb.endsWith(sa);
}
