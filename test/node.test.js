// Unit tests against the built package (run `npm run build` first). Uses node:test, no extra deps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');

const { WebzzConnectTrigger } = require('../dist/nodes/WebzzConnectTrigger/WebzzConnectTrigger.node.js');
const { WebzzConnect } = require('../dist/nodes/WebzzConnect/WebzzConnect.node.js');
const { errorForItem } = require('../dist/nodes/WebzzConnect/GenericFunctions.js');

const node = { name: 'WebzzConnect', type: 'webzzConnect', typeVersion: 1, position: [0, 0], parameters: {} };
const BASE = 'https://connect.webzz.cloud';

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

function execContext({ parameters, response = {}, authentication = 'oAuth2', calls }) {
	return {
		getNode: () => node,
		getInputData: () => [{ json: {} }],
		continueOnFail: () => false,
		getNodeParameter: (name, _i, fallback) => {
			if (name === 'authentication') return authentication;
			return name in parameters ? parameters[name] : fallback;
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
	assert.match(field(oauth, 'authUrl').default, /^https:\/\/connect\.webzz\.cloud\/oauth\/authorize$/);
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
		/Choose an agent, a team, or both/,
	);
});

test('assign: the hand-off note is sent only when filled, on the agent call', async () => {
	const run = (note) =>
		script('conversation', 'assign', { conversationId: '4', agentId: 'AgentBot:5', teamId: '3', handoffNote: note }, okAssign('account_key'));
	assert.deepEqual(posts((await run('')).calls), [{ team_id: 3 }, { assignee_id: '5', assignee_type: 'AgentBot' }]);
	assert.deepEqual(posts((await run('Wants a quote')).calls), [
		{ team_id: 3 },
		{ assignee_id: '5', assignee_type: 'AgentBot', handoff_note: 'Wants a quote' },
	]);
	// A team-only change carries the note too, so the server refuses it (it is never silently dropped).
	const teamOnly = await script('conversation', 'assign', { conversationId: '4', teamId: '3', handoffNote: 'x' }, okAssign());
	assert.deepEqual(posts(teamOnly.calls), [{ team_id: 3, handoff_note: 'x' }]);
});

test('assign: team and agent on a virtual agent connection stop before any write (fail closed)', async () => {
	const params = { conversationId: '4', agentId: '11', teamId: '3' };
	for (const [answer, pattern] of [
		[kindOf('agent'), /Choose an agent or a team, not both.*\(handoff_one_target\)/],
		[{ account: { id: 7 } }, /Could not tell what this credential acts as/],
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

test('errors: each mapped code shows its copy with [status] and (code); others keep the server message', async () => {
	const cases = [
		[403, { error: 'agent_paused', message: 'Hebrew text' }, /^\[403\] The virtual agent is paused.*\(agent_paused\)$/],
		[409, { error: 'not_handling', error_code: 'not_handling' }, /^\[409\] This virtual agent isn't handling.*\(not_handling\)$/],
		[422, { error_code: 'assignee_not_available', message: 'Alice Smith is gone' }, /^\[422\] That person or virtual agent can't take.*\(assignee_not_available\)$/],
		[422, { error_code: 'conversation_resolved' }, /^\[422\] A virtual agent can't be assigned to a resolved.*\(conversation_resolved\)$/],
		[422, { error_code: 'handoff_note_not_allowed' }, /^\[422\] Only the virtual agent handling.*\(handoff_note_not_allowed\)$/],
		[422, { error_code: 'handoff_note_invalid' }, /^\[422\] The hand-off note must be 1 to 500.*\(handoff_note_invalid\)$/],
		[403, { error: 'insufficient_scope', message: 'Needs deals:edit' }, /^\[403\] This connection isn't allowed.*\(Needs deals:edit\)$/],
		[422, { error_code: 'something_else', message: 'Server says no' }, /^Server says no$/],
		[409, { error: 'other', message: 'Server conflict' }, /^Server conflict$/],
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
		{ name: 'Sales bot (virtual agent)', value: 'AgentBot:5' },
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
	await assert.rejects(snooze({ status: 'snoozed', snoozeUntil: 'soon' }), /not a valid date/);
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
	await assert.rejects(runConversation('sendMessage', { conversationId: '4', content: '' }), /Enter a message, a File URL, or both/);
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
		/Missing value for: Header text variable, Body variable first_name, Button 2 URL variable/,
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
	await assert.rejects(run({ messageType: 'button', content: '', buttons: { values: [{ title: 'a' }] } }), /Enter the Message/);
	await assert.rejects(
		run({ messageType: 'button', content: 'x', buttons: { values: [{ title: 'a' }] }, interactiveOptions: { headerType: 'image' } }),
		/Header Media URL/,
	);
	for (const headerType of [undefined, 'none', 'text']) {
		await assert.rejects(
			run({ messageType: 'button', content: 'x', buttons: { values: [{ title: 'a' }] }, interactiveOptions: { headerType, headerText: 'Hi', headerMediaUrl: 'https://x.com/a.png' } }),
			/Choose Header Type Image, Video or Document to use Header Media URL/,
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
		assert.match(error.message, /is not a valid ID/);
		return true;
	});
	assert.equal(calls.length, 0);
	const ok = await runConversation('get', { conversationId: ' 5 ' }, { id: 5 });
	assert.deepEqual(summary(ok.calls), [`GET ${C}/5 null`]);
});
