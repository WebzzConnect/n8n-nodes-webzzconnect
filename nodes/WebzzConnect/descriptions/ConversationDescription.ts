import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({ resource: ['conversation'], operation: operations });
const showType = (types: string[]) => ({ ...show(['sendMessage']), messageType: types });
const INTERACTIVE = ['button', 'list', 'cta_url'];

export const STATUS_ON_SEND =
	'Leave empty for the default. Resolved suits reminders and one-off notices: the conversation doesn\'t wait in your team\'s queue, and the customer\'s reply opens it again.';

const NOTE_HELP =
	'Optional, up to 500 characters. Shown in the conversation to whoever takes over; never sent to the customer. Only a virtual agent connection that handles the conversation can add one, and only when the assignee changes.';

export const conversationOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversation'] } },
		options: [
			{
				name: 'Add Labels',
				value: 'addLabels',
				description: 'Add labels to a conversation, keeping the labels it already has',
				action: 'Add labels to a conversation',
			},
			{
				name: 'Assign',
				value: 'assign',
				description: 'Assign a conversation to an agent and/or a team',
				action: 'Assign a conversation',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Start a conversation with a contact, optionally with a first message',
				action: 'Create a conversation',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a conversation by its ID',
				action: 'Get a conversation',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List conversations',
				action: 'Get many conversations',
			},
			{
				name: 'Send Message',
				value: 'sendMessage',
				description:
					'Reply in a conversation. A virtual agent connection can send only into conversations the agent handles.',
				action: 'Send a message in a conversation',
			},
			{
				name: 'Set Custom Attributes',
				value: 'setCustomAttributes',
				description: 'Set custom attributes on a conversation, keeping the other attributes',
				action: 'Set custom attributes on a conversation',
			},
			{
				name: 'Unassign',
				value: 'unassign',
				description: 'Remove the agent and/or the team from a conversation',
				action: 'Unassign a conversation',
			},
			{
				name: 'Update Status',
				value: 'updateStatus',
				description: 'Open, resolve or snooze a conversation',
				action: 'Update the status of a conversation',
			},
		],
		default: 'sendMessage',
	},
];

export const conversationFields: INodeProperties[] = [
	// create
	{
		displayName: 'Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getInboxes' },
		default: '',
		displayOptions: { show: show(['create']) },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'First Message',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: { show: show(['create']) },
		description:
			'Optional. On WhatsApp, a free-text message only reaches the contact inside the 24-hour window. Use the WhatsApp Template resource to start a conversation. With a virtual agent connection, a new conversation is handled by that agent, so the customer\'s reply comes to your flow. A virtual agent can send only into conversations it handles: for reminders and broadcasts, use an account key or an "as me" connection.',
	},
	{
		displayName: 'Status',
		name: 'initialStatus',
		type: 'options',
		options: [
			{ name: 'Default', value: '' },
			{ name: 'Open', value: 'open' },
			{ name: 'Resolved', value: 'resolved' },
		],
		default: '',
		displayOptions: { show: show(['create']) },
		description: STATUS_ON_SEND,
	},

	// get, sendMessage
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: show([
				'get',
				'sendMessage',
				'assign',
				'unassign',
				'updateStatus',
				'setCustomAttributes',
				'addLabels',
			]),
		},
		description: 'The conversation number shown in WebzzConnect',
	},
	{
		displayName: 'Message Type',
		name: 'messageType',
		type: 'options',
		options: [
			{
				name: 'Link Button',
				value: 'cta_url',
				description: 'WhatsApp: one button that opens a URL',
			},
			{
				name: 'List',
				value: 'list',
				description: 'WhatsApp: a menu of up to 10 rows to choose from',
			},
			{
				name: 'Reply Buttons',
				value: 'button',
				description: 'WhatsApp: up to 3 buttons the contact can tap',
			},
			{ name: 'Text', value: 'text', description: 'A text message, optionally with a file' },
		],
		default: 'text',
		displayOptions: { show: show(['sendMessage']) },
		description:
			'Interactive types (buttons, list, link) work on WhatsApp Cloud inboxes, inside the 24-hour window. A tap arrives as an incoming message with the chosen ID in button_payload. If the 24-hour window is closed, the node succeeds (the message is queued) and the message then fails in WebzzConnect with the window reason.',
	},
	{
		displayName: 'Message',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: { show: show(['sendMessage']) },
		description:
			'The message text, or the caption when a file is attached. Required unless a File URL is given. For buttons, a list or a link button this is the message body and is required.',
	},
	{
		displayName: 'File URL',
		name: 'fileUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/invoice.pdf',
		displayOptions: { show: showType(['text']) },
		description:
			'Optional. A public link to a file (image, PDF, audio, video). WebzzConnect downloads it and attaches it to the message. The file name is taken from the URL. Private or internal addresses are refused.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showType(['text']) },
		options: [
			{
				displayName: 'Private Note',
				name: 'private',
				type: 'boolean',
				default: false,
				description: 'Whether to add the message as an internal note that the contact does not see',
			},
		],
	},

	{
		displayName: 'Buttons',
		name: 'buttons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Button' },
		placeholder: 'Add Button',
		default: {},
		displayOptions: { show: showType(['button']) },
		description: 'One to three buttons',
		options: [
			{
				displayName: 'Button',
				name: 'values',
				values: [
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						description: 'The button text, up to 20 characters',
					},
					{
						displayName: 'ID',
						name: 'value',
						type: 'string',
						default: '',
						description:
							'What arrives in button_payload when the contact taps it. Leave empty to use the title.',
					},
				],
			},
		],
	},
	{
		displayName: 'Menu Label',
		name: 'listButton',
		type: 'string',
		default: '',
		displayOptions: { show: showType(['list']) },
		description:
			'Optional. The text of the button that opens the list, up to 20 characters. Leave empty for the default label.',
	},
	{
		displayName: 'Rows',
		name: 'rows',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Row' },
		placeholder: 'Add Row',
		default: {},
		displayOptions: { show: showType(['list']) },
		description: 'One to ten rows',
		options: [
			{
				displayName: 'Row',
				name: 'values',
				values: [
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						description: 'The row text, up to 24 characters',
					},
					{
						displayName: 'ID',
						name: 'value',
						type: 'string',
						default: '',
						description:
							'What arrives in button_payload when the contact picks it. Leave empty to use the title.',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Optional. A second line, up to 72 characters.',
					},
					{
						displayName: 'Section',
						name: 'section',
						type: 'string',
						default: '',
						description:
							'Optional. Rows with the same section are grouped under it. With several sections, every row needs one.',
					},
				],
			},
		],
	},
	{
		displayName: 'Button Text',
		name: 'ctaText',
		type: 'string',
		default: '',
		displayOptions: { show: showType(['cta_url']) },
		description: 'The text of the link button, up to 20 characters',
	},
	{
		displayName: 'URL',
		name: 'ctaUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/pay',
		displayOptions: { show: showType(['cta_url']) },
		description: 'The address the button opens (http or https)',
	},
	{
		displayName: 'Interactive Options',
		name: 'interactiveOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: showType(INTERACTIVE) },
		options: [
			{
				displayName: 'Footer',
				name: 'footer',
				type: 'string',
				default: '',
				description: 'Small grey text under the message, up to 60 characters',
			},
			{
				displayName: 'Header Media URL',
				name: 'headerMediaUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/intro.mp4',
				description:
					'A public link to the header image, video or document (Header Type Image, Video or Document). Not for lists.',
			},
			{
				displayName: 'Header Text',
				name: 'headerText',
				type: 'string',
				default: '',
				description: 'The header text when Header Type is Text, up to 60 characters',
			},
			{
				displayName: 'Header Type',
				name: 'headerType',
				type: 'options',
				options: [
					{ name: 'Document', value: 'document' },
					{ name: 'Image', value: 'image' },
					{ name: 'None', value: 'none' },
					{ name: 'Text', value: 'text' },
					{ name: 'Video', value: 'video' },
				],
				default: 'none',
				description: 'A list can only have a text header',
			},
		],
	},

	// setCustomAttributes
	{
		displayName:
			'Needs an API key (or OAuth consent) with the conversations view and resolve permissions',
		name: 'setCustomAttributesNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: show(['setCustomAttributes']) },
	},
	{
		displayName: 'Custom Attributes',
		name: 'customAttributes',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Attribute',
		default: {},
		displayOptions: { show: show(['setCustomAttributes']) },
		description:
			'Attributes to set. Other attributes the conversation already has are kept. Use the attribute key, for example beta_step.',
		options: [
			{
				displayName: 'Attribute',
				name: 'values',
				values: [
					{ displayName: 'Key', name: 'key', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},

	// addLabels
	{
		displayName:
			'Needs an API key (or OAuth consent) with the conversations view and reply permissions',
		name: 'addLabelsNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: show(['addLabels']) },
	},
	{
		displayName: 'Labels',
		name: 'labels',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'vip, hot-lead',
		displayOptions: { show: show(['addLabels']) },
		description:
			'Comma-separated labels to add (sent in lowercase). Labels the conversation already has are kept.',
	},

	// assign
	{
		displayName: 'Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getInboxes' },
		default: '',
		displayOptions: { show: show(['assign']) },
		description:
			'The inbox of the conversation. It only filters the Agent list below. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Agent Name or ID',
		name: 'agentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAgents', loadOptionsDependsOn: ['inboxId'] },
		default: '',
		displayOptions: { show: show(['assign']) },
		description:
			'A person or virtual agent in the conversation\'s inbox. An unknown or unavailable one is refused and nothing changes. In an expression, a virtual agent is AgentBot:ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Team Name or ID',
		name: 'teamId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeams' },
		default: '',
		displayOptions: { show: show(['assign']) },
		description:
			'Pick a team, an agent, or both. With both, the team is set first, then the agent. A virtual agent connection hands off to one target: pick a team or an agent, not both. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Hand-Off Note',
		name: 'handoffNote',
		type: 'string',
		default: '',
		displayOptions: { show: show(['assign', 'unassign']) },
		description: NOTE_HELP,
	},

	// unassign
	{
		displayName: 'Remove',
		name: 'unassignFrom',
		type: 'options',
		options: [
			{ name: 'Agent', value: 'agent' },
			{ name: 'Agent and Team', value: 'both' },
			{ name: 'Team', value: 'team' },
		],
		default: 'agent',
		displayOptions: { show: show(['unassign']) },
		description:
			'Removes the agent: the conversation goes to your team, to the queue (Open, unassigned) or to a member if the inbox auto-assigns. With a virtual agent connection this is a hand-off; add a hand-off note to say why.',
	},

	// updateStatus
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Open', value: 'open' },
			{ name: 'Resolved', value: 'resolved' },
			{ name: 'Snoozed', value: 'snoozed' },
			{
				name: 'Waiting on Customer',
				value: 'pending',
				description: 'Stays assigned. The customer\'s reply reopens it to the same person.',
			},
		],
		default: 'resolved',
		displayOptions: { show: show(['updateStatus']) },
		description:
			'Resolved ends the conversation and sends the CSAT survey when the inbox has CSAT on. Waiting on customer keeps a person\'s conversation assigned until the customer replies. With a virtual agent connection: Open hands the conversation to your team (the queue, or a member if the inbox auto-assigns), Resolved also releases the bot so the customer\'s next message starts fresh, and a conversation the agent doesn\'t handle is refused. Open through an "as me" connection of an agent-role user also assigns the conversation to that user.',
	},
	{
		displayName: 'Snooze Until',
		name: 'snoozeUntil',
		type: 'dateTime',
		default: '',
		displayOptions: { show: { ...show(['updateStatus']), status: ['snoozed'] } },
		description: 'Optional. Leave empty to snooze until the customer replies.',
	},

	// getAll
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: show(['getAll']) },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...show(['getAll']), returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getAll']) },
		options: [
			{
				displayName: 'Inbox Name or ID',
				name: 'inboxId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getInboxes' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Open', value: 'open' },
					{ name: 'Pending (Both)', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Snoozed', value: 'snoozed' },
					{ name: 'Waiting on Customer', value: 'waiting_on_customer' },
					{ name: 'With a Virtual Agent', value: 'with_virtual_agent' },
				],
				default: 'open',
				description:
					'With a virtual agent connection you find only the conversations the agent handles. Choose With a Virtual Agent or All; Open finds none.',
			},
			{
				displayName: 'Virtual Agent ID',
				name: 'agentId',
				type: 'string',
				default: '',
				description: 'Only conversations this virtual agent handles',
			},
		],
	},
];
