// Unit tests against the built package (run `npm run build` first). Uses node:test, no extra deps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');

const { WebzzConnectTrigger } = require('../dist/nodes/WebzzConnectTrigger/WebzzConnectTrigger.node.js');
const { WebzzConnect } = require('../dist/nodes/WebzzConnect/WebzzConnect.node.js');
const { errorForItem } = require('../dist/nodes/WebzzConnect/GenericFunctions.js');

const node = { name: 'WebzzConnect', type: 'webzzConnect', typeVersion: 1, position: [0, 0], parameters: {} };
const BASE = 'https://app.webzz.io';

function hookContext({ stored, webhookUrl, subscription, parameters: extra = {} }) {
	const parameters = { authentication: 'oAuth2', ...extra };
	const calls = [];
	const ctx = {
		getNode: () => node,
		getWorkflowStaticData: () => stored,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
		getCredentials: async () => ({ oauthTokenData: { account_id: 7 } }),
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ method: options.method, url: options.url, body: options.body, credential });
				if (options.method === 'GET') return subscription;
				if (options.method === 'POST') return { id: 99, secret: 'new-secret', ...options.body };
				return undefined;
			},
		},
	};
	return { ctx, calls };
}

const hooks = new WebzzConnectTrigger().webhookMethods.default;

test('checkExists: same URL keeps the subscription', async () => {
	const stored = { id: 5, secret: 's' };
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const { ctx, calls } = hookContext({ stored, webhookUrl: url, subscription: { id: 5, url } });
	assert.equal(await hooks.checkExists.call(ctx), true);
	assert.deepEqual(stored, { id: 5, secret: 's' });
	assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('checkExists: a changed webhook URL drops the old subscription and reports not exists', async () => {
	const stored = { id: 5, secret: 's' };
	const { ctx, calls } = hookContext({
		stored,
		webhookUrl: 'https://new-host.example.com/webhook/abc/webhook',
		subscription: { id: 5, url: 'https://old-host.example.com/webhook/abc/webhook' },
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
	assert.deepEqual(stored, {});
	assert.deepEqual(
		calls.map((c) => `${c.method} ${c.url}`),
		[
			`GET ${BASE}/api/v1/accounts/7/webhook_subscriptions/5`,
			`DELETE ${BASE}/api/v1/accounts/7/webhook_subscriptions/5`,
		],
	);
});

test('create: sends inbox_ids / pipeline_ids only for their events and only when selected', async () => {
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const run = async (parameters) => {
		const { ctx, calls } = hookContext({ stored: {}, webhookUrl: url, parameters });
		await hooks.create.call(ctx);
		return calls.find((c) => c.method === 'POST').body;
	};
	assert.deepEqual(
		await run({ events: ['message_created', 'deal_won'], inboxIds: ['3', '4'], pipelineIds: ['2'] }),
		{ url, subscriptions: ['message_created', 'deal_won'], inbox_ids: [3, 4], pipeline_ids: [2] },
	);
	assert.deepEqual(await run({ events: ['message_created'], inboxIds: [], pipelineIds: ['2'] }), {
		url,
		subscriptions: ['message_created'],
	});
	assert.deepEqual(await run({ events: ['contact_created'], inboxIds: ['3'] }), {
		url,
		subscriptions: ['contact_created'],
	});
});

test('errorForItem: keeps the item index on an already wrapped NodeApiError', () => {
	const original = new NodeApiError(node, { message: 'Forbidden' }, { httpCode: '403', message: 'Forbidden' });
	const thrown = errorForItem(node, original, 3);
	assert.equal(thrown, original);
	assert.equal(thrown.context.itemIndex, 3);
	assert.equal(thrown.httpCode, '403');
});

test('errorForItem: keeps the item index on a NodeOperationError and wraps raw errors', () => {
	const operational = errorForItem(node, new NodeOperationError(node, 'bad input'), 2);
	assert.ok(operational instanceof NodeOperationError);
	assert.equal(operational.context.itemIndex, 2);

	const wrapped = errorForItem(node, { message: 'boom' }, 1);
	assert.ok(wrapped instanceof NodeApiError);
	assert.equal(wrapped.context.itemIndex, 1);
});

// --- WebzzConnect node: CRM URLs and authentication ---

// Like n8n, extractValue turns a resource locator value ({ __rl, mode, value }) into its value.
function extract(value, options) {
	return options?.extractValue && value && typeof value === 'object' && value.__rl ? value.value : value;
}

function execContext({ parameters, response = {}, authentication = 'oAuth2', calls, typeVersion = 1 }) {
	return {
		getNode: () => ({ ...node, typeVersion }),
		getInputData: () => [{ json: {} }],
		continueOnFail: () => false,
		getNodeParameter: (name, _i, fallback, options) => {
			if (name === 'authentication') return authentication;
			return name in parameters ? extract(parameters[name], options) : fallback;
		},
		getCredentials: async () => ({ oauthTokenData: { account_id: 7 } }),
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ credential, method: options.method, url: options.url, qs: options.qs });
				if (options.url.endsWith('/api/v1/token_info')) return { account: { id: 42 } };
				return response;
			},
			constructExecutionMetaData: (data) => data,
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
}

async function runDeal(operation, parameters, response) {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'deal', operation, ...parameters }, response, calls });
	await new WebzzConnect().execute.call(ctx);
	return calls;
}

const A = `${BASE}/api/v1/accounts/7/crm`;

test('deal create/update/get/move/search hit /crm/deals', async () => {
	assert.deepEqual(
		(await runDeal('create', { title: 'T', contactId: '5', pipelineId: '', stageId: '' }, { id: 1 })).map(
			(c) => `${c.method} ${c.url}`,
		),
		[`POST ${A}/deals`],
	);
	assert.deepEqual(
		(await runDeal('update', { dealId: '9', updateFields: { title: 'x' } }, { id: 9 })).map((c) => `${c.method} ${c.url}`),
		[`PATCH ${A}/deals/9`],
	);
	assert.deepEqual(
		(await runDeal('get', { dealId: '9' }, { id: 9 })).map((c) => `${c.method} ${c.url}`),
		[`GET ${A}/deals/9`],
	);
	assert.deepEqual(
		(await runDeal('moveStage', { dealId: '9', stageId: '3', moveOptions: {} }, { id: 9 })).map((c) => `${c.method} ${c.url}`),
		[`POST ${A}/deals/9/move`],
	);
	const search = await runDeal('search', { filters: {}, returnAll: false, limit: 5 }, { payload: [] });
	assert.equal(search[0].method, 'GET');
	assert.equal(search[0].url, `${A}/deals`);
	for (const c of search) assert.equal(c.credential, 'webzzConnectOAuth2Api');
});

test('loadOptions: pipelines, stages and lost reasons hit /crm/...', async () => {
	const methods = new WebzzConnect().methods.loadOptions;
	const run = async (method) => {
		const calls = [];
		const ctx = {
			...execContext({ parameters: {}, response: [], calls }),
			getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
			getCurrentNodeParameter: () => '',
		};
		await methods[method].call(ctx);
		return calls.map((c) => `${c.method} ${c.url}`);
	};
	assert.deepEqual(await run('getPipelines'), [`GET ${A}/pipelines`]);
	assert.deepEqual(await run('getStages'), [`GET ${A}/pipelines`]);
	assert.deepEqual(await run('getLostReasons'), [`GET ${A}/lost_reasons`]);
});

test('trigger: pipelines load hits /crm/pipelines', async () => {
	const calls = [];
	const ctx = {
		...execContext({ parameters: {}, response: [], calls }),
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
	};
	await new WebzzConnectTrigger().methods.loadOptions.getPipelines.call(ctx);
	assert.deepEqual(calls.map((c) => c.url), [`${A}/pipelines`]);
});

test('API-key auth: uses webzzConnectApi, resolves the account from token_info once per execution', async () => {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'deal', operation: 'get', dealId: '9' }, authentication: 'apiKey', response: { id: 9 }, calls });
	ctx.getInputData = () => [{ json: {} }, { json: {} }];
	await new WebzzConnect().execute.call(ctx);
	assert.deepEqual(
		calls.map((c) => `${c.credential} ${c.method} ${c.url}`),
		[
			`webzzConnectApi GET ${BASE}/api/v1/token_info`,
			`webzzConnectApi GET ${BASE}/api/v1/accounts/42/crm/deals/9`,
			`webzzConnectApi GET ${BASE}/api/v1/accounts/42/crm/deals/9`,
		],
	);
});

test('credentials: no URL field, API key credential is a Bearer header', () => {
	const { WebzzConnectApi } = require('../dist/credentials/WebzzConnectApi.credentials.js');
	const { WebzzConnectOAuth2Api } = require('../dist/credentials/WebzzConnectOAuth2Api.credentials.js');
	const api = new WebzzConnectApi();
	const oauth = new WebzzConnectOAuth2Api();
	assert.equal(api.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	const field = (cred, name) => cred.properties.find((p) => p.name === name);
	assert.equal(field(oauth, 'baseUrl'), undefined);
	assert.equal(field(oauth, 'grantType').default, 'pkce');
	assert.equal(field(oauth, 'clientSecret').default, '');
	assert.equal(field(oauth, 'clientId').default, '-nXfHxzbF6UryNF2eXwo2ufe3tbvUA2rbTZ-k6Mz-gM');
	assert.equal(field(oauth, 'authUrl').default, 'https://app.webzz.io/oauth/authorize');
	assert.equal(field(oauth, 'accessTokenUrl').default, 'https://app.webzz.io/oauth/token');
	assert.equal(api.test.request.baseURL, 'https://app.webzz.io');
	assert.equal(api.documentationUrl, 'https://api-docs.webzz.io');
	assert.equal(oauth.documentationUrl, 'https://api-docs.webzz.io');
});

// --- Conversation actions ---

const C = `${BASE}/api/v1/accounts/7/conversations`;

async function runConversation(operation, parameters, conversation = {}) {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'conversation', operation, ...parameters }, calls });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ credential, method: options.method, url: options.url, body: options.body });
		return options.method === 'GET' ? conversation : {};
	};
	const out = await new WebzzConnect().execute.call(ctx);
	return { calls, out };
}

const summary = (calls) => calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.body ?? null)}`);

// Scripted run: `handler(method, path, body)` answers each request (path is below the account, token_info is absolute).
function refusal(status, body) {
	return { httpCode: String(status), message: `status ${status}`, response: { status, data: body } };
}

async function script(resource, operation, parameters, handler, authentication = 'oAuth2') {
	const calls = [];
	const ctx = execContext({ parameters: { resource, operation, ...parameters }, authentication, calls });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body, qs: options.qs });
		const path = options.url.replace(`${BASE}/api/v1/accounts/7`, '').replace(BASE, '');
		const answer = await handler(options.method, path, options.body);
		if (answer?.httpCode) throw answer;
		return answer;
	};
	const out = await new WebzzConnect().execute.call(ctx);
	return { calls, out: out[0].map((entry) => entry.json) };
}
const posts = (calls) => calls.filter((c) => c.method === 'POST').map((c) => c.body);
const kindOf = (kind) => ({ account: { id: 7 }, kind });

const bot = { id: 5, name: 'Sales bot' };
const okAssign = (kind = 'account_key', held = { id: 4, meta: { assignee: { id: 11 } } }) => (method, path) => {
	if (path === '/api/v1/token_info') return kindOf(kind);
	if (method === 'GET') return held;
	return path.endsWith('/assignments') ? { id: 3, name: 'Sales' } : {};
};

test('assign: the picker value decides assignee_id (a string) and assignee_type', async () => {
	for (const [value, id, type] of [
		['11', '11', 'User'],
		[' 5', '5', 'User'],
		['User:7', '7', 'User'],
		['AgentBot:5', '5', 'AgentBot'],
		['AgentBot:05', '05', 'AgentBot'],
	]) {
		const { calls } = await script('conversation', 'assign', { conversationId: '4', agentId: value }, okAssign());
		assert.deepEqual(posts(calls), [{ assignee_id: id, assignee_type: type }]);
	}
});

test('assign: zero, fractional and non-numeric agents are refused with no request', async () => {
	for (const value of ['0', '00', 'AgentBot:0', '5.0', 'AgentBot:x', '5abc', '-1']) {
		const calls = [];
		await assert.rejects(
			script('conversation', 'assign', { conversationId: '4', agentId: value }, (m, p) => {
				calls.push(p);
				return {};
			}),
			NodeOperationError,
			value,
		);
		assert.equal(calls.length, 0, value);
	}
	await assert.rejects(
		script('conversation', 'assign', { conversationId: '4', agentId: '0' }, () => ({})),
		/Choose a person or virtual agent to assign.*\(assign_no_target\)/,
	);
});

test('assign: an empty agent assigns the team only; with no team it is an error', async () => {
	const { calls } = await script('conversation', 'assign', { conversationId: '4', agentId: '', teamId: '3' }, okAssign());
	assert.deepEqual(posts(calls), [{ team_id: 3 }]);
	await assert.rejects(
		script('conversation', 'assign', { conversationId: '4', agentId: '  ' }, okAssign()),
		/\(assign_no_target\)/,
	);
});

test('assign: the hand-off note is sent only when filled, on the agent call (and the team call, so a refusal writes nothing)', async () => {
	const run = (note) =>
		script('conversation', 'assign', { conversationId: '4', agentId: 'AgentBot:5', teamId: '3', handoffNote: note }, okAssign('account_key'));
	assert.deepEqual(posts((await run('')).calls), [{ team_id: 3 }, { assignee_id: '5', assignee_type: 'AgentBot' }]);
	assert.deepEqual(posts((await run('Wants a quote')).calls), [
		{ team_id: 3, handoff_note: 'Wants a quote' },
		{ assignee_id: '5', assignee_type: 'AgentBot', handoff_note: 'Wants a quote' },
	]);
	// A team-only change carries the note too, so the server refuses it (it is never silently dropped).
	const teamOnly = await script('conversation', 'assign', { conversationId: '4', teamId: '3', handoffNote: 'x' }, okAssign());
	assert.deepEqual(posts(teamOnly.calls), [{ team_id: 3, handoff_note: 'x' }]);
});

test('unassign: Team only with a note sends the note on the team call; both keeps it on the agent call', async () => {
	const run = async (unassignFrom) =>
		posts((await script('conversation', 'unassign', { conversationId: '4', unassignFrom, handoffNote: 'x' }, () => ({ id: 4 }))).calls);
	assert.deepEqual(await run('team'), [{ team_id: null, handoff_note: 'x' }]);
	assert.deepEqual(await run('agent'), [{ assignee_id: null, handoff_note: 'x' }]);
	assert.deepEqual(await run('both'), [{ team_id: null }, { assignee_id: null, handoff_note: 'x' }]);
});

test('assign: team and agent on a virtual agent connection stop before any write (fail closed)', async () => {
	const params = { conversationId: '4', agentId: '11', teamId: '3' };
	for (const [answer, pattern] of [
		[kindOf('agent'), /Choose an agent or a team, not both.*\(handoff_one_target\)/],
		[{ account: { id: 7 } }, /Couldn't check which kind of connection this is.*\(connection_kind_unknown\)/],
		[refusal(503, { error: 'down' }), /down/],
	]) {
		const methods = [];
		await assert.rejects(
			script('conversation', 'assign', params, (method) => {
				methods.push(method);
				return answer;
			}),
			pattern,
		);
		assert.deepEqual(methods, ['GET']);
	}
});

test('assign: person and account connections keep team first, then the person', async () => {
	for (const kind of ['oauth', 'account_key']) {
		const { calls, out } = await script('conversation', 'assign', { conversationId: '4', agentId: '11', teamId: '3' }, okAssign(kind));
		assert.deepEqual(posts(calls), [{ team_id: 3 }, { assignee_id: '11', assignee_type: 'User' }]);
		assert.equal(out[0].id, 4);
	}
});

test('assign: a team POST that answers null is an error', async () => {
	await assert.rejects(
		script('conversation', 'assign', { conversationId: '4', teamId: '99' }, (m, p) => (p.endsWith('/assignments') ? null : {})),
		/Team 99 was not assigned/,
	);
});

test('write outcomes: a read-back 404 is a success built from the write responses; a write 404 is an error', async () => {
	const gone = (m, p) => {
		if (p === '/api/v1/token_info') return kindOf('agent');
		if (m === 'GET') return refusal(404, { error: 'Resource could not be found' });
		if (p.endsWith('/assignments')) return { id: 11, available_name: 'Maya', name: 'Maya K', ...(m ? {} : {}) };
		if (p.endsWith('/toggle_status')) return { payload: { current_status: 'resolved' } };
		return {};
	};
	const assigned = await script('conversation', 'assign', { conversationId: '4', agentId: '11' }, gone);
	assert.deepEqual(assigned.out, [{ id: 4, assignee: { id: 11, name: 'Maya', type: 'User' } }]);
	const unassigned = await script('conversation', 'unassign', { conversationId: '4', unassignFrom: 'agent', handoffNote: 'why' }, gone);
	assert.deepEqual(unassigned.out, [{ id: 4, assignee: null }]);
	assert.deepEqual(posts(unassigned.calls), [{ assignee_id: null, handoff_note: 'why' }]);
	const resolved = await script('conversation', 'updateStatus', { conversationId: '4', status: 'resolved' }, gone);
	assert.deepEqual(resolved.out, [{ id: 4, status: 'resolved' }]);

	for (const [operation, parameters] of [
		['assign', { agentId: '11' }],
		['unassign', { unassignFrom: 'agent' }],
		['updateStatus', { status: 'resolved' }],
	]) {
		await assert.rejects(
			script('conversation', operation, { conversationId: '4', ...parameters }, (m) =>
				m === 'POST' ? refusal(404, { error: 'not found' }) : {},
			),
			NodeApiError,
			operation,
		);
	}
	await assert.rejects(
		script('conversation', 'get', { conversationId: '4' }, (m, p) => (p.startsWith('/conv') ? refusal(500, {}) : {})),
		NodeApiError,
	);
});

test('errors: mapped codes show their copy; other coded refusals show [status] server message (code)', async () => {
	const cases = [
		[409, { error: 'not_handling', error_code: 'not_handling' }, /^\[409\] This virtual agent isn't handling.*\(not_handling\)$/],
		[422, { error_code: 'assignee_not_available', message: 'Alice Smith is gone' }, /^\[422\] That person or virtual agent can't take.*\(assignee_not_available\)$/],
		[422, { error_code: 'conversation_resolved' }, /^\[422\] A virtual agent can't be assigned to a resolved.*\(conversation_resolved\)$/],
		[422, { error_code: 'handoff_note_not_allowed' }, /^\[422\] Only the virtual agent handling.*\(handoff_note_not_allowed\)$/],
		[422, { error_code: 'handoff_note_invalid' }, /^\[422\] The hand-off note must be 1 to 500.*\(handoff_note_invalid\)$/],
		[403, { error: 'insufficient_scope', message: 'Needs deals:edit' }, /^\[403\] This connection isn't allowed.*\(Needs deals:edit\)$/],
		[403, { error: 'forbidden', message: 'Nope' }, /^\[403\] This connection isn't allowed.*\(Nope\)$/],
		[403, { message: 'No code' }, /^\[403\] This connection isn't allowed.*\(No code\)$/],
		[403, { error: 'feature_disabled', message: 'The plan of Acme does not include API and webhooks.', area: 'api_and_webhooks' }, /^\[403\] The plan of Acme does not include API and webhooks\. \(feature_disabled\)$/],
		[402, { error: 'limit_exceeded', error_code: 'limit_exceeded', message: 'Webhooks: 3 of 3 used.', limit_key: 'webhooks' }, /^\[402\] Webhooks: 3 of 3 used\. \(limit_exceeded\)$/],
		[422, { error_code: 'owner_not_pipeline_member', message: "This person isn't a member of the deal's pipeline.", attributes: ['owner_id'] }, /^\[422\] This person isn't a member of the deal's pipeline\. \(owner_not_pipeline_member\)$/],
		[403, { error: 'owner_not_assignable', error_code: 'owner_not_assignable', message: 'The owner must be a member of this deal\'s pipeline.' }, /^\[403\] The owner must be a member.*\(owner_not_assignable\)$/],
		[422, { error_code: 'pipeline_required', message: 'Choose a pipeline for this deal.' }, /^\[422\] Choose a pipeline for this deal\. \(pipeline_required\)$/],
		[409, { error: 'active_conversation_not_visible', message: "You can't start a chat with this customer on this number." }, /^\[409\] You can't start a chat.*\(active_conversation_not_visible\)$/],
		[422, { error_code: 'something_else', message: 'Server says no' }, /^\[422\] Server says no \(something_else\)$/],
		[422, { error: 'Contact not found' }, /^Contact not found$/],
	];
	for (const [status, body, pattern] of cases) {
		const calls = [];
		await assert.rejects(
			script('conversation', 'get', { conversationId: '4' }, (m, p) => {
				calls.push(p);
				return refusal(status, body);
			}),
			(error) => {
				assert.match(error.message, pattern);
				assert.doesNotMatch(error.message, /Alice Smith|Hebrew text/);
				return true;
			},
		);
		assert.equal(calls.length, 1);
	}
});

test('connection: Get Info returns exactly kind, account, virtual_agent and user', async () => {
	const info = { kind: 'agent', account: { id: 7, name: 'Acme' }, user: null, virtual_agent: { id: 5, name: 'Sales bot', status: 'paused' }, scopes: ['x'], expires_at: null };
	const { out, calls } = await script('connection', 'getInfo', {}, () => info);
	assert.deepEqual(out, [{ kind: 'agent', account: info.account, virtual_agent: info.virtual_agent, user: null }]);
	assert.equal(calls.length, 1);
});

test('two nodes of one execution with different accounts each use their own account path (token_info is per context)', async () => {
	const urls = [];
	const make = (accountId) => {
		const ctx = execContext({ parameters: { resource: 'conversation', operation: 'get', conversationId: '4' }, authentication: 'apiKey', calls: [] });
		ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
			urls.push(options.url);
			return options.url.endsWith('/token_info') ? { account: { id: accountId }, kind: 'account_key' } : {};
		};
		return ctx;
	};
	const [first, second] = [make(100), make(200)];
	await new WebzzConnect().execute.call(first);
	await new WebzzConnect().execute.call(second);
	await new WebzzConnect().execute.call(first);
	assert.deepEqual(urls.filter((u) => !u.endsWith('/token_info')), [
		`${BASE}/api/v1/accounts/100/conversations/4`,
		`${BASE}/api/v1/accounts/200/conversations/4`,
		`${BASE}/api/v1/accounts/100/conversations/4`,
	]);
	assert.equal(urls.filter((u) => u.endsWith('/token_info')).length, 2);
});

test('loadOptions: getAgents lists people and typed virtual agents, getTeams uses /teams', async () => {
	const calls = [];
	const ctx = {
		...execContext({ parameters: {}, calls }),
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
		getCurrentNodeParameter: () => '5',
	};
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ url: options.url, qs: options.qs });
		return options.url.endsWith('/teams')
			? [{ id: 3, name: 'Sales' }]
			: {
					payload: [
						{ id: 11, available_name: 'Dana', assignee_type: 'User' },
						{ id: 5, name: 'Sales bot', assignee_type: 'AgentBot' },
					],
				};
	};
	const methods = new WebzzConnect().methods.loadOptions;
	assert.deepEqual(await methods.getAgents.call(ctx), [
		{ name: 'Dana', value: '11' },
		{ name: 'Sales bot (Virtual Agent)', value: 'AgentBot:5' },
	]);
	assert.deepEqual(await methods.getTeams.call(ctx), [{ name: 'Sales', value: '3' }]);
	assert.deepEqual(calls[0], {
		url: `${BASE}/api/v1/accounts/7/assignable_agents`,
		qs: { 'inbox_ids[]': '5', include_agent_bots: 1 },
	});
	ctx.getCurrentNodeParameter = () => '';
	assert.deepEqual(await methods.getAgents.call(ctx), []);
});

test('unassign: sends explicit nulls, team before agent, then re-fetches', async () => {
	const run = async (unassignFrom) =>
		summary((await runConversation('unassign', { conversationId: '4', unassignFrom }, { id: 4 })).calls);
	assert.deepEqual(await run('agent'), [`POST ${C}/4/assignments {"assignee_id":null}`, `GET ${C}/4 null`]);
	assert.deepEqual(await run('team'), [`POST ${C}/4/assignments {"team_id":null}`, `GET ${C}/4 null`]);
	assert.deepEqual(await run('both'), [
		`POST ${C}/4/assignments {"team_id":null}`,
		`POST ${C}/4/assignments {"assignee_id":null}`,
		`GET ${C}/4 null`,
	]);
});

test('updateStatus: status is always sent, Waiting on Customer is pending, then the conversation is re-fetched', async () => {
	for (const status of ['open', 'resolved', 'pending']) {
		const { calls } = await runConversation('updateStatus', { conversationId: '4', status }, { id: 4 });
		assert.deepEqual(summary(calls), [
			`POST ${C}/4/toggle_status ${JSON.stringify({ status })}`,
			`GET ${C}/4 null`,
		]);
	}
});

test('getAll: the new statuses and the virtual agent filter are sent, the default stays open', async () => {
	const run = async (filters) =>
		(await script('conversation', 'getAll', { returnAll: false, limit: 5, filters }, () => ({ data: { payload: [] } }))).calls[0].qs;
	assert.deepEqual(await run({}), { status: 'open', page: 1 });
	assert.deepEqual(await run({ status: 'with_virtual_agent', agentId: '5' }), { status: 'with_virtual_agent', agent_id: '5', page: 1 });
	assert.equal((await run({ status: 'waiting_on_customer' })).status, 'waiting_on_customer');
	await assert.rejects(run({ agentId: 'AgentBot:5' }), NodeOperationError);
});

test('create and template send: status is sent only when filled', async () => {
	const inbox = { id: 3, message_templates: [{ name: 'hello', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi' }] }] };
	const handler = (m, p) => (p === '/inboxes' ? [inbox] : {});
	const run = async (resource, operation, extra) =>
		posts((await script(resource, operation, { inboxId: '3', contactId: '9', template: 'hello::en', ...extra }, handler)).calls).pop();
	assert.equal('status' in (await run('conversation', 'create', { initialStatus: '' })), false);
	assert.equal((await run('conversation', 'create', { initialStatus: 'resolved' })).status, 'resolved');
	assert.equal('status' in (await run('whatsAppTemplate', 'send', { initialStatus: '' })), false);
	assert.equal((await run('whatsAppTemplate', 'send', { initialStatus: 'resolved' })).status, 'resolved');
});

test('errors: feature_disabled and limit_exceeded add guidance as the description', async () => {
	const description = async (status, body) => {
		try {
			await script('conversation', 'get', { conversationId: '4' }, () => refusal(status, body));
		} catch (error) {
			return error.description;
		}
		assert.fail('expected a refusal');
	};
	assert.match(await description(403, { error: 'feature_disabled', message: 'x' }), /plan doesn't include this area/);
	assert.match(await description(402, { error: 'limit_exceeded', message: 'x' }), /plan limit/);
});

test('sends: a message WebzzConnect refused at once (status failed) fails the step; others succeed', async () => {
	const limit = { id: 1, status: 'failed', failure_code: 'monthly_active_contacts_limit_reached' };
	const send = (answer) => script('conversation', 'sendMessage', { conversationId: '4', content: 'hi', fileUrl: '' }, () => answer);
	await assert.rejects(send(limit), (error) => {
		assert.ok(error instanceof NodeOperationError);
		assert.match(error.message, /monthly active contacts limit.*\(monthly_active_contacts_limit_reached\)$/);
		return true;
	});
	await assert.rejects(
		send({ id: 1, status: 'failed' }),
		/The message wasn't sent\. Open the conversation in WebzzConnect to see the reason\. \(failed\)$/,
	);
	assert.equal((await send({ id: 1, status: 'sent' })).out[0].status, 'sent');
	assert.equal((await send({ id: 1 })).out[0].id, 1);

	const inbox = { id: 3, message_templates: [{ name: 'hello', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi' }] }] };
	const created = (status) => (m, p) => (p === '/inboxes' ? [inbox] : { id: 8, messages: [{ id: 1, status, failure_code: status === 'failed' ? limit.failure_code : null }] });
	const template = (status) => script('whatsAppTemplate', 'send', { inboxId: '3', contactId: '9', template: 'hello::en' }, created(status));
	const create = (status) => script('conversation', 'create', { inboxId: '3', contactId: '9', content: 'hi' }, created(status));
	await assert.rejects(template('failed'), /monthly_active_contacts_limit_reached/);
	await assert.rejects(create('failed'), /monthly_active_contacts_limit_reached/);
	assert.equal((await template('sent')).out[0].id, 8);
	assert.equal((await create('pending')).out[0].id, 8);
	assert.equal((await script('conversation', 'create', { inboxId: '3', contactId: '9' }, () => ({ id: 8 }))).out[0].id, 8);
	// No message sent: an older failed message returned as messages[0] is not this step's failure.
	assert.equal((await script('conversation', 'create', { inboxId: '3', contactId: '9' }, created('failed'))).out[0].id, 8);
});

test('sends: with continueOnFail a blocked message becomes an error item', async () => {
	const ctx = execContext({ parameters: { resource: 'conversation', operation: 'sendMessage', conversationId: '4', content: 'hi', fileUrl: '' }, calls: [] });
	ctx.continueOnFail = () => true;
	ctx.helpers.httpRequestWithAuthentication = async () => ({ id: 1, status: 'failed', failure_code: 'monthly_active_contacts_limit_reached' });
	const out = await new WebzzConnect().execute.call(ctx);
	assert.match(out[0][0].json.error, /monthly_active_contacts_limit_reached/);
});

test('contact upsert: a 422 miss says contact_not_visible only on a virtual agent connection', async () => {
	const run = (kind) =>
		script('contact', 'createOrUpdate', { email: 'a@b.co', name: 'A' }, (m, p) => {
			if (p === '/api/v1/token_info') return kindOf(kind);
			if (m === 'POST') return refusal(422, { error_code: 'invalid', message: 'Email taken' });
			return { payload: [] };
		});
	await assert.rejects(run('agent'), /\[422\] This contact may already exist, but this virtual agent sees only/);
	await assert.rejects(run('account_key'), /Email taken/);
});

test('updateStatus: snoozed_until is Unix seconds, and omitted when empty or not snoozed', async () => {
	const snooze = (parameters) =>
		runConversation('updateStatus', { conversationId: '4', ...parameters }, { id: 4 }).then((r) => r.calls[0].body);
	assert.deepEqual(await snooze({ status: 'snoozed', snoozeUntil: '2026-11-01T10:00:00.000Z' }), {
		status: 'snoozed',
		snoozed_until: 1793527200,
	});
	assert.deepEqual(await snooze({ status: 'snoozed', snoozeUntil: '' }), { status: 'snoozed' });
	assert.deepEqual(await snooze({ status: 'snoozed' }), { status: 'snoozed' });
	assert.deepEqual(await snooze({ status: 'open', snoozeUntil: '2026-11-01T10:00:00.000Z' }), { status: 'open' });
	await assert.rejects(
		snooze({ status: 'snoozed', snoozeUntil: 'soon' }),
		/'Snooze Until' must be a date and time, e\.g\. 2026-12-01T09:00:00, but got "soon"$/,
	);
});

test('sendMessage: text only keeps the old body and sends no upload', async () => {
	const { calls } = await runConversation('sendMessage', { conversationId: '4', content: 'hi', fileUrl: '' });
	assert.deepEqual(summary(calls), [
		`POST ${C}/4/messages {"message_type":"outgoing","private":false,"content":"hi"}`,
	]);
});

test('sendMessage: a file URL is uploaded first, then sent as attachments with an optional caption', async () => {
	const calls = [];
	const ctx = execContext({
		parameters: { resource: 'conversation', operation: 'sendMessage', conversationId: '4', content: 'see file', fileUrl: ' https://example.com/a.pdf ' },
		calls,
	});
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body });
		return options.url.endsWith('/upload') ? { blob_id: 'signed-1', file_url: 'x' } : { id: 8 };
	};
	await new WebzzConnect().execute.call(ctx);
	assert.deepEqual(summary(calls), [
		`POST ${BASE}/api/v1/accounts/7/upload {"external_url":"https://example.com/a.pdf"}`,
		`POST ${C}/4/messages {"message_type":"outgoing","private":false,"content":"see file","attachments":["signed-1"]}`,
	]);
	// file only: content omitted
	calls.length = 0;
	ctx.getNodeParameter = (name, _i, fallback) => (name === 'authentication' ? 'oAuth2' : { resource: 'conversation', operation: 'sendMessage', conversationId: '4', fileUrl: 'https://example.com/a.pdf' }[name] ?? fallback);
	await new WebzzConnect().execute.call(ctx);
	assert.equal(calls[1].body.content, undefined);
});

test('sendMessage: no text and no file, or a non-http URL, is a clear error and sends nothing', async () => {
	await assert.rejects(runConversation('sendMessage', { conversationId: '4', content: '' }), /Enter a 'Message', a 'File URL', or both/);
	await assert.rejects(runConversation('sendMessage', { conversationId: '4', fileUrl: 'ftp://x/y' }), /must start with http/);
});

// --- WhatsApp template fields ---

const TEMPLATES = [
	{
		name: 'promo', language: 'en', category: 'MARKETING', status: 'APPROVED',
		components: [
			{ type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}' },
			{ type: 'BODY', text: 'Hello {{first_name}}, your code is {{code}}.' },
			{ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY' }, { type: 'URL', url: 'https://x.com/{{1}}' }] },
		],
	},
	{
		name: 'invoice', language: 'he', category: 'UTILITY', status: 'APPROVED',
		components: [
			{ type: 'HEADER', format: 'DOCUMENT' },
			{ type: 'BODY', text: 'Invoice {{1}} attached' },
			{ type: 'BUTTONS', buttons: [{ type: 'COPY_CODE' }] },
		],
	},
	{ name: 'plain', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Thanks' }] },
	{ name: 'draft', language: 'en', status: 'PENDING', components: [{ type: 'BODY', text: 'x' }] },
];

function templateCtx({ parameters, calls = [] }) {
	const ctx = execContext({ parameters: { resource: 'whatsAppTemplate', operation: 'send', inboxId: '5', contactId: '9', ...parameters }, calls });
	ctx.getCurrentNodeParameter = (name) => ({ inboxId: '5', template: parameters.template })[name];
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body });
		if (options.url.endsWith('/inboxes')) return { payload: [{ id: 5, message_templates: TEMPLATES }] };
		return { id: 1 };
	};
	return { ctx, calls };
}

async function sendTemplate(parameters) {
	const { ctx, calls } = templateCtx({ parameters });
	await new WebzzConnect().execute.call(ctx);
	return calls.find((c) => c.method === 'POST').body;
}

test('template mapper: fields load from the selected template (header text, named body, URL button)', async () => {
	const { ctx } = templateCtx({ parameters: { template: 'promo::en' } });
	const { fields } = await new WebzzConnect().methods.resourceMapping.getTemplateFields.call(ctx);
	assert.deepEqual(fields.map((f) => f.id), ['header_text', 'body_first_name', 'body_code', 'button_url_2']);
	assert.ok(fields.every((f) => f.type === 'string' && f.required && f.display));
	const media = templateCtx({ parameters: { template: 'invoice::he' } });
	assert.deepEqual(
		(await new WebzzConnect().methods.resourceMapping.getTemplateFields.call(media.ctx)).fields.map((f) => f.id),
		['header_media_url', 'body_1', 'button_code_1'],
	);
	const none = templateCtx({ parameters: { template: 'plain::en' } });
	assert.deepEqual((await new WebzzConnect().methods.resourceMapping.getTemplateFields.call(none.ctx)).fields, []);
	const unknown = templateCtx({ parameters: { template: 'draft::en' } });
	assert.deepEqual((await new WebzzConnect().methods.resourceMapping.getTemplateFields.call(unknown.ctx)).fields, []);
});

test('template send: mapped header, named body and URL button become processed_params like the Make app', async () => {
	const body = await sendTemplate({
		template: 'promo::en',
		templateFields: { mappingMode: 'defineBelow', value: { header_text: 'Dana', body_first_name: 'Dana', body_code: 'X1', button_url_2: 'abc' } },
	});
	assert.equal(body.inbox_id, '5');
	assert.equal(body.contact_id, '9');
	assert.equal(body.message.content, 'Hello Dana, your code is X1.');
	assert.deepEqual(body.message.template_params, {
		name: 'promo', category: 'MARKETING', language: 'en',
		processed_params: {
			body: { first_name: 'Dana', code: 'X1' },
			header: { 1: 'Dana' },
			buttons: [{ type: 'none', parameter: '' }, { type: 'url', parameter: 'abc' }],
		},
	});
});

test('template send: media header and copy-code coupon', async () => {
	const body = await sendTemplate({
		template: 'invoice::he',
		templateFields: { value: { header_media_url: 'https://x.com/a.pdf', body_1: '77', button_code_1: 'SAVE10' } },
	});
	assert.deepEqual(body.message.template_params.processed_params, {
		body: { 1: '77' },
		header: { media_url: 'https://x.com/a.pdf', media_type: 'document' },
		buttons: [{ type: 'copy_code', parameter: 'SAVE10' }],
	});
});

test('template send: expression-mapped template keeps working with positional Body Variables', async () => {
	const body = await sendTemplate({ template: 'invoice::he', templateFields: { value: { header_media_url: 'https://x.com/a.pdf', button_code_1: 'C' } }, 'bodyVariables.values': [{ value: '88' }] });
	assert.deepEqual(body.message.template_params.processed_params.body, { 1: '88' });
	const plain = await sendTemplate({ template: 'plain::en' });
	assert.deepEqual(plain.message.template_params, { name: 'plain', category: 'UTILITY', language: 'en' });
	assert.equal(plain.message.content, 'Thanks');
});

test('template send: missing field values and a wrong positional count are clear errors', async () => {
	await assert.rejects(
		sendTemplate({ template: 'promo::en', templateFields: { value: { body_code: 'X1' } } }),
		/Fill in these 'Template Fields': Header Text Variable, Body Variable first_name, Button 2 URL Variable/,
	);
	await assert.rejects(
		sendTemplate({ template: 'invoice::he', templateFields: { value: { header_media_url: 'u', button_code_1: 'c' } }, 'bodyVariables.values': [{ value: 'a' }, { value: 'b' }] }),
		/1 variable\(s\) but 2 value\(s\)/,
	);
});

// --- Interactive messages, custom attributes, labels (0.4.0) ---

function sendCtx({ parameters, calls }) {
	const ctx = execContext({
		parameters: { resource: 'conversation', operation: 'sendMessage', conversationId: '4', ...parameters },
		calls,
	});
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ credential, method: options.method, url: options.url, body: options.body, headers: options.headers });
		return options.url.endsWith('/upload') ? { blob_id: 'signed-1' } : { id: 8 };
	};
	return ctx;
}

async function sendBody(parameters) {
	const calls = [];
	await new WebzzConnect().execute.call(sendCtx({ parameters, calls }));
	return { calls, body: calls[calls.length - 1].body };
}

test('sendMessage: reply buttons, list and link button bodies', async () => {
	const buttons = await sendBody({
		messageType: 'button',
		content: 'Ready?',
		buttons: { values: [{ title: "I'm in", value: 'in' }, { title: "I'm out", value: '' }] },
		interactiveOptions: { headerType: 'text', headerText: 'Hi', footer: 'Webzz' },
	});
	assert.deepEqual(buttons.body, {
		message_type: 'outgoing',
		content_type: 'input_select',
		content_attributes: {
			items: [{ title: "I'm in", value: 'in' }, { title: "I'm out", value: "I'm out" }],
			interactive: { type: 'button', header: { type: 'text', text: 'Hi' }, footer: { text: 'Webzz' } },
		},
		content: 'Ready?',
	});
	assert.equal(buttons.calls.length, 1);

	const list = await sendBody({
		messageType: 'list',
		content: 'Why?',
		listButton: 'Choose',
		rows: { values: [{ title: 'By accident', value: 'acc', description: '', section: 'Reasons' }, { title: 'Other', value: 'other', description: 'Tell us' }] },
	});
	assert.deepEqual(list.body.content_attributes, {
		items: [
			{ title: 'By accident', value: 'acc', section: 'Reasons' },
			{ title: 'Other', value: 'other', description: 'Tell us' },
		],
		interactive: { type: 'list', button: 'Choose' },
	});

	const cta = await sendBody({ messageType: 'cta_url', content: 'Pay here', ctaText: 'Pay', ctaUrl: ' https://x.com/pay ' });
	assert.deepEqual(cta.body.content_attributes, {
		items: [{ title: 'Pay', value: 'https://x.com/pay' }],
		interactive: { type: 'cta_url' },
	});
	assert.equal(cta.body.private, undefined);
});

test('sendMessage: a media header is uploaded and referenced, with header.type', async () => {
	const { calls, body } = await sendBody({
		messageType: 'cta_url',
		content: 'Watch',
		ctaText: 'Pay',
		ctaUrl: 'https://x.com/pay',
		interactiveOptions: { headerType: 'video', headerMediaUrl: 'https://x.com/v.mp4' },
	});
	assert.deepEqual(summary(calls)[0], `POST ${BASE}/api/v1/accounts/7/upload {"external_url":"https://x.com/v.mp4"}`);
	assert.deepEqual(body.attachments, ['signed-1']);
	assert.deepEqual(body.content_attributes.interactive.header, { type: 'video' });
});

test('sendMessage: list with a media header, a missing body or a missing media URL fail before any request', async () => {
	const calls = [];
	const run = (parameters) => new WebzzConnect().execute.call(sendCtx({ parameters, calls }));
	await assert.rejects(
		run({ messageType: 'list', content: 'x', rows: { values: [{ title: 'a' }] }, interactiveOptions: { headerType: 'image', headerMediaUrl: 'https://x.com/a.png' } }),
		/A list can only have a text header/,
	);
	await assert.rejects(run({ messageType: 'button', content: '', buttons: { values: [{ title: 'a' }] } }), /Enter the 'Message'/);
	await assert.rejects(
		run({ messageType: 'button', content: 'x', buttons: { values: [{ title: 'a' }] }, interactiveOptions: { headerType: 'image' } }),
		/Header Media URL/,
	);
	for (const headerType of [undefined, 'none', 'text']) {
		await assert.rejects(
			run({ messageType: 'button', content: 'x', buttons: { values: [{ title: 'a' }] }, interactiveOptions: { headerType, headerText: 'Hi', headerMediaUrl: 'https://x.com/a.png' } }),
			/Choose 'Header Type' Image, Video or Document to use 'Header Media URL'/,
		);
	}
	assert.equal(calls.length, 0);
});

test('setCustomAttributes: merged into the existing attributes, then re-fetched', async () => {
	const { calls } = await runConversation(
		'setCustomAttributes',
		{ conversationId: '4', customAttributes: { values: [{ key: 'beta_step', value: '2' }, { key: ' ', value: 'x' }] } },
		{ id: 4, custom_attributes: { plan: 'pro', beta_step: '1' } },
	);
	assert.deepEqual(summary(calls), [
		`GET ${C}/4 null`,
		`POST ${C}/4/custom_attributes {"custom_attributes":{"plan":"pro","beta_step":"2"}}`,
		`GET ${C}/4 null`,
	]);
	await assert.rejects(runConversation('setCustomAttributes', { conversationId: '4', customAttributes: {} }), /at least one attribute/);
});

test('addLabels: union with the current labels', async () => {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'conversation', operation: 'addLabels', conversationId: '4', labels: 'Human, VIP ,,' }, calls });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body });
		return options.method === 'GET' ? { payload: ['vip', 'lead'] } : { payload: options.body.labels };
	};
	const out = await new WebzzConnect().execute.call(ctx);
	assert.deepEqual(summary(calls), [`GET ${C}/4/labels null`, `POST ${C}/4/labels {"labels":["vip","lead","human"]}`]);
	assert.deepEqual(out[0][0].json, { labels: ['vip', 'lead', 'human'] });
});

test('trigger: message_created gets a top-level button_payload (null for typed text)', async () => {
	const { createHmac } = require('crypto');
	const deliver = async (body) => {
		const raw = JSON.stringify(body);
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = `sha256=${createHmac('sha256', 'sec').update(`${timestamp}.`).update(raw).digest('hex')}`;
		const ctx = {
			getNode: () => node,
			getRequestObject: () => ({ rawBody: Buffer.from(raw) }),
			getResponseObject: () => ({ status: () => ({ json: () => undefined }) }),
			getWorkflowStaticData: () => ({ id: 1, secret: 'sec' }),
			getHeaderData: () => ({ 'x-webzzconnect-signature': signature, 'x-webzzconnect-timestamp': timestamp }),
			getBodyData: () => body,
			getNodeParameter: (name, fallback) => ({ events: ['message_created', 'contact_created'], messageType: 'any' }[name] ?? fallback),
			helpers: { returnJsonArray: (data) => [{ json: data }] },
		};
		const result = await new WebzzConnectTrigger().webhook.call(ctx);
		return result.workflowData[0][0].json;
	};
	assert.equal((await deliver({ event: 'message_created', content: "I'm in", content_attributes: { button_payload: 'in' } })).button_payload, 'in');
	assert.equal((await deliver({ event: 'message_created', content: 'hello', content_attributes: {} })).button_payload, null);
	assert.equal((await deliver({ event: 'contact_created', id: 1 })).button_payload, undefined);
});

test('ids in request paths: a non-numeric id is refused before any request', async () => {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'conversation', operation: 'get', conversationId: '5/../../contacts/1' }, calls });
	await assert.rejects(new WebzzConnect().execute.call(ctx), (error) => {
		assert.ok(error instanceof NodeOperationError);
		assert.match(error.message, /^'Conversation ID' must be a number, but got "5\/\.\.\/\.\.\/contacts\/1"$/);
		assert.match(error.description, /Use the numeric ID shown in WebzzConnect/);
		return true;
	});
	assert.equal(calls.length, 0);
	const ok = await runConversation('get', { conversationId: ' 5 ' }, { id: 5 });
	assert.deepEqual(summary(ok.calls), [`GET ${C}/5 null`]);
});

// --- Trigger: virtual agents (Part N2) ---

const { createHmac } = require('crypto');

function webhookContext({ body, parameters, secret = 'sec', signed = true }) {
	const raw = JSON.stringify(body);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = signed
		? `sha256=${createHmac('sha256', 'sec').update(`${timestamp}.`).update(raw).digest('hex')}`
		: 'sha256=bad';
	const sent = [];
	const ctx = {
		getNode: () => node,
		getRequestObject: () => ({ rawBody: Buffer.from(raw) }),
		getResponseObject: () => ({ status: (code) => ({ json: () => sent.push(code) }) }),
		getWorkflowStaticData: () => ({ id: 1, secret }),
		getHeaderData: () => ({ 'x-webzzconnect-signature': signature, 'x-webzzconnect-timestamp': timestamp }),
		getBodyData: () => body,
		getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
		helpers: { returnJsonArray: (data) => [{ json: data }] },
	};
	return { ctx, sent };
}

test('trigger: Direction is any on v1 and incoming on v1.1, declared per @version', () => {
	const description = new WebzzConnectTrigger().description;
	assert.deepEqual(description.version, [1, 1.1]);
	const declarations = description.properties.filter((p) => p.name === 'messageType');
	const v1 = declarations.find((p) => p.displayOptions.show['@version']);
	const v11 = declarations.find((p) => p.displayOptions.hide?.['@version']);
	assert.equal(v1.default, 'any');
	assert.deepEqual(v1.displayOptions.show['@version'], [1]);
	assert.equal(v11.default, 'incoming');
	assert.deepEqual(v11.displayOptions.hide['@version'], [1]);
	assert.equal(declarations.length, 2);
});

test('trigger: Incoming drops outgoing message_created and message_updated bodies with no run', async () => {
	const parameters = { events: ['message_created', 'message_updated'], messageType: 'incoming' };
	for (const event of ['message_created', 'message_updated']) {
		for (const message_type of [1, 'outgoing']) {
			const { ctx } = webhookContext({ body: { event, message_type }, parameters });
			const result = await new WebzzConnectTrigger().webhook.call(ctx);
			assert.equal(result.workflowData, undefined, `${event} ${message_type}`);
		}
		const { ctx } = webhookContext({ body: { event, message_type: 0 }, parameters });
		assert.equal((await new WebzzConnectTrigger().webhook.call(ctx)).workflowData[0][0].json.event, event);
	}
	const any = webhookContext({ body: { event: 'message_updated', message_type: 1 }, parameters: { ...parameters, messageType: 'any' } });
	assert.ok((await new WebzzConnectTrigger().webhook.call(any.ctx)).workflowData);
});

test('trigger: a bad signature is a 401 before any filter', async () => {
	const { ctx, sent } = webhookContext({
		body: { event: 'message_created', message_type: 0 },
		parameters: { events: ['message_created'], messageType: 'incoming' },
		signed: false,
	});
	const result = await new WebzzConnectTrigger().webhook.call(ctx);
	assert.deepEqual(sent, [401]);
	assert.equal(result.noWebhookResponse, true);
	assert.equal(result.workflowData, undefined);
});

test('trigger: conversation_handed_off is an event, follows the inbox filter and passes through with null fields', async () => {
	const description = new WebzzConnectTrigger().description;
	const events = description.properties.find((p) => p.name === 'events');
	assert.ok(events.options.some((o) => o.value === 'conversation_handed_off' && o.name === 'Conversation Handed Off'));
	assert.ok(description.properties.find((p) => p.name === 'inboxIds').displayOptions.show.events.includes('conversation_handed_off'));
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const { ctx, calls } = hookContext({
		stored: {},
		webhookUrl: url,
		parameters: { events: ['conversation_handed_off'], inboxIds: ['3'] },
	});
	await hooks.create.call(ctx);
	assert.deepEqual(calls.find((c) => c.method === 'POST').body.inbox_ids, [3]);
	const body = { event: 'conversation_handed_off', handoff: { from: null, to: { type: 'team', id: null, name: null }, note: null, waiting_message: null } };
	const delivery = webhookContext({ body, parameters: { events: ['conversation_handed_off'] } });
	assert.deepEqual((await new WebzzConnectTrigger().webhook.call(delivery.ctx)).workflowData[0][0].json.handoff, body.handoff);
});

test('create: a re-posted URL (200, no secret) rotates the secret, never deletes, and stores it', async () => {
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const run = async (rotate) => {
		const stored = {};
		const { ctx, calls } = hookContext({ stored, webhookUrl: url, parameters: { events: ['message_created'] } });
		ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
			calls.push({ method: options.method, url: options.url });
			if (options.url.endsWith('/rotate_secret')) return rotate();
			return { id: 99, url };
		};
		return { stored, calls, result: hooks.create.call(ctx) };
	};
	const ok = await run(() => ({ id: 99, secret: 'rotated' }));
	assert.equal(await ok.result, true);
	assert.deepEqual(ok.stored, { id: 99, secret: 'rotated' });
	assert.deepEqual(ok.calls.map((c) => `${c.method} ${c.url.replace(`${BASE}/api/v1/accounts/7`, '')}`), [
		'POST /webhook_subscriptions',
		'POST /webhook_subscriptions/99/rotate_secret',
	]);
	const failed = await run(() => {
		throw { httpCode: '500', message: 'boom' };
	});
	await assert.rejects(failed.result);
	assert.deepEqual(failed.stored, {});
});

test('delete: a 401 resolves and logs exactly the copy with the id; a 500 throws; nothing else is logged', async () => {
	const run = async (status) => {
		const stored = { id: 5, secret: 's' };
		const { ctx } = hookContext({ stored, webhookUrl: 'https://n8n.example.com/x', parameters: {} });
		const warnings = [];
		ctx.logger = { warn: (...args) => warnings.push(args) };
		ctx.helpers.httpRequestWithAuthentication = async () => {
			throw { httpCode: String(status), message: 'secret-token-leak', response: { status, data: { error: 'x' } } };
		};
		return { stored, warnings, result: hooks.delete.call(ctx) };
	};
	const revoked = await run(401);
	assert.equal(await revoked.result, true);
	assert.deepEqual(revoked.warnings, [[
		"Couldn't remove WebzzConnect webhook subscription 5: the credential is no longer valid. It may keep sending events to this URL until it's removed in WebzzConnect → Settings → App webhooks.",
	]]);
	assert.deepEqual(revoked.stored, {});
	const failed = await run(500);
	await assert.rejects(failed.result);
	assert.deepEqual(failed.warnings, []);
	assert.equal(await (await run(404)).result, true);
});

test('example: the sales flow has the virtual agent gate, no human label and no "Person replied?"', () => {
	const text = require('fs').readFileSync(require('path').join(__dirname, '../examples/whatsapp-sales-flow.json'), 'utf8');
	const flow = JSON.parse(text);
	assert.doesNotMatch(text, /human|Person replied\?/);
	const names = flow.nodes.map((n) => n.name);
	const info = flow.nodes.find((n) => n.parameters.operation === 'getInfo');
	assert.equal(info.parameters.resource, 'connection');
	assert.equal(flow.nodes.find((n) => n.name === 'New message').parameters.messageType, 'incoming');
	const gate = JSON.stringify(flow.nodes.find((n) => n.name === 'Mine to answer?').parameters);
	assert.match(gate, /message_type/);
	assert.match(gate, /assignee_type === 'AgentBot'/);
	assert.match(gate, /virtual_agent\.id/);
	assert.ok(names.indexOf('Who am I') < names.indexOf('Mine to answer?'));
	const handOff = flow.nodes.find((n) => n.name === 'Hand off to the team');
	assert.equal(handOff.parameters.operation, 'unassign');
	assert.ok(handOff.parameters.handoffNote);
	assert.ok(flow.connections['Mine to answer?'] && flow.connections['Who am I']);
});

// --- Labels on contacts and conversations, label picker (0.6.0) ---

async function runLabels(resource, operation, parameters, current = []) {
	const calls = [];
	const ctx = execContext({ parameters: { resource, operation, ...parameters }, calls });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body });
		return options.method === 'GET' ? { payload: current } : { payload: options.body.labels };
	};
	const out = await new WebzzConnect().execute.call(ctx);
	return { calls, out };
}

const CT = `${BASE}/api/v1/accounts/7/contacts`;

test('contact addLabels: union, lowercased and deduped, from a picker list', async () => {
	const { calls, out } = await runLabels('contact', 'addLabels', { contactId: '3', labels: ['b', 'B', ' a '] }, ['a']);
	assert.deepEqual(summary(calls), [`GET ${CT}/3/labels null`, `POST ${CT}/3/labels {"labels":["a","b"]}`]);
	assert.deepEqual(out[0][0].json, { labels: ['a', 'b'] });
});

test('contact removeLabels: missing labels are ignored, case-insensitive', async () => {
	const { calls } = await runLabels('contact', 'removeLabels', { contactId: '3', labels: 'A, z' }, ['a', 'b']);
	assert.deepEqual(summary(calls), [`GET ${CT}/3/labels null`, `POST ${CT}/3/labels {"labels":["b"]}`]);
});

test('conversation setLabels: one POST with the list, no read', async () => {
	const { calls } = await runLabels('conversation', 'setLabels', { conversationId: '4', labels: ['C'] }, ['a']);
	assert.deepEqual(summary(calls), [`POST ${C}/4/labels {"labels":["c"]}`]);
});

test('conversation setLabels: clears only with Clear All Labels; an empty list is refused', async () => {
	const cleared = await runLabels('conversation', 'setLabels', { conversationId: '4', clearAll: true, labels: ['ignored'] });
	assert.deepEqual(summary(cleared.calls), [`POST ${C}/4/labels {"labels":[]}`]);
	for (const labels of ['', [], [' ', ',']]) {
		const calls = [];
		const ctx = execContext({ parameters: { resource: 'conversation', operation: 'setLabels', conversationId: '4', clearAll: false, labels }, calls });
		ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
			calls.push(options);
			return {};
		};
		await assert.rejects(new WebzzConnect().execute.call(ctx), /Enter at least one label/);
		assert.equal(calls.length, 0);
	}
});

test('conversation removeLabels and the empty addLabels refusal', async () => {
	const { calls } = await runLabels('conversation', 'removeLabels', { conversationId: '4', labels: ['b'] }, ['a', 'b']);
	assert.deepEqual(summary(calls), [`GET ${C}/4/labels null`, `POST ${C}/4/labels {"labels":["a"]}`]);
	await assert.rejects(runLabels('conversation', 'addLabels', { conversationId: '4', labels: [] }), /Enter at least one label/);
});

test('labels: v1 text and v1.1 list give the same normalized titles', async () => {
	const text = await runLabels('conversation', 'setLabels', { conversationId: '4', labels: 'vip, hot-lead' });
	const list = await runLabels('conversation', 'setLabels', { conversationId: '4', labels: ['VIP', ' vip ', 'x'] });
	assert.equal(text.calls[0].body.labels.join(), 'vip,hot-lead');
	assert.equal(list.calls[0].body.labels.join(), 'vip,x');
});

test('loadOptions getLabels: titles from /labels, sorted; node is version 1, 1.1 and 1.2', async () => {
	const calls = [];
	const ctx = {
		getNode: () => node,
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
		getCurrentNodeParameter: () => undefined,
		getCredentials: async () => ({ oauthTokenData: { account_id: 7 } }),
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push(`${options.method} ${options.url}`);
				return { payload: [{ id: 2, title: 'vip' }, { id: 1, title: 'hot-lead' }] };
			},
		},
	};
	const options = await new WebzzConnect().methods.loadOptions.getLabels.call(ctx);
	assert.deepEqual(calls, [`GET ${BASE}/api/v1/accounts/7/labels`]);
	assert.deepEqual(options, [{ name: 'hot-lead', value: 'hot-lead' }, { name: 'vip', value: 'vip' }]);
	assert.deepEqual(new WebzzConnect().description.version, [1, 1.1, 1.2]);
	const labelProps = new WebzzConnect().description.properties.filter((p) => p.name === 'labels');
	assert.ok(labelProps.some((p) => p.type === 'string' && p.displayOptions.show['@version'][0] === 1));
	assert.ok(labelProps.some((p) => p.type === 'multiOptions' && p.displayOptions.hide['@version'][0] === 1));
});

test('conversation setLabels: Clear All Labels must be a real true', async () => {
	for (const clearAll of ['false', 'true', 1]) {
		const calls = [];
		const ctx = execContext({ parameters: { resource: 'conversation', operation: 'setLabels', conversationId: '4', clearAll, labels: [] }, calls });
		await assert.rejects(new WebzzConnect().execute.call(ctx), /Enter at least one label/);
		assert.equal(calls.length, 0);
	}
	assert.equal(new WebzzConnect().description.defaultVersion, 1.2);
});

// --- Deal notes (0.6.0) ---

async function runDealWith(operation, parameters, respond) {
	const calls = [];
	const ctx = execContext({ parameters: { resource: 'deal', operation, ...parameters }, calls });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body });
		return respond ? respond(options) : {};
	};
	const out = await new WebzzConnect().execute.call(ctx);
	return { calls, items: out[0].map((item) => item.json) };
}

const D = `${BASE}/api/v1/accounts/7/crm/deals`;

test('deal notes: add, list, update and delete hit /crm/deals/:id/notes', async () => {
	const added = await runDealWith('addNote', { dealId: '5', content: 'Called, wants a quote' }, (o) => ({ id: 9, content: o.body.content }));
	assert.deepEqual(summary(added.calls), [`POST ${D}/5/notes {"content":"Called, wants a quote"}`]);
	assert.deepEqual(added.items, [{ id: 9, content: 'Called, wants a quote' }]);

	const listed = await runDealWith('getNotes', { dealId: '5' }, () => [{ id: 9 }, { id: 8 }]);
	assert.deepEqual(summary(listed.calls), [`GET ${D}/5/notes null`]);
	assert.deepEqual(listed.items, [{ id: 9 }, { id: 8 }]);

	const updated = await runDealWith('updateNote', { dealId: '5', noteId: '9', content: 'Quote sent' }, (o) => ({ id: 9, content: o.body.content, edited: true }));
	assert.deepEqual(summary(updated.calls), [`PATCH ${D}/5/notes/9 {"content":"Quote sent"}`]);

	const deleted = await runDealWith('deleteNote', { dealId: '5', noteId: '9' }, () => undefined);
	assert.deepEqual(summary(deleted.calls), [`DELETE ${D}/5/notes/9 null`]);
	assert.deepEqual(deleted.items, [{ deleted: true, id: '9' }]);
});

test('deal notes: empty or too long text is refused before any request', async () => {
	for (const content of ['', '   ', 'x'.repeat(10001)]) {
		const calls = [];
		const ctx = execContext({ parameters: { resource: 'deal', operation: 'addNote', dealId: '5', content }, calls });
		await assert.rejects(new WebzzConnect().execute.call(ctx), /note text|limit is 10000/);
		assert.equal(calls.length, 0);
	}
	const ok = await runDealWith('addNote', { dealId: '5', content: 'x'.repeat(10000) }, () => ({ id: 1 }));
	assert.equal(ok.calls.length, 1);
});

test('deal notes: a 403 on update or delete explains the note ownership rule', async () => {
	for (const operation of ['updateNote', 'deleteNote']) {
		const calls = [];
		const ctx = execContext({ parameters: { resource: 'deal', operation, dealId: '5', noteId: '9', content: 'x' }, calls });
		ctx.helpers.httpRequestWithAuthentication = async () => {
			const error = new Error('Request failed with status code 403');
			error.httpCode = 403;
			error.response = { status: 403, data: { error: 'You are not authorized to do this action' } };
			throw error;
		};
		await assert.rejects(new WebzzConnect().execute.call(ctx), (error) => {
			assert.match(error.message, /^\[403\]/);
			assert.match(error.description, /only by the connection or person that wrote it/);
			return true;
		});
	}
});

// --- Deal product lines (0.6.0) ---

test('deal products: catalog line, custom line, update, delete and list', async () => {
	const catalog = await runDealWith('addProduct', { dealId: '5', productId: '12', lineFields: { quantity: 2 } }, (o) => ({ id: 3, ...o.body }));
	assert.deepEqual(summary(catalog.calls), [`POST ${D}/5/products {"product_id":"12","quantity":2}`]);

	const custom = await runDealWith('addProduct', { dealId: '5', productId: '', lineFields: { name: ' Setup ', unitPrice: 0 } }, () => ({ id: 4 }));
	assert.deepEqual(summary(custom.calls), [`POST ${D}/5/products {"name":"Setup","unit_price":0,"quantity":1}`]);

	const updated = await runDealWith('updateProduct', { dealId: '5', lineId: '3', lineUpdateFields: { quantity: 3, name: '' } }, () => ({ id: 3 }));
	assert.deepEqual(summary(updated.calls), [`PATCH ${D}/5/products/3 {"quantity":3}`]);

	const deleted = await runDealWith('deleteProduct', { dealId: '5', lineId: '3' }, () => undefined);
	assert.deepEqual(summary(deleted.calls), [`DELETE ${D}/5/products/3 null`]);
	assert.deepEqual(deleted.items, [{ deleted: true, id: '3' }]);

	const listed = await runDealWith('getProducts', { dealId: '5' }, () => [{ id: 3 }, { id: 4 }]);
	assert.deepEqual(summary(listed.calls), [`GET ${D}/5/products null`]);
	assert.equal(listed.items.length, 2);
});

test('deal products: refusals before any request', async () => {
	const cases = [
		['addProduct', { dealId: '5', productId: '', lineFields: {} }, /Choose a product/],
		['addProduct', { dealId: '5', productId: '', lineFields: { name: 'Setup' } }, /Choose a product/],
		['addProduct', { dealId: '5', productId: '', lineFields: { unitPrice: 10 } }, /Choose a product/],
		['updateProduct', { dealId: '5', lineId: '3', lineUpdateFields: {} }, /at least one field/],
		['deleteProduct', { dealId: '5', lineId: '3/../9' }, /'Product Line ID' must be a number, but got "3\/\.\.\/9"$/],
		['deleteNote', { dealId: 'abc', noteId: '1' }, /'Deal ID' must be a number, but got "abc"$/],
	];
	for (const [operation, parameters, message] of cases) {
		const calls = [];
		const ctx = execContext({ parameters: { resource: 'deal', operation, ...parameters }, calls });
		await assert.rejects(new WebzzConnect().execute.call(ctx), message);
		assert.equal(calls.length, 0, operation);
	}
});

test('loadOptions getProducts: catalog from /crm/products with a None option', async () => {
	const calls = [];
	const ctx = {
		getNode: () => node,
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
		getCredentials: async () => ({ oauthTokenData: { account_id: 7 } }),
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push(`${options.method} ${options.url}`);
				return [{ id: 12, name: 'Pro plan' }];
			},
		},
	};
	const options = await new WebzzConnect().methods.loadOptions.getProducts.call(ctx);
	assert.deepEqual(calls, [`GET ${BASE}/api/v1/accounts/7/crm/products`]);
	assert.deepEqual(options, [{ name: 'None (Custom Line)', value: '' }, { name: 'Pro plan', value: '12' }]);
});

// --- Node version 1.2 (0.7.0): resource locators, Simplify, owner picker, copy ---

const rl = (value, mode = 'list') => ({ __rl: true, mode, value });

async function run12({ parameters, respond = () => ({}), typeVersion = 1.2 }) {
	const calls = [];
	const ctx = execContext({ parameters, calls, typeVersion });
	ctx.helpers.httpRequestWithAuthentication = async (credential, options) => {
		calls.push({ method: options.method, url: options.url, body: options.body, qs: options.qs });
		return respond(options);
	};
	const out = await new WebzzConnect().execute.call(ctx);
	return { calls, items: out[0].map((entry) => entry.json) };
}

test('v1.2: a resource locator Contact ID hits /contacts/5; a v1 string still does', async () => {
	const fromList = await run12({ parameters: { resource: 'contact', operation: 'get', contactId: rl('5') } });
	assert.deepEqual(summary(fromList.calls), [`GET ${BASE}/api/v1/accounts/7/contacts/5 null`]);
	const byId = await run12({ parameters: { resource: 'contact', operation: 'get', contactId: rl('5', 'id') } });
	assert.deepEqual(summary(byId.calls), [`GET ${BASE}/api/v1/accounts/7/contacts/5 null`]);
	const v1 = await run12({ parameters: { resource: 'contact', operation: 'get', contactId: '5' }, typeVersion: 1 });
	assert.deepEqual(summary(v1.calls), [`GET ${BASE}/api/v1/accounts/7/contacts/5 null`]);
	const deal = await run12({ parameters: { resource: 'deal', operation: 'get', dealId: rl('9') } });
	assert.deepEqual(summary(deal.calls), [`GET ${A}/deals/9 null`]);
	const conversation = await run12({ parameters: { resource: 'conversation', operation: 'get', conversationId: rl('4') } });
	assert.deepEqual(summary(conversation.calls), [`GET ${C}/4 null`]);
});

test('v1.2: Deal Create sends the locator contact as contact_id; a non-numeric one is refused', async () => {
	const { calls } = await run12({
		parameters: { resource: 'deal', operation: 'create', title: 'T', contactId: rl('5'), pipelineId: '', stageId: '' },
		respond: () => ({ id: 1 }),
	});
	assert.deepEqual(summary(calls), [`POST ${A}/deals {"title":"T","contact_id":"5"}`]);
	const refused = [];
	await assert.rejects(
		run12({ parameters: { resource: 'deal', operation: 'create', title: 'T', contactId: rl('Dana', 'id') }, respond: (o) => refused.push(o) }),
		(error) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /^'Contact ID' must be a number, but got "Dana"$/);
			return true;
		},
	);
	assert.equal(refused.length, 0);
	// Conversation Create and the template send validate the contact the same way.
	await assert.rejects(
		run12({ parameters: { resource: 'conversation', operation: 'create', inboxId: '3', contactId: 'x' }, typeVersion: 1 }),
		/'Contact ID' must be a number/,
	);
});

const RAW_CONTACT = {
	id: 5, name: 'Dana', email: 'dana@example.com', phone_number: '+15550001111', identifier: null, blocked: false,
	custom_attributes: { plan: 'pro' }, additional_attributes: { city: 'Haifa' }, thumbnail: '', availability_status: 'offline',
	last_activity_at: 1, created_at: 2, contact_inboxes: [], wz_internal: 1,
};
const RAW_DEAL = {
	id: 9, title: 'Website', value: '100.0', currency: 'ILS', position: 1, pipeline_id: 2, stage_id: 3, status: 'open',
	contact: { id: 5, name: 'Dana', phone_number: '+15550001111', email: 'dana@example.com', thumbnail: '', labels: [] },
	owner: { id: 11, name: 'Maya', thumbnail: '' }, lost_reason: null, custom_attributes: {}, created_at: 1, updated_at: 2,
};
const RAW_CONVERSATION = {
	id: 4, status: 'open', inbox_id: 3, uuid: 'u', can_reply: true, labels: ['vip'], custom_attributes: { step: 1 },
	unread_count: 2, last_activity_at: 3, timestamp: 3, priority: null,
	meta: { sender: { id: 5, name: 'Dana', phone_number: '+15550001111', email: 'x' }, assignee: { id: 11, name: 'Maya', email: 'm' }, channel: 'Channel::Whatsapp' },
	messages: [{ id: 70, content: 'Hi there' }],
};

test('Simplify: trims Contact Get, Deal Get and Conversation Get Many to at most 10 keys; off or v1 returns raw', async () => {
	const contact = (simplify, typeVersion = 1.2) =>
		run12({ parameters: { resource: 'contact', operation: 'get', contactId: rl('5'), simplify }, respond: () => ({ payload: RAW_CONTACT }), typeVersion });
	const simple = (await contact(true)).items[0];
	assert.deepEqual(Object.keys(simple), ['id', 'name', 'email', 'phone_number', 'identifier', 'blocked', 'custom_attributes', 'last_activity_at', 'created_at']);
	const raw = (await contact(false)).items[0];
	assert.equal(raw.additional_attributes.city, 'Haifa');
	assert.equal(raw.wz_internal, undefined);
	assert.deepEqual((await contact(true, 1.1)).items[0], raw);

	const deal = (simplify, typeVersion = 1.2) =>
		run12({ parameters: { resource: 'deal', operation: 'get', dealId: rl('9'), simplify }, respond: () => RAW_DEAL, typeVersion });
	assert.deepEqual((await deal(true)).items[0], {
		id: 9, title: 'Website', value: '100.0', currency: 'ILS', status: 'open', pipeline_id: 2, stage_id: 3,
		contact: { id: 5, name: 'Dana', phone_number: '+15550001111', email: 'dana@example.com' },
		owner: { id: 11, name: 'Maya' }, updated_at: 2,
	});
	assert.deepEqual((await deal(false)).items[0], RAW_DEAL);
	assert.deepEqual((await deal(true, 1)).items[0], RAW_DEAL);
	const ownerless = await run12({ parameters: { resource: 'deal', operation: 'get', dealId: rl('9'), simplify: true }, respond: () => ({ ...RAW_DEAL, owner: null }) });
	assert.equal(ownerless.items[0].owner, null);

	const many = (simplify, typeVersion = 1.2) =>
		run12({
			parameters: { resource: 'conversation', operation: 'getAll', filters: {}, returnAll: false, limit: 5, simplify },
			respond: () => ({ data: { payload: [RAW_CONVERSATION] } }),
			typeVersion,
		});
	const [conversation] = (await many(true)).items;
	assert.deepEqual(conversation, {
		id: 4, status: 'open', inbox_id: 3, contact: { id: 5, name: 'Dana', phone_number: '+15550001111' },
		assignee: { id: 11, name: 'Maya' }, labels: ['vip'], custom_attributes: { step: 1 }, last_message: 'Hi there',
		unread_count: 2, last_activity_at: 3,
	});
	for (const item of [simple, (await deal(true)).items[0], conversation]) assert.ok(Object.keys(item).length <= 10);
	// The last entry of messages can be an activity: last_non_activity_message wins when present.
	const withActivity = {
		...RAW_CONVERSATION,
		messages: [{ id: 71, content: 'Assigned to Maya by Default Policy', message_type: 2 }],
		last_non_activity_message: { id: 70, content: 'Hi there', message_type: 0 },
	};
	const activity = await run12({
		parameters: { resource: 'conversation', operation: 'get', conversationId: rl('4'), simplify: true },
		respond: () => withActivity,
	});
	assert.equal(activity.items[0].last_message, 'Hi there');
	const noMessages = await run12({
		parameters: { resource: 'conversation', operation: 'get', conversationId: rl('4'), simplify: true },
		respond: () => ({ ...RAW_CONVERSATION, messages: [], last_non_activity_message: null }),
	});
	assert.equal(noMessages.items[0].last_message, null);
	assert.deepEqual((await many(false)).items[0], RAW_CONVERSATION);
	assert.deepEqual((await many(true, 1)).items[0], RAW_CONVERSATION);
});

function listContext(respond) {
	const calls = [];
	const ctx = {
		getNode: () => ({ ...node, typeVersion: 1.2 }),
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'oAuth2' : fallback),
		getCredentials: async () => ({ oauthTokenData: { account_id: 7 } }),
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ method: options.method, url: options.url, qs: options.qs });
				const answer = respond(options);
				if (answer?.httpCode) throw answer;
				return answer;
			},
		},
	};
	return { ctx, calls };
}

test('listSearch searchContacts: search with a filter, the contact list without; paginationToken is the next page', async () => {
	const methods = new WebzzConnect().methods.listSearch;
	const found = listContext(() => ({ meta: { has_more: true }, payload: [{ id: 5, name: 'Dana', phone_number: '+15550001111' }, { id: 6, name: 'Eli', email: 'eli@example.com' }, { id: 7, name: 'Noa' }] }));
	const result = await methods.searchContacts.call(found.ctx, 'da', '2');
	assert.deepEqual(found.calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.qs)}`), [
		`GET ${BASE}/api/v1/accounts/7/contacts/search {"q":"da","page":2}`,
	]);
	assert.deepEqual(result, {
		results: [
			{ name: 'Dana (+15550001111)', value: '5', url: `${BASE}/app/accounts/7/contacts/5` },
			{ name: 'Eli (eli@example.com)', value: '6', url: `${BASE}/app/accounts/7/contacts/6` },
			{ name: 'Noa (#7)', value: '7', url: `${BASE}/app/accounts/7/contacts/7` },
		],
		paginationToken: '3',
	});

	const lastPage = listContext(() => ({ meta: { has_more: false }, payload: [{ id: 5, name: 'Dana' }] }));
	assert.equal((await methods.searchContacts.call(lastPage.ctx, 'da')).paginationToken, undefined);

	const full = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `C${index}` }));
	const all = listContext(() => ({ meta: { count: 250, current_page: 1 }, payload: full }));
	const listed = await methods.searchContacts.call(all.ctx, '');
	assert.deepEqual(all.calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.qs)}`), [`GET ${BASE}/api/v1/accounts/7/contacts {"page":1}`]);
	assert.equal(listed.results.length, 100);
	assert.equal(listed.paginationToken, '2');
	const short = listContext(() => ({ meta: { count: 1 }, payload: [{ id: 1, name: 'A' }] }));
	assert.equal((await methods.searchContacts.call(short.ctx)).paginationToken, undefined);
});

test('listSearch searchConversations: a number is one GET (404 is empty); text searches contacts, then their conversations', async () => {
	const methods = new WebzzConnect().methods.listSearch;
	const one = listContext(() => RAW_CONVERSATION);
	assert.deepEqual(await methods.searchConversations.call(one.ctx, '4'), {
		results: [{ name: '#4 · Dana · open', value: '4', url: `${BASE}/app/accounts/7/conversations/4` }],
	});
	assert.deepEqual(one.calls.map((c) => `${c.method} ${c.url}`), [`GET ${C}/4`]);

	const missing = listContext(() => refusal(404, { error: 'Resource could not be found' }));
	assert.deepEqual(await methods.searchConversations.call(missing.ctx, '999'), { results: [] });

	// Text: the first page of matching contacts, the conversations of the first five, newest activity first.
	const contacts = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, name: `Dana ${index}` }));
	const conversationsOf = {
		1: [{ id: 40, status: 'open', last_activity_at: 100, meta: { sender: { name: 'Dana 0' } } }],
		2: [
			{ id: 41, status: 'resolved', last_activity_at: 300, meta: { sender: { name: 'Dana 1' } } },
			{ id: 42, status: 'open', last_activity_at: 50, meta: { sender: { name: 'Dana 1' } } },
		],
		3: [],
		4: [{ id: 43, status: 'pending', last_activity_at: 200, meta: { sender: { name: 'Dana 3' } } }],
		5: [],
	};
	const byText = listContext((options) => {
		if (options.url.endsWith('/contacts/search')) return { meta: { has_more: true }, payload: contacts };
		const id = /\/contacts\/(\d+)\/conversations$/.exec(options.url)[1];
		return { payload: conversationsOf[id] };
	});
	const result = await methods.searchConversations.call(byText.ctx, 'dana', '3');
	const urls = byText.calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.qs ?? null)}`);
	assert.deepEqual(urls[0], `GET ${BASE}/api/v1/accounts/7/contacts/search {"q":"dana","page":1}`);
	assert.deepEqual(urls.slice(1).sort(), [1, 2, 3, 4, 5].map((id) => `GET ${BASE}/api/v1/accounts/7/contacts/${id}/conversations null`));
	assert.deepEqual(result, {
		results: [
			{ name: '#41 · Dana 1 · resolved', value: '41', url: `${C.replace('/api/v1', '/app')}/41` },
			{ name: '#43 · Dana 3 · pending', value: '43', url: `${C.replace('/api/v1', '/app')}/43` },
			{ name: '#40 · Dana 0 · open', value: '40', url: `${C.replace('/api/v1', '/app')}/40` },
			{ name: '#42 · Dana 1 · open', value: '42', url: `${C.replace('/api/v1', '/app')}/42` },
		],
	});

	// No filter: all conversations, page by page.
	const full = Array.from({ length: 25 }, (_, index) => ({ ...RAW_CONVERSATION, id: index + 1 }));
	const page = listContext(() => ({ data: { meta: {}, payload: full } }));
	const listed = await methods.searchConversations.call(page.ctx, '', '2');
	assert.deepEqual(page.calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.qs)}`), [`GET ${C} {"status":"all","page":2}`]);
	assert.equal(listed.results.length, 25);
	assert.equal(listed.paginationToken, '3');
});

test('listSearch searchDeals and getOwners: /crm/deals with q and page, people from /agents', async () => {
	const methods = new WebzzConnect().methods;
	const deals = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, title: `D${index}`, contact: { name: 'Dana' } }));
	const found = listContext(() => ({ payload: deals }));
	const result = await methods.listSearch.searchDeals.call(found.ctx, 'web');
	assert.deepEqual(found.calls.map((c) => `${c.method} ${c.url} ${JSON.stringify(c.qs)}`), [`GET ${A}/deals {"q":"web","page":1}`]);
	assert.deepEqual(result.results[0], { name: 'D0 · Dana', value: '1' });
	assert.equal(result.paginationToken, '2');

	const people = listContext(() => [{ id: 11, available_name: 'Maya', name: 'Maya K' }, { id: 12, name: 'Ron' }]);
	assert.deepEqual(await methods.loadOptions.getOwners.call(people.ctx), [
		{ name: 'Maya', value: '11' },
		{ name: 'Ron', value: '12' },
	]);
	assert.deepEqual(people.calls.map((c) => c.url), [`${BASE}/api/v1/accounts/7/agents`]);
});

// Every property, including the options of collections and the values of fixed collections.
function allProperties(properties) {
	return properties.flatMap((property) => [
		property,
		...allProperties((property.options ?? []).filter((option) => option.displayName)),
		...allProperties((property.options ?? []).flatMap((option) => option.values ?? [])),
	]);
}
const description = new WebzzConnect().description;

test('description: Resource lists Connection; ID fields are text before 1.2 and resource locators from 1.2', () => {
	assert.deepEqual(description.properties.find((p) => p.name === 'resource').options.map((o) => o.value), [
		'connection', 'contact', 'conversation', 'deal', 'whatsAppTemplate',
	]);
	for (const name of ['contactId', 'dealId', 'conversationId']) {
		const variants = description.properties.filter((p) => p.name === name);
		assert.ok(variants.some((p) => p.type === 'string' && p.displayOptions.show['@version'].join() === '1,1.1'), name);
		const locators = variants.filter((p) => p.type === 'resourceLocator');
		assert.ok(locators.length > 0, name);
		for (const locator of locators) {
			assert.deepEqual(locator.displayOptions.show['@version'], [{ _cnd: { gte: 1.2 } }]);
			assert.deepEqual(locator.modes.map((mode) => mode.name), ['list', 'id']);
		}
	}
	const owners = allProperties(description.properties).filter((p) => p.name === 'ownerId');
	assert.ok(owners.some((p) => p.type === 'options' && p.typeOptions.loadOptionsMethod === 'getOwners'));
});

test('codex: the node field is the scoped node type', () => {
	const fs = require('fs');
	const path = require('path');
	const codex = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nodes', file), 'utf8')).node;
	assert.equal(codex('WebzzConnect/WebzzConnect.node.json'), '@webzzconnect/n8n-nodes-webzzconnect.webzzConnect');
	assert.equal(codex('WebzzConnectTrigger/WebzzConnectTrigger.node.json'), '@webzzconnect/n8n-nodes-webzzconnect.webzzConnectTrigger');
});

test('copy: actions have no articles, placeholders start with e.g., error copy avoids blame words', () => {
	const trigger = new WebzzConnectTrigger().description;
	const properties = allProperties([...description.properties, ...trigger.properties]);
	const actions = properties.flatMap((p) => (p.options ?? []).map((o) => o.action).filter(Boolean));
	assert.ok(actions.length > 30);
	for (const action of actions) assert.doesNotMatch(action, /(^|\s)(a|an|the)(\s|$)/i, action);

	const placeholders = [
		...properties.map((p) => p.placeholder),
		...properties.flatMap((p) => (p.modes ?? []).map((mode) => mode.placeholder)),
	].filter(Boolean);
	for (const placeholder of placeholders) {
		if (!placeholder.startsWith('Add ')) assert.match(placeholder, /^e\.g\. /, placeholder);
	}

	const { COPY, ERROR_COPY } = require('../dist/nodes/WebzzConnect/GenericFunctions.js');
	for (const text of [...Object.values(COPY), ...Object.values(ERROR_COPY)]) {
		assert.doesNotMatch(text.replace(/\([a-z_]+\)$/, ''), /error|problem|failure|mistake/i, text);
	}
});
