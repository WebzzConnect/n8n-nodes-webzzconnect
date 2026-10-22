import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({ resource: ['deal'], operation: operations });

export const dealOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['deal'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a deal',
				action: 'Create a deal',
			},
			{ name: 'Get', value: 'get', description: 'Get a deal by ID', action: 'Get a deal' },
			{
				name: 'Move Stage',
				value: 'moveStage',
				description: 'Move a deal to another stage (including won and lost)',
				action: 'Move a deal to another stage',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Search and filter deals',
				action: 'Search deals',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a deal',
				action: 'Update a deal',
			},
		],
		default: 'create',
	},
];

export const dealFields: INodeProperties[] = [
	// create
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['create']) },
		description: 'The contact this deal belongs to',
	},
	{
		displayName: 'Pipeline Name or ID',
		name: 'pipelineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPipelines' },
		default: '',
		displayOptions: { show: show(['create']) },
		description:
			'Leave empty for the default pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Stage Name or ID',
		name: 'stageId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipelineId'] },
		default: '',
		displayOptions: { show: show(['create']) },
		description:
			'Leave empty for the first stage of the pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['create']) },
		options: [
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: '',
				placeholder: 'ILS',
			},
			{
				displayName: 'Custom Attributes',
				name: 'customAttributes',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Attribute',
				default: {},
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
			{
				displayName: 'Expected Close Date',
				name: 'expectedCloseAt',
				type: 'dateTime',
				default: '',
			},
			{
				displayName: 'Owner ID',
				name: 'ownerId',
				type: 'string',
				default: '',
				description: 'ID of the agent who owns the deal',
			},
			{ displayName: 'Value', name: 'value', type: 'number', default: 0 },
		],
	},

	// get, update, moveStage
	{
		displayName: 'Deal ID',
		name: 'dealId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['get', 'update', 'moveStage']) },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['update']) },
		options: [
			{ displayName: 'Currency', name: 'currency', type: 'string', default: '' },
			{
				displayName: 'Custom Attributes',
				name: 'customAttributes',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Attribute',
				default: {},
				description: 'Attributes are merged into the existing ones',
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
			{
				displayName: 'Expected Close Date',
				name: 'expectedCloseAt',
				type: 'dateTime',
				default: '',
			},
			{ displayName: 'Owner ID', name: 'ownerId', type: 'string', default: '' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
			{ displayName: 'Value', name: 'value', type: 'number', default: 0 },
		],
	},

	// moveStage
	{
		displayName: 'Pipeline Name or ID',
		name: 'pipelineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPipelines' },
		default: '',
		displayOptions: { show: show(['moveStage']) },
		description:
			'Only used to narrow the stage list below. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Stage Name or ID',
		name: 'stageId',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipelineId'] },
		default: '',
		displayOptions: { show: show(['moveStage']) },
		description:
			'The stage to move the deal to. It must belong to the deal\'s pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Move Options',
		name: 'moveOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['moveStage']) },
		options: [
			{
				displayName: 'Lost Note',
				name: 'lostNote',
				type: 'string',
				default: '',
				description: 'Free-text note, used when moving to a lost stage',
			},
			{
				displayName: 'Lost Reason Name or ID',
				name: 'lostReasonId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLostReasons' },
				default: '',
				description:
					'Used when moving to a lost stage. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},

	// search
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: show(['search']) },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...show(['search']), returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['search']) },
		options: [
			{ displayName: 'Contact ID', name: 'contactId', type: 'string', default: '' },
			{ displayName: 'Owner ID', name: 'ownerId', type: 'string', default: '' },
			{
				displayName: 'Pipeline Name or ID',
				name: 'pipelineId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPipelines' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Query',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Matches the deal title or the contact name',
			},
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['filters.pipelineId'] },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Lost', value: 'lost' },
					{ name: 'Open', value: 'open' },
					{ name: 'Won', value: 'won' },
				],
				default: 'open',
			},
		],
	},
];
