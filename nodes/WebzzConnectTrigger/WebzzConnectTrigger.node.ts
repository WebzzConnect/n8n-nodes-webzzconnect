import { createHmac, timingSafeEqual } from 'crypto';

import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	asArray,
	asObject,
	handleApiError,
	pathId,
	readErrorInfo,
	stripInternalKeys,
	wzApiRequest,
	wzRawRequest,
	authenticationProperty,
} from '../WebzzConnect/GenericFunctions';

const INBOX_EVENTS = [
	'conversation_created',
	'conversation_handed_off',
	'conversation_status_changed',
	'conversation_updated',
	'message_created',
];
const DEAL_EVENTS = [
	'deal_created',
	'deal_deleted',
	'deal_lost',
	'deal_stage_changed',
	'deal_updated',
	'deal_won',
];

const DIRECTION_HELP =
	'Applies to new and updated messages. Keep Incoming for a reply bot: your virtual agent\'s own replies and their status updates also arrive here, and answering them makes the bot talk to itself.';

/** Deliveries older (or newer) than this many seconds are rejected as replays. */
const MAX_SKEW_SECONDS = 5 * 60;

interface StoredSubscription {
	id?: number | string;
	secret?: string;
}

function messageTypeOf(body: IDataObject): string {
	const raw = body.message_type;
	if (raw === 0 || raw === '0') return 'incoming';
	if (raw === 1 || raw === '1') return 'outgoing';
	return String(raw ?? '');
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function remove(ctx: IHookFunctions, id: number | string) {
	return wzRawRequest.call(ctx, 'DELETE', `/webhook_subscriptions/${pathId.call(ctx, id)}`);
}

/** Selected ids of an optional multiOptions picker, or undefined when nothing is selected. */
function idsOf(ctx: IHookFunctions, name: string, shownFor: string[]): number[] | undefined {
	const events = ctx.getNodeParameter('events') as string[];
	if (!events.some((event) => shownFor.includes(event))) return undefined;
	const ids = ((ctx.getNodeParameter(name, []) as Array<string | number>) ?? [])
		.map(Number)
		.filter((id) => Number.isInteger(id) && id > 0);
	return ids.length > 0 ? ids : undefined;
}

export class WebzzConnectTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WebzzConnect Trigger',
		name: 'webzzConnectTrigger',
		icon: { light: 'file:webzzconnect.svg', dark: 'file:webzzconnect.dark.svg' },
		group: ['trigger'],
		version: [1, 1.1],
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow instantly when something happens in WebzzConnect',
		defaults: { name: 'WebzzConnect Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'webzzConnectApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'webzzConnectOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: 'noData',
				path: 'webhook',
			},
		],
		properties: [
			authenticationProperty,
			{
				displayName:
					'With a virtual agent connection, keep this workflow active: it is what keeps the agent listening. While it is off, new conversations go to your team, and each conversation the agent holds goes to your team when the customer writes next. To stop the bot, pause the virtual agent in WebzzConnect. Deactivate the workflow before you switch its credential.',
				name: 'listeningNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['message_created'],
				options: [
					{ name: 'Contact Created', value: 'contact_created' },
					{ name: 'Contact Updated', value: 'contact_updated' },
					{
						name: 'Conversation Handed Off',
						value: 'conversation_handed_off',
						description:
							'A virtual agent handed a conversation to a person, another virtual agent or the team. Includes who handed it off (handoff.from), to whom (handoff.to, type agent, person or team), the note (handoff.note) and the customer\'s message still waiting for an answer (handoff.waiting_message). Sent at least once: skip a repeat with the same waiting message ID, when there is one. For the team, handoff.to has no ID or name.',
					},
					{ name: 'Conversation Status Changed', value: 'conversation_status_changed' },
					{ name: 'Conversation Updated', value: 'conversation_updated' },
					{ name: 'Deal Created', value: 'deal_created' },
					{ name: 'Deal Deleted', value: 'deal_deleted' },
					{ name: 'Deal Lost', value: 'deal_lost' },
					{ name: 'Deal Stage Changed', value: 'deal_stage_changed' },
					{ name: 'Deal Updated', value: 'deal_updated' },
					{ name: 'Deal Won', value: 'deal_won' },
					{ name: 'New Conversation', value: 'conversation_created' },
					{
						name: 'New Message',
						value: 'message_created',
						description:
							'With a virtual agent connection you receive only the conversations the agent handles. When a person replies from the dashboard or app, they take the conversation over and its events stop. To see who handles a conversation, read its assignee and assignee type. A tap on a reply button or list row arrives with its ID in button_payload; compare it with Equals and keep a fallback, never use it in a Code node, a URL or an ID field. Flows on an account key: a person replied when message_type is outgoing, private is false, content_attributes.automation_rule_id is empty, and sender.type is "user" or content_attributes.external_echo is true. WhatsApp campaign and scheduled template sends arrive with message_type "template", so they never match.',
					},
				],
				description:
					'Events to listen to. The connected person or virtual agent needs access to the data behind each event.',
			},
			{
				displayName: 'Message Direction',
				name: 'messageType',
				type: 'options',
				default: 'any',
				displayOptions: { show: { events: ['message_created'], '@version': [1] } },
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Incoming (From Contacts)', value: 'incoming' },
					{ name: 'Outgoing (From Agents and Bots)', value: 'outgoing' },
				],
				description: DIRECTION_HELP,
			},
			{
				displayName: 'Message Direction',
				name: 'messageType',
				type: 'options',
				default: 'incoming',
				displayOptions: { show: { events: ['message_created'] }, hide: { '@version': [1] } },
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Incoming (From Contacts)', value: 'incoming' },
					{ name: 'Outgoing (From Agents and Bots)', value: 'outgoing' },
				],
				description: DIRECTION_HELP,
			},
			{
				displayName: 'Inbox Names or IDs',
				name: 'inboxIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getInboxes' },
				default: [],
				displayOptions: { show: { events: INBOX_EVENTS } },
				description:
					'Only conversations and messages in these inboxes start the workflow. Leave empty for all inboxes. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Pipeline Names or IDs',
				name: 'pipelineIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getPipelines' },
				default: [],
				displayOptions: { show: { events: DEAL_EVENTS } },
				description:
					'Only deals in these pipelines start the workflow. Leave empty for all pipelines. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxes = asArray(await wzApiRequest.call(this, 'GET', '/inboxes'));
				return inboxes.map((inbox) => ({ name: String(inbox.name), value: String(inbox.id) }));
			},

			async getPipelines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const pipelines = asArray(await wzApiRequest.call(this, 'GET', '/crm/pipelines'));
				return pipelines.map((pipeline) => ({
					name: String(pipeline.name),
					value: String(pipeline.id),
				}));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node') as StoredSubscription;
				if (stored.id === undefined || !stored.secret) return false;
				let subscription: IDataObject;
				try {
					subscription = asObject(
						await wzRawRequest.call(
							this,
							'GET',
							`/webhook_subscriptions/${pathId.call(this, stored.id)}`,
						),
					);
				} catch (error) {
					if (readErrorInfo(error).status === 404) {
						delete stored.id;
						delete stored.secret;
						return false;
					}
					return handleApiError.call(this, error);
				}
				if (subscription.url === this.getNodeWebhookUrl('default')) return true;
				// The webhook URL changed (e.g. a new n8n host): drop the subscription that still
				// delivers to the old URL so create() subscribes the current one.
				await remove(this, stored.id).catch((error) => {
					if (readErrorInfo(error).status !== 404) return handleApiError.call(this, error);
					return undefined;
				});
				delete stored.id;
				delete stored.secret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node') as StoredSubscription;
				const url = this.getNodeWebhookUrl('default') as string;
				const body: IDataObject = {
					url,
					subscriptions: this.getNodeParameter('events') as string[],
				};
				const inboxIds = idsOf(this, 'inboxIds', INBOX_EVENTS);
				if (inboxIds) body.inbox_ids = inboxIds;
				const pipelineIds = idsOf(this, 'pipelineIds', DEAL_EVENTS);
				if (pipelineIds) body.pipeline_ids = pipelineIds;

				const subscribe = async (): Promise<IDataObject> => {
					try {
						return asObject(await wzRawRequest.call(this, 'POST', '/webhook_subscriptions', { body }));
					} catch (error) {
						return handleApiError.call(this, error);
					}
				};

				let subscription = await subscribe();
				if (!subscription.secret) {
					// Posting the same URL again returns the existing subscription without its secret
					// (shown only once). Rotate it: the row stays, so an agent is never left without one.
					try {
						subscription = asObject(
							await wzRawRequest.call(
								this,
								'POST',
								`/webhook_subscriptions/${pathId.call(this, subscription.id)}/rotate_secret`,
							),
						);
					} catch (error) {
						return handleApiError.call(this, error);
					}
				}
				if (subscription.id === undefined || !subscription.secret) {
					throw new NodeOperationError(
						this.getNode(),
						'WebzzConnect did not return a webhook secret. Deactivate and activate the workflow again.',
					);
				}
				stored.id = subscription.id as number;
				stored.secret = subscription.secret as string;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node') as StoredSubscription;
				if (stored.id !== undefined) {
					try {
						await remove(this, stored.id);
					} catch (error) {
						const status = readErrorInfo(error).status;
						if (status === 401) {
							// A revoked credential must not block deactivation. Hooks have no toast: log the fixed copy and the id only.
							this.logger.warn(
								`Couldn't remove WebzzConnect webhook subscription ${String(stored.id)}: the credential is no longer valid. It may keep sending events to this URL until it's removed in WebzzConnect → Settings → App webhooks.`,
							);
						} else if (status !== 404) {
							// 404: already gone, nothing left to clean up on our side.
							return handleApiError.call(this, error);
						}
					}
				}
				delete stored.id;
				delete stored.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const stored = this.getWorkflowStaticData('node') as StoredSubscription;
		const reject = (reason: string): IWebhookResponseData => {
			res.status(401).json({ message: reason });
			return { noWebhookResponse: true };
		};

		const headers = this.getHeaderData();
		const signature = String(headers['x-webzzconnect-signature'] ?? '');
		const timestamp = String(headers['x-webzzconnect-timestamp'] ?? '');
		const rawBody = (req as { rawBody?: Buffer | string }).rawBody;

		if (!stored.secret || !signature || !timestamp || rawBody === undefined) {
			return reject('Missing signature');
		}

		const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
		if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_SKEW_SECONDS) {
			return reject('Stale timestamp');
		}

		const expected = `sha256=${createHmac('sha256', stored.secret)
			.update(`${timestamp}.`)
			.update(rawBody)
			.digest('hex')}`;
		if (!safeEqual(expected, signature)) return reject('Invalid signature');

		const body = this.getBodyData();
		const events = this.getNodeParameter('events') as string[];
		if (typeof body.event === 'string' && !events.includes(body.event)) {
			return {};
		}
		// Every message event (created and updated): a bot's own replies and their status updates must not loop.
		if (typeof body.event === 'string' && body.event.startsWith('message_')) {
			const wanted = this.getNodeParameter('messageType', 'any') as string;
			if (wanted !== 'any' && messageTypeOf(body) !== wanted) {
				return {};
			}
		}

		const output = stripInternalKeys(body);
		if (body.event === 'message_created') {
			// A tap on a template quick reply, reply button or list row; null for typed text.
			const payload = asObject(body.content_attributes).button_payload;
			output.button_payload = payload === undefined || payload === null ? null : String(payload);
		}

		return {
			workflowData: [this.helpers.returnJsonArray(output)],
		};
	}
}
