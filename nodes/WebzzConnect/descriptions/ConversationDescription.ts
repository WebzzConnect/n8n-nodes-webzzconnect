import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({ resource: ['conversation'], operation: operations });
const showType = (types: string[]) => ({ ...show(['sendMessage']), messageType: types });
const INTERACTIVE = ['button', 'list', 'cta_url'];

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
					"Reply in a conversation. For a chatbot flow, use an API key: its messages arrive with sender null, so they never match the trigger's human-reply rule.",
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
			'Optional. On WhatsApp, a free-text message only reaches the contact inside the 24-hour window. Use the WhatsApp Template resource to start a conversation.',
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
		placeholder: 'human, vip',
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
			'Optional if a team is chosen. The agent must be a member of the conversation\'s inbox; an unknown agent makes the node fail. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Team Name or ID',
		name: 'teamId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTeams' },
		default: '',
		displayOptions: { show: show(['assign']) },
		description:
			'Optional if an agent is chosen. The team is assigned first, then the agent. A team with auto-assign may briefly assign one of its members before the chosen agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
		description: 'What to remove from the conversation',
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
		],
		default: 'resolved',
		displayOptions: { show: show(['updateStatus']) },
		description:
			'Resolved sends the CSAT survey to the customer when the inbox has CSAT turned on. Open through an OAuth connection made by an agent-role user also assigns the conversation to that user and replaces the current assignee. API keys do not do this, but inbox auto-assignment may assign an unassigned reopened conversation.',
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
					{ name: 'Pending', value: 'pending' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Snoozed', value: 'snoozed' },
				],
				default: 'open',
			},
		],
	},
];
