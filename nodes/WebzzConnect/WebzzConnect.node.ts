import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { conversationFields, conversationOperations } from './descriptions/ConversationDescription';
import { dealFields, dealOperations } from './descriptions/DealDescription';
import {
	whatsAppTemplateFields,
	whatsAppTemplateOperations,
} from './descriptions/WhatsAppTemplateDescription';
import {
	asArray,
	asObject,
	authenticationProperty,
	digitsOnly,
	errorForItem,
	handleApiError,
	pairsToObject,
	pathId,
	phonesMatch,
	readErrorInfo,
	stripInternalKeys,
	unwrapContact,
	wzApiRequest,
	wzPaginate,
	wzRawRequest,
} from './GenericFunctions';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

function compact(values: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === null || value === '') continue;
		out[key] = value;
	}
	return out;
}

/** Builds the contact request body from the node's field collections. */
function contactBody(fields: IDataObject): IDataObject {
	const body = compact({
		name: fields.name,
		email: fields.email,
		phone_number: fields.phoneNumber,
		identifier: fields.identifier,
	});
	const additional = compact({
		city: fields.city,
		company_name: fields.companyName,
		country: fields.country,
	});
	if (Object.keys(additional).length > 0) body.additional_attributes = additional;
	const custom = pairsToObject(fields.customAttributes as IDataObject | undefined);
	if (Object.keys(custom).length > 0) body.custom_attributes = custom;
	return body;
}

function dealBody(fields: IDataObject): IDataObject {
	const body = compact({
		title: fields.title,
		value: fields.value === 0 ? 0 : fields.value,
		currency: fields.currency,
		owner_id: fields.ownerId,
		expected_close_at: fields.expectedCloseAt,
	});
	const custom = pairsToObject(fields.customAttributes as IDataObject | undefined);
	if (Object.keys(custom).length > 0) body.custom_attributes = custom;
	return body;
}

/** Finds an existing contact by exact email or by phone (national or international form). */
async function findContact(
	this: IExecuteFunctions,
	email: string,
	phone: string,
): Promise<IDataObject | undefined> {
	const search = async (q: string): Promise<IDataObject[]> => {
		const response = await wzApiRequest.call(this, 'GET', '/contacts/search', { qs: { q } });
		return asArray(response);
	};

	if (email) {
		const match = (await search(email)).find(
			(contact) => String(contact.email ?? '').toLowerCase() === email.toLowerCase(),
		);
		if (match) return match;
	}
	if (phone) {
		const national = digitsOnly(phone).replace(/^0+/, '');
		const queries = [...new Set([phone, national].filter((q) => q.length > 0))];
		for (const q of queries) {
			const match = (await search(q)).find((contact) =>
				phonesMatch(String(contact.phone_number ?? ''), phone),
			);
			if (match) return match;
		}
	}
	return undefined;
}

async function createOrUpdateContact(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const email = (this.getNodeParameter('email', i, '') as string).trim();
	const phone = (this.getNodeParameter('phoneNumber', i, '') as string).trim();
	if (!email && !phone) {
		throw new NodeOperationError(
			this.getNode(),
			'Provide an email or a phone number to find the contact',
			{ itemIndex: i },
		);
	}
	const fields = {
		name: this.getNodeParameter('name', i, '') as string,
		email,
		phoneNumber: phone,
		...(this.getNodeParameter('additionalFields', i, {}) as IDataObject),
	};
	const body = contactBody(fields);

	const update = async (match: IDataObject) => {
		const patch = { ...body };
		// The stored number is already the same one: re-sending it in a national format risks a
		// needless uniqueness error.
		if (phone && phonesMatch(String(match.phone_number ?? ''), phone)) delete patch.phone_number;
		return unwrapContact(
			await wzApiRequest.call(this, 'PATCH', `/contacts/${pathId.call(this, match.id)}`, {
				body: patch,
			}),
		);
	};

	const existing = await findContact.call(this, email, phone);
	if (existing) return await update(existing);

	try {
		const created = await wzRawRequest.call(this, 'POST', '/contacts', { body });
		return unwrapContact(created);
	} catch (error) {
		// Phone and email are unique per account. WebzzConnect normalizes a national phone number
		// to international form, so a miss above can still collide: look again and update instead.
		if (readErrorInfo(error).status === 422) {
			const retry = await findContact.call(this, email, phone);
			if (retry) return await update(retry);
		}
		return handleApiError.call(this, error);
	}
}

interface WhatsAppTemplate {
	name?: string;
	language?: string;
	category?: string;
	status?: string;
	components?: Array<{
		type?: string;
		text?: string;
		format?: string;
		buttons?: Array<{ type?: string; url?: string }>;
	}>;
}

async function fetchInboxes(this: Ctx): Promise<IDataObject[]> {
	return asArray(await wzApiRequest.call(this, 'GET', '/inboxes'));
}

/**
 * Team first, then agent: a team change clears or auto-picks the agent. The conversation is
 * re-fetched and checked, because an unknown id silently unassigns on the server.
 */
async function assignConversation(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	const agentId = String(this.getNodeParameter('agentId', i, '') ?? '');
	const teamId = String(this.getNodeParameter('teamId', i, '') ?? '');
	if (!agentId && !teamId) {
		throw new NodeOperationError(this.getNode(), 'Choose an agent, a team, or both', {
			itemIndex: i,
		});
	}
	if (teamId) {
		await wzApiRequest.call(this, 'POST', `/conversations/${id}/assignments`, {
			body: { team_id: Number(teamId) },
		});
	}
	if (agentId) {
		await wzApiRequest.call(this, 'POST', `/conversations/${id}/assignments`, {
			body: { assignee_id: Number(agentId) },
		});
	}
	const conversation = asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
	const meta = asObject(conversation.meta);
	if (agentId && String(asObject(meta.assignee).id ?? '') !== agentId) {
		throw new NodeOperationError(
			this.getNode(),
			`Agent ${agentId} was not assigned. Check that the agent exists and is a member of the conversation's inbox.`,
			{ itemIndex: i },
		);
	}
	if (teamId && String(asObject(meta.team).id ?? '') !== teamId) {
		throw new NodeOperationError(
			this.getNode(),
			`Team ${teamId} was not assigned. Check that the team exists.`,
			{ itemIndex: i },
		);
	}
	return conversation;
}

/** An explicit null clears the field server-side, so these bodies bypass compact(). */
async function unassignConversation(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	const from = this.getNodeParameter('unassignFrom', i, 'agent') as string;
	// Separate calls: assignee_id takes precedence over team_id when both are present.
	if (from === 'team' || from === 'both') {
		await wzApiRequest.call(this, 'POST', `/conversations/${id}/assignments`, {
			body: { team_id: null },
		});
	}
	if (from === 'agent' || from === 'both') {
		await wzApiRequest.call(this, 'POST', `/conversations/${id}/assignments`, {
			body: { assignee_id: null },
		});
	}
	return asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
}

/**
 * `status` is always sent: toggle_status flips the conversation when it is missing.
 * `snoozed_until` is Unix seconds and the key is omitted when empty (an empty value raises).
 */
async function updateConversationStatus(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	const status = this.getNodeParameter('status', i) as string;
	const body: IDataObject = { status };
	const snoozeUntil = status === 'snoozed' ? this.getNodeParameter('snoozeUntil', i, '') : '';
	if (snoozeUntil !== '' && snoozeUntil !== undefined && snoozeUntil !== null) {
		const millis = new Date(String(snoozeUntil)).getTime();
		if (Number.isNaN(millis)) {
			throw new NodeOperationError(this.getNode(), `"${String(snoozeUntil)}" is not a valid date`, {
				itemIndex: i,
			});
		}
		body.snoozed_until = Math.floor(millis / 1000);
	}
	await wzApiRequest.call(this, 'POST', `/conversations/${id}/toggle_status`, { body });
	return asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
}

const HTTP_URL = /^https?:\/\//i;

/** Lets the server fetch the URL (API key / OAuth): answers the signed blob id for `attachments`. */
async function uploadByUrl(this: IExecuteFunctions, url: string, i: number): Promise<string> {
	const upload = asObject(
		await wzApiRequest.call(this, 'POST', '/upload', { body: { external_url: url } }),
	);
	if (!upload.blob_id) {
		throw new NodeOperationError(this.getNode(), 'WebzzConnect did not return the uploaded file', {
			itemIndex: i,
		});
	}
	return String(upload.blob_id);
}

/** Rows of a Buttons / Rows fixedCollection as message items. An empty ID falls back to the title. */
function interactiveItems(
	collection: IDataObject | undefined,
	withListFields: boolean,
): IDataObject[] {
	const entries = (collection?.values as IDataObject[] | undefined) ?? [];
	return entries.map((entry) => {
		const title = String(entry.title ?? '');
		const value = String(entry.value ?? '');
		const item: IDataObject = { title, value: value || title };
		if (withListFields) {
			if (entry.description) item.description = String(entry.description);
			if (entry.section) item.section = String(entry.section);
		}
		return item;
	});
}

/**
 * `content_attributes` of an interactive (input_select) message, and the media header URL if any.
 * Meta's limits are checked by WebzzConnect, not here; only what needs no server is refused early.
 */
function interactiveAttributes(
	this: IExecuteFunctions,
	i: number,
	type: string,
): { attributes: IDataObject; mediaUrl?: string } {
	let items: IDataObject[];
	if (type === 'button') {
		items = interactiveItems(this.getNodeParameter('buttons', i, {}) as IDataObject, false);
	} else if (type === 'list') {
		items = interactiveItems(this.getNodeParameter('rows', i, {}) as IDataObject, true);
	} else {
		items = [
			{
				title: String(this.getNodeParameter('ctaText', i, '') ?? ''),
				value: String(this.getNodeParameter('ctaUrl', i, '') ?? '').trim(),
			},
		];
	}
	const interactive: IDataObject = { type };
	const options = this.getNodeParameter('interactiveOptions', i, {}) as IDataObject;
	const headerType = String(options.headerType ?? 'none');
	let mediaUrl: string | undefined;
	if (
		(headerType === 'none' || headerType === 'text') &&
		String(options.headerMediaUrl ?? '').trim()
	) {
		throw new NodeOperationError(
			this.getNode(),
			'Choose Header Type Image, Video or Document to use Header Media URL',
			{ itemIndex: i },
		);
	}
	if (headerType === 'text') {
		interactive.header = { type: 'text', text: String(options.headerText ?? '') };
	} else if (headerType !== 'none') {
		if (type === 'list') {
			throw new NodeOperationError(
				this.getNode(),
				'A list can only have a text header. Choose Header Type Text or None.',
				{ itemIndex: i },
			);
		}
		mediaUrl = String(options.headerMediaUrl ?? '').trim();
		if (!HTTP_URL.test(mediaUrl)) {
			throw new NodeOperationError(
				this.getNode(),
				`Enter a Header Media URL starting with http:// or https:// for the ${headerType} header`,
				{ itemIndex: i },
			);
		}
		interactive.header = { type: headerType };
	}
	const footer = String(options.footer ?? '');
	if (footer) interactive.footer = { text: footer };
	if (type === 'list') {
		const menu = String(this.getNodeParameter('listButton', i, '') ?? '');
		if (menu) interactive.button = menu;
	}
	return { attributes: { items, interactive }, mediaUrl };
}

/**
 * Text: a file is uploaded first (the server fetches the URL and answers a signed blob id), then
 * the message references it in `attachments`; the text becomes optional when a file is given.
 * Buttons, list and link button: an `input_select` message, a media header is its one attachment.
 */
async function sendConversationMessage(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	const type = this.getNodeParameter('messageType', i, 'text') as string;
	const content = String(this.getNodeParameter('content', i, '') ?? '');
	const body: IDataObject = { message_type: 'outgoing' };
	let fileUrl = '';
	if (type === 'text') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		fileUrl = String(this.getNodeParameter('fileUrl', i, '') ?? '').trim();
		if (!content && !fileUrl) {
			throw new NodeOperationError(this.getNode(), 'Enter a message, a File URL, or both', {
				itemIndex: i,
			});
		}
		if (fileUrl && !HTTP_URL.test(fileUrl)) {
			throw new NodeOperationError(this.getNode(), 'File URL must start with http:// or https://', {
				itemIndex: i,
			});
		}
		body.private = options.private === true;
	} else {
		if (!content) {
			throw new NodeOperationError(
				this.getNode(),
				'Enter the Message: it is the body of the buttons, list or link button',
				{ itemIndex: i },
			);
		}
		const { attributes, mediaUrl } = interactiveAttributes.call(this, i, type);
		body.content_type = 'input_select';
		body.content_attributes = attributes;
		fileUrl = mediaUrl ?? '';
	}
	if (content) body.content = content;
	if (fileUrl) body.attachments = [await uploadByUrl.call(this, fileUrl, i)];
	return asObject(await wzApiRequest.call(this, 'POST', `/conversations/${id}/messages`, { body }));
}

/** Merged into the existing attributes: the endpoint replaces the whole hash. */
async function setCustomAttributes(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	const updates = pairsToObject(this.getNodeParameter('customAttributes', i, {}) as IDataObject);
	if (Object.keys(updates).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one attribute with a key', {
			itemIndex: i,
		});
	}
	const conversation = asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
	const merged = { ...asObject(conversation.custom_attributes), ...updates };
	await wzApiRequest.call(this, 'POST', `/conversations/${id}/custom_attributes`, {
		body: { custom_attributes: merged },
	});
	return asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
}

/** Union with the current labels: the endpoint replaces the whole list. */
async function addLabels(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const id = pathId.call(this, this.getNodeParameter('conversationId', i));
	// Label titles are lowercase on the server.
	const wanted = String(this.getNodeParameter('labels', i, '') ?? '')
		.split(',')
		.map((label) => label.trim().toLowerCase())
		.filter((label) => label.length > 0);
	if (wanted.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Enter at least one label', { itemIndex: i });
	}
	const current = asArray(
		await wzApiRequest.call(this, 'GET', `/conversations/${id}/labels`),
	) as unknown as string[];
	const labels = [...new Set([...current.map(String), ...wanted])];
	const response = await wzApiRequest.call(this, 'POST', `/conversations/${id}/labels`, {
		body: { labels },
	});
	return { labels: asArray(response) as unknown as string[] };
}

function approvedTemplates(inbox: IDataObject | undefined): WhatsAppTemplate[] {
	const templates = (inbox?.message_templates as WhatsAppTemplate[] | undefined) ?? [];
	return templates.filter((template) => String(template.status ?? '').toUpperCase() === 'APPROVED');
}

interface TemplateField {
	id: string;
	displayName: string;
}

function placeholdersOf(text: string): string[] {
	return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}

function component(template: WhatsAppTemplate, type: string) {
	return template.components?.find((entry) => entry.type?.toUpperCase() === type);
}

/**
 * The fields a template needs, same set and ids as the Make app: header media URL or text,
 * every body placeholder (numbered or named), URL button variables and copy-code coupons.
 */
function templateFields(template: WhatsAppTemplate): TemplateField[] {
	const fields: TemplateField[] = [];
	const header = component(template, 'HEADER');
	const format = String(header?.format ?? '').toUpperCase();
	if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
		fields.push({ id: 'header_media_url', displayName: `Header ${format.toLowerCase()} URL` });
	} else if (format === 'TEXT' && (header?.text ?? '').includes('{')) {
		fields.push({ id: 'header_text', displayName: 'Header text variable' });
	}
	for (const placeholder of placeholdersOf(bodyText(template))) {
		fields.push({ id: `body_${placeholder}`, displayName: `Body variable ${placeholder}` });
	}
	(component(template, 'BUTTONS')?.buttons ?? []).forEach((button, index) => {
		const type = String(button.type ?? '').toUpperCase();
		if (type === 'URL' && (button.url ?? '').includes('{')) {
			fields.push({ id: `button_url_${index + 1}`, displayName: `Button ${index + 1} URL variable` });
		} else if (type === 'COPY_CODE') {
			fields.push({ id: `button_code_${index + 1}`, displayName: `Button ${index + 1} coupon code` });
		}
	});
	return fields;
}

/** Header, buttons and body values to the `processed_params` shape the send endpoint reads. */
function processedParams(
	template: WhatsAppTemplate,
	values: Record<string, string>,
	body: IDataObject,
): IDataObject {
	const out: IDataObject = {};
	if (Object.keys(body).length > 0) out.body = body;
	const format = String(component(template, 'HEADER')?.format ?? '').toUpperCase();
	if (values.header_media_url) {
		out.header = { media_url: values.header_media_url, media_type: format.toLowerCase() };
	} else if (values.header_text) {
		out.header = { '1': values.header_text };
	}
	const buttons = (component(template, 'BUTTONS')?.buttons ?? []).map((_, index) => {
		const url = values[`button_url_${index + 1}`];
		const code = values[`button_code_${index + 1}`];
		if (url) return { type: 'url', parameter: url };
		if (code) return { type: 'copy_code', parameter: code };
		return { type: 'none', parameter: '' };
	});
	if (buttons.some((button) => button.type !== 'none')) out.buttons = buttons;
	return out;
}

function bodyText(template: WhatsAppTemplate): string {
	const body = template.components?.find((component) => component.type?.toUpperCase() === 'BODY');
	return body?.text ?? '';
}

async function sendWhatsAppTemplate(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const inboxId = this.getNodeParameter('inboxId', i) as string;
	const contactId = this.getNodeParameter('contactId', i) as string;
	const key = this.getNodeParameter('template', i) as string;
	const [name, language] = key.split('::');
	if (!name || !language) {
		throw new NodeOperationError(
			this.getNode(),
			'Choose a template from the list, or use the format template_name::language',
			{ itemIndex: i },
		);
	}

	const inbox = (await fetchInboxes.call(this)).find((entry) => String(entry.id) === String(inboxId));
	if (!inbox) {
		throw new NodeOperationError(this.getNode(), `Inbox ${inboxId} was not found`, {
			itemIndex: i,
		});
	}
	const template = approvedTemplates(inbox).find(
		(entry) => entry.name === name && entry.language === language,
	);
	if (!template) {
		throw new NodeOperationError(
			this.getNode(),
			`No approved template "${name}" (${language}) in this inbox`,
			{ itemIndex: i },
		);
	}

	const text = bodyText(template);
	const placeholders = placeholdersOf(text);
	const mapper = this.getNodeParameter('templateFields', i, {}) as IDataObject;
	const values: Record<string, string> = {};
	for (const [id, value] of Object.entries((mapper.value as IDataObject | null) ?? {})) {
		if (value !== undefined && value !== null && String(value) !== '') values[id] = String(value);
	}

	// Expression-mapped templates have no fields to fill: positional values replace the body fields.
	const entries = (this.getNodeParameter('bodyVariables.values', i, []) as IDataObject[]).map(
		(entry) => String(entry.value ?? ''),
	);
	if (entries.length > 0) {
		if (entries.length !== placeholders.length) {
			throw new NodeOperationError(
				this.getNode(),
				`The template body has ${placeholders.length} variable(s) but ${entries.length} value(s) were given`,
				{ itemIndex: i },
			);
		}
		placeholders.forEach((placeholder, index) => {
			values[`body_${placeholder}`] = entries[index];
		});
	}

	const missing = templateFields(template).filter((field) => !values[field.id]);
	if (missing.length > 0) {
		throw new NodeOperationError(
			this.getNode(),
			`Missing value for: ${missing.map((field) => field.displayName).join(', ')}`,
			{ itemIndex: i },
		);
	}

	const processed: IDataObject = {};
	let content = text;
	for (const placeholder of placeholders) {
		const value = values[`body_${placeholder}`];
		processed[placeholder] = value;
		content = content.replace(new RegExp(`\\{\\{\\s*${placeholder}\\s*\\}\\}`, 'g'), () => value);
	}

	const templateParams: IDataObject = {
		name: template.name,
		category: template.category,
		language: template.language,
	};
	const params = processedParams(template, values, processed);
	if (Object.keys(params).length > 0) templateParams.processed_params = params;

	return asObject(
		await wzApiRequest.call(this, 'POST', '/conversations', {
			body: {
				inbox_id: inboxId,
				contact_id: contactId,
				message: {
					// WebzzConnect stores `content` as the visible message, so send the rendered text.
					content: content || template.name,
					template_params: templateParams,
				},
			},
		}),
	);
}

export class WebzzConnect implements INodeType {
	// Programmatic style: Create or Update chains several dependent calls (search, match, patch or
	// create, retry), the WhatsApp template send renders the message from inbox data, and every
	// output has internal wz_ keys removed, none of which fits declarative routing.
	description: INodeTypeDescription = {
		displayName: 'WebzzConnect',
		name: 'webzzConnect',
		icon: { light: 'file:webzzconnect.svg', dark: 'file:webzzconnect.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with contacts, deals, conversations and WhatsApp templates in WebzzConnect',
		defaults: { name: 'WebzzConnect' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
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
		properties: [
			authenticationProperty,
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Contact', value: 'contact' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Deal', value: 'deal' },
					{ name: 'WhatsApp Template', value: 'whatsAppTemplate' },
				],
				default: 'contact',
			},
			...contactOperations,
			...contactFields,
			...dealOperations,
			...dealFields,
			...conversationOperations,
			...conversationFields,
			...whatsAppTemplateOperations,
			...whatsAppTemplateFields,
		],
	};

	methods = {
		resourceMapping: {
			async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const inboxId = this.getCurrentNodeParameter('inboxId') as string | undefined;
				const key = String(this.getCurrentNodeParameter('template') ?? '');
				const [name, language] = key.split('::');
				if (!inboxId || !name || !language) return { fields: [] };
				const inbox = (await fetchInboxes.call(this)).find(
					(entry) => String(entry.id) === String(inboxId),
				);
				const template = approvedTemplates(inbox).find(
					(entry) => entry.name === name && entry.language === language,
				);
				if (!template) return { fields: [] };
				return {
					fields: templateFields(template).map((field) => ({
						id: field.id,
						displayName: field.displayName,
						required: true,
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						type: 'string',
					})),
				};
			},
		},

		loadOptions: {
			async getPipelines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const pipelines = asArray(await wzApiRequest.call(this, 'GET', '/crm/pipelines'));
				return [
					{ name: 'Default', value: '' },
					...pipelines.map((pipeline) => ({
						name: String(pipeline.name),
						value: String(pipeline.id),
					})),
				];
			},

			async getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const selected = (this.getCurrentNodeParameter('pipelineId') ||
					this.getCurrentNodeParameter('filters.pipelineId') ||
					'') as string;
				const pipelines = asArray(await wzApiRequest.call(this, 'GET', '/crm/pipelines'));
				const options: INodePropertyOptions[] = [{ name: 'Default', value: '' }];
				for (const pipeline of pipelines) {
					if (selected && String(pipeline.id) !== String(selected)) continue;
					const stages = (pipeline.stages as IDataObject[] | undefined) ?? [];
					for (const stage of stages) {
						const kind = stage.kind && stage.kind !== 'open' ? ` (${String(stage.kind)})` : '';
						const prefix = selected ? '' : `${String(pipeline.name)} / `;
						options.push({
							name: `${prefix}${String(stage.name)}${kind}`,
							value: String(stage.id),
						});
					}
				}
				return options;
			},

			async getLostReasons(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const reasons = asArray(await wzApiRequest.call(this, 'GET', '/crm/lost_reasons'));
				return [
					{ name: 'None', value: '' },
					...reasons.map((reason) => ({ name: String(reason.name), value: String(reason.id) })),
				];
			},

			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxes = await fetchInboxes.call(this);
				return inboxes.map((inbox) => ({ name: String(inbox.name), value: String(inbox.id) }));
			},

			async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxId = this.getCurrentNodeParameter('inboxId') as string | undefined;
				if (!inboxId) return [];
				const path = `/inboxes/${pathId.call(this, inboxId)}/assignable_agents`;
				const agents = asArray(await wzApiRequest.call(this, 'GET', path));
				return agents.map((agent) => ({
					name: String(agent.available_name ?? agent.name ?? agent.email),
					value: String(agent.id),
				}));
			},

			async getTeams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const teams = asArray(await wzApiRequest.call(this, 'GET', '/teams'));
				return teams.map((team) => ({ name: String(team.name), value: String(team.id) }));
			},

			async getWhatsAppInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxes = await fetchInboxes.call(this);
				return inboxes
					.filter((inbox) => inbox.channel_type === 'Channel::Whatsapp')
					.map((inbox) => ({ name: String(inbox.name), value: String(inbox.id) }));
			},

			async getWhatsAppTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const inboxId = this.getCurrentNodeParameter('inboxId') as string | undefined;
				if (!inboxId) return [];
				const inbox = (await fetchInboxes.call(this)).find(
					(entry) => String(entry.id) === String(inboxId),
				);
				return approvedTemplates(inbox).map((template) => ({
					name: `${String(template.name)} (${String(template.language)})`,
					value: `${String(template.name)}::${String(template.language)}`,
					description: bodyText(template).slice(0, 200),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let result: IDataObject | IDataObject[] = {};

				if (resource === 'contact') {
					if (operation === 'create') {
						const fields = {
							name: this.getNodeParameter('name', i, '') as string,
							email: this.getNodeParameter('email', i, '') as string,
							phoneNumber: this.getNodeParameter('phoneNumber', i, '') as string,
							...(this.getNodeParameter('additionalFields', i, {}) as IDataObject),
						};
						result = unwrapContact(
							await wzApiRequest.call(this, 'POST', '/contacts', { body: contactBody(fields) }),
						);
					} else if (operation === 'createOrUpdate') {
						result = await createOrUpdateContact.call(this, i);
					} else if (operation === 'update') {
						const id = pathId.call(this, this.getNodeParameter('contactId', i));
						const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						result = unwrapContact(
							await wzApiRequest.call(this, 'PATCH', `/contacts/${id}`, {
								body: contactBody(fields),
							}),
						);
					} else if (operation === 'get') {
						const id = pathId.call(this, this.getNodeParameter('contactId', i));
						result = unwrapContact(await wzApiRequest.call(this, 'GET', `/contacts/${id}`));
					} else if (operation === 'search') {
						const query = this.getNodeParameter('query', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						result = await wzPaginate.call(this, '/contacts/search', {
							qs: { q: query },
							returnAll,
							limit,
							pageSize: 100,
							extract: asArray,
							hasMore: (response) => asObject(asObject(response).meta).has_more === true,
						});
					}
				} else if (resource === 'deal') {
					if (operation === 'create') {
						const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
						const body = dealBody({ ...fields, title: this.getNodeParameter('title', i) });
						body.contact_id = this.getNodeParameter('contactId', i) as string;
						const pipelineId = this.getNodeParameter('pipelineId', i, '') as string;
						const stageId = this.getNodeParameter('stageId', i, '') as string;
						if (pipelineId) body.pipeline_id = pipelineId;
						if (stageId) body.stage_id = stageId;
						result = asObject(await wzApiRequest.call(this, 'POST', '/crm/deals', { body }));
					} else if (operation === 'update') {
						const id = pathId.call(this, this.getNodeParameter('dealId', i));
						const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
						result = asObject(
							await wzApiRequest.call(this, 'PATCH', `/crm/deals/${id}`, {
								body: dealBody(fields),
							}),
						);
					} else if (operation === 'moveStage') {
						const id = pathId.call(this, this.getNodeParameter('dealId', i));
						const stageId = this.getNodeParameter('stageId', i) as string;
						if (!stageId) {
							throw new NodeOperationError(this.getNode(), 'Choose the stage to move the deal to', {
								itemIndex: i,
							});
						}
						const options = this.getNodeParameter('moveOptions', i, {}) as IDataObject;
						const body = compact({
							stage_id: stageId,
							lost_reason_id: options.lostReasonId,
							lost_note: options.lostNote,
						});
						result = asObject(
							await wzApiRequest.call(this, 'POST', `/crm/deals/${id}/move`, { body }),
						);
					} else if (operation === 'get') {
						const id = pathId.call(this, this.getNodeParameter('dealId', i));
						result = asObject(await wzApiRequest.call(this, 'GET', `/crm/deals/${id}`));
					} else if (operation === 'search') {
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						result = await wzPaginate.call(this, '/crm/deals', {
							qs: compact({
								q: filters.q,
								contact_id: filters.contactId,
								pipeline_id: filters.pipelineId,
								stage_id: filters.stageId,
								owner_id: filters.ownerId,
								status: filters.status,
							}),
							returnAll,
							limit,
							pageSize: 25,
							extract: asArray,
						});
					}
				} else if (resource === 'conversation') {
					if (operation === 'create') {
						const content = this.getNodeParameter('content', i, '') as string;
						const body: IDataObject = {
							inbox_id: this.getNodeParameter('inboxId', i) as string,
							contact_id: this.getNodeParameter('contactId', i) as string,
						};
						if (content) body.message = { content };
						result = asObject(await wzApiRequest.call(this, 'POST', '/conversations', { body }));
					} else if (operation === 'sendMessage') {
						result = await sendConversationMessage.call(this, i);
					} else if (operation === 'get') {
						const id = pathId.call(this, this.getNodeParameter('conversationId', i));
						result = asObject(await wzApiRequest.call(this, 'GET', `/conversations/${id}`));
					} else if (operation === 'assign') {
						result = await assignConversation.call(this, i);
					} else if (operation === 'unassign') {
						result = await unassignConversation.call(this, i);
					} else if (operation === 'updateStatus') {
						result = await updateConversationStatus.call(this, i);
					} else if (operation === 'setCustomAttributes') {
						result = await setCustomAttributes.call(this, i);
					} else if (operation === 'addLabels') {
						result = await addLabels.call(this, i);
					} else if (operation === 'getAll') {
						const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						result = await wzPaginate.call(this, '/conversations', {
							qs: compact({
								status: (filters.status as string) || 'open',
								inbox_id: filters.inboxId,
							}),
							returnAll,
							limit,
							pageSize: 25,
							extract: (response) => asArray(asObject(response).data ?? response),
						});
					}
				} else if (resource === 'whatsAppTemplate' && operation === 'send') {
					result = await sendWhatsAppTemplate.call(this, i);
				}

				const cleaned = stripInternalKeys(result);
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(cleaned),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw errorForItem(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
