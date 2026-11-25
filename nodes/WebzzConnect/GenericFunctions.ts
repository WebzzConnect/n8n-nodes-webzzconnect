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

export const BASE_URL = 'https://app.webzz.io';

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
		'To answer customers as a bot, use a key that acts as a virtual agent, or OAuth with Connect as → A virtual agent. The flow then sees and answers only that agent\'s conversations. For other flows, an account key\'s messages arrive with sender null.',
};

/** Client-side refusals and server refusals mapped by `[status]:code` (product.md Copy). */
export const COPY = {
	handoffOneTarget:
		'A virtual agent hands a conversation to one target: a person, another virtual agent, or your team. Choose an agent or a team, not both. Nothing was changed. (handoff_one_target)',
	connectionKindUnknown:
		"Couldn't check which kind of connection this is, so nothing was changed. Run again. (connection_kind_unknown)",
	assignNoTarget:
		'Choose a person or virtual agent to assign. To remove the assignee, use Unassign. Nothing was changed. (assign_no_target)',
	contactNotVisible:
		'[422] This contact may already exist, but this virtual agent sees only the contacts of conversations it handles. To create or update contacts across the account, use an account key or an "as me" connection.',
};

export const ERROR_COPY: Record<string, string> = {
	'409:not_handling':
		'[409] This virtual agent isn\'t handling this conversation any more: a person took it, it was handed off, or it\'s resolved. Stop the flow for this conversation. (not_handling)',
	'422:assignee_not_available':
		'[422] That person or virtual agent can\'t take this conversation: unknown, removed, or not in the conversation\'s inbox. Nothing was changed. (assignee_not_available)',
	'422:conversation_resolved':
		'[422] A virtual agent can\'t be assigned to a resolved conversation. Reopen it first, or assign a person. (conversation_resolved)',
	'422:handoff_note_not_allowed':
		'[422] Only the virtual agent handling this conversation can add a hand-off note, and only when it hands the conversation to someone. Remove the note, or use a virtual agent connection. Nothing was changed. (handoff_note_not_allowed)',
	'422:handoff_note_invalid':
		'[422] The hand-off note must be 1 to 500 characters. Nothing was changed. (handoff_note_invalid)',
};

/** Codes of a plain permission refusal: these keep the generic 403 explanation. */
const GENERIC_AUTH_CODES = new Set(['forbidden', 'insufficient_scope']);

/** Extra guidance under the server's message, by code. */
const CODE_DESCRIPTIONS: Record<string, string> = {
	feature_disabled:
		"The credential is valid, but this account's plan doesn't include this area. An account owner can change the plan.",
	limit_exceeded:
		'The account reached a plan limit. Remove unused items (for webhooks: other active trigger workflows) or upgrade the plan.',
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

// token_info answers, remembered for the lifetime of one execution context (never module-level).
const tokenInfoCache = new WeakMap<object, IDataObject>();

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
	const account = (await getTokenInfo.call(this)).account as IDataObject | undefined;
	if (account?.id === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			'Could not determine the WebzzConnect account for this credential. Check the API key, or reconnect the OAuth credential.',
		);
	}
	return String(account.id);
}

/** The token_info body of the credential in use: kind, account, user, virtual_agent. */
async function getTokenInfo(this: WzContext): Promise<IDataObject> {
	const cached = tokenInfoCache.get(this);
	if (cached !== undefined) return cached;
	const info = (await sendRequest.call(
		this,
		'GET',
		`${BASE_URL}/api/v1/token_info`,
		{},
	)) as IDataObject;
	tokenInfoCache.set(this, info);
	return info;
}

/** getTokenInfo with readable errors, for steps that decide on `kind` before any write. */
export async function getConnectionInfo(this: WzContext): Promise<IDataObject> {
	try {
		return await getTokenInfo.call(this);
	} catch (error) {
		return handleApiError.call(this, error);
	}
}

/**
 * An id for a request path. WebzzConnect ids are numbers; anything else (e.g. `5/../contacts/1`)
 * is refused before a request is made, so a mapped value can never change the path.
 */
export function pathId(this: WzContext, value: unknown, label?: string): string {
	const id = String(value ?? '').trim();
	if (!/^\d+$/.test(id)) {
		if (label) {
			throw new NodeOperationError(
				this.getNode(),
				`'${label}' must be a number, but got "${String(value)}"`,
				{ description: 'Use the numeric ID shown in WebzzConnect, or map a number from an earlier node' },
			);
		}
		throw new NodeOperationError(this.getNode(), `Expected a numeric ID, but got "${String(value)}"`);
	}
	return id;
}

/**
 * The picker value of an assignee: `5` / `User:5` (a person) or `AgentBot:5` (a virtual agent).
 * Empty answers undefined. Zero or a non-numeric id is refused before any request: the server
 * reads 0 and "" as "nobody", and Number("AgentBot:5") is NaN, which JSON turns into null.
 */
export function parseAssignee(
	this: WzContext,
	value: unknown,
): { id: string; type: 'User' | 'AgentBot' } | undefined {
	const raw = String(value ?? '').trim();
	if (raw === '') return undefined;
	const match = /^(?:(User|AgentBot):)?(\d+)$/.exec(raw);
	if (!match) {
		throw new NodeOperationError(
			this.getNode(),
			`'Agent Name or ID' must be a number, or AgentBot:number for a virtual agent, but got "${raw}". Choose the agent from the list.`,
		);
	}
	if (/^0+$/.test(match[2])) throw new NodeOperationError(this.getNode(), COPY.assignNoTarget);
	return { id: match[2], type: match[1] === 'AgentBot' ? 'AgentBot' : 'User' };
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
		message: message || err.description || err.message || 'WebzzConnect gave no details about what went wrong',
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

	const code = String(info.body?.error_code ?? info.body?.error ?? '');
	const copy = ERROR_COPY[`${info.status}:${code}`];

	const serverMessage = typeof info.body?.message === 'string' ? info.body.message : '';

	if (copy) {
		options.message = copy;
	} else if (
		/^[a-z0-9_]+$/.test(code) &&
		!GENERIC_AUTH_CODES.has(code) &&
		serverMessage &&
		info.status !== 429
	) {
		// A coded refusal (plan area, plan limit, pipeline access, ...): the server's message is the
		// product sentence.
		options.message = `[${info.status}] ${serverMessage} (${code})`;
		if (CODE_DESCRIPTIONS[code]) options.description = CODE_DESCRIPTIONS[code];
	} else if (info.status === 429) {
		options.message = 'WebzzConnect rate limit reached';
		options.description = info.retryAfter
			? `Too many requests. WebzzConnect asks you to retry after ${info.retryAfter} seconds (Retry-After). Add a Wait node or enable 'Retry On Fail' for this node.`
			: "Too many requests. Wait a moment and retry, or enable 'Retry On Fail' for this node. Contact search is limited to 100 requests per minute per account.";
	} else if (info.status === 403) {
		options.message = `[403] This connection isn't allowed to do this. For a virtual agent its role decides; for an API key, its scopes and inboxes; for OAuth, what was approved at consent. (${info.message})`;
	} else if (info.status === 401) {
		options.description =
			'The WebzzConnect API key or access token was rejected. Check the API key (it may have been revoked), or reconnect the OAuth credential. A password change in WebzzConnect revokes OAuth connections.';
	}
	const apiError = new NodeApiError(this.getNode(), error as JsonObject, options);
	// NodeApiError replaces a given description with the response body's `message`: keep ours.
	if (options.description) apiError.description = options.description;
	throw apiError;
}

/**
 * A send answers 2xx even when WebzzConnect refused to send at once (e.g. the monthly active
 * contacts limit): the returned message then has status `failed`. Later failures (WhatsApp's
 * 24-hour window, delivery) arrive asynchronously and are not seen here.
 */
export function assertNotFailed(
	this: WzContext,
	message: unknown,
	itemIndex: number,
): void {
	if (message === null || typeof message !== 'object') return;
	const { status, failure_code: failureCode } = message as IDataObject;
	if (status !== 'failed') return;
	const code = typeof failureCode === 'string' && failureCode ? failureCode : 'failed';
	const text =
		code === 'monthly_active_contacts_limit_reached'
			? "The message wasn't sent: the account reached its monthly active contacts limit. An account owner can upgrade the plan."
			: "The message wasn't sent. Open the conversation in WebzzConnect to see the reason.";
	throw new NodeOperationError(this.getNode(), `${text} (${code})`, { itemIndex });
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

/** Content of the last entry of a conversation's `messages` (the API includes only the latest one). */
function lastMessageContent(conversation: IDataObject): IDataObject[string] {
	const messages = Array.isArray(conversation.messages) ? (conversation.messages as unknown[]) : [];
	if (messages.length === 0) return null;
	return asObject(messages[messages.length - 1]).content ?? null;
}

function pick(source: IDataObject, keys: string[]): IDataObject {
	const out: IDataObject = {};
	for (const key of keys) if (key in source) out[key] = source[key];
	return out;
}

/** Simplify: the contact fields a flow usually needs (at most 10 keys). */
export function simplifyContact(contact: IDataObject): IDataObject {
	return pick(contact, [
		'id',
		'name',
		'email',
		'phone_number',
		'identifier',
		'blocked',
		'custom_attributes',
		'last_activity_at',
		'created_at',
	]);
}

/** Simplify: the deal fields a flow usually needs (at most 10 keys). */
export function simplifyDeal(deal: IDataObject): IDataObject {
	const out = pick(deal, ['id', 'title', 'value', 'currency', 'status', 'pipeline_id', 'stage_id']);
	const contact = asObject(deal.contact);
	out.contact =
		Object.keys(contact).length > 0 ? pick(contact, ['id', 'name', 'phone_number', 'email']) : null;
	const owner = asObject(deal.owner);
	out.owner = Object.keys(owner).length > 0 ? pick(owner, ['id', 'name']) : null;
	if ('updated_at' in deal) out.updated_at = deal.updated_at;
	return out;
}

/** Simplify: the conversation fields a flow usually needs (at most 10 keys). */
export function simplifyConversation(conversation: IDataObject): IDataObject {
	const meta = asObject(conversation.meta);
	const sender = asObject(meta.sender);
	const assignee = asObject(meta.assignee);
	return {
		id: conversation.id,
		status: conversation.status,
		inbox_id: conversation.inbox_id,
		contact: Object.keys(sender).length > 0 ? pick(sender, ['id', 'name', 'phone_number']) : null,
		assignee: Object.keys(assignee).length > 0 ? pick(assignee, ['id', 'name']) : null,
		labels: conversation.labels,
		custom_attributes: conversation.custom_attributes,
		last_message: lastMessageContent(conversation),
		unread_count: conversation.unread_count,
		last_activity_at: conversation.last_activity_at,
	};
}
