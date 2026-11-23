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
				name: 'Add Note',
				value: 'addNote',
				description: 'Add a note to a deal (also shown on the contact notes)',
				action: 'Add a note to a deal',
			},
			{
				name: 'Add Product',
				value: 'addProduct',
				description: 'Add a product line to a deal; the deal value becomes the sum of its lines',
				action: 'Add a product line to a deal',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a deal',
				action: 'Create a deal',
			},
			{
				name: 'Delete Note',
				value: 'deleteNote',
				description: 'Delete a note of a deal',
				action: 'Delete a note of a deal',
			},
			{
				name: 'Delete Product',
				value: 'deleteProduct',
				description: 'Remove a product line from a deal',
				action: 'Remove a product line from a deal',
			},
			{ name: 'Get', value: 'get', description: 'Get a deal by ID', action: 'Get a deal' },
			{
				name: 'Get Notes',
				value: 'getNotes',
				description: 'List the notes of a deal, newest first',
				action: 'Get the notes of a deal',
			},
			{
				name: 'Get Products',
				value: 'getProducts',
				description: 'List the product lines of a deal',
				action: 'Get the product lines of a deal',
			},
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
			{
				name: 'Update Note',
				value: 'updateNote',
				description: 'Change the text of a note of a deal',
				action: 'Update a note of a deal',
			},
			{
				name: 'Update Product',
				value: 'updateProduct',
				description: 'Change a product line of a deal; the deal value is recalculated',
				action: 'Update a product line of a deal',
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
			'Leave empty for the default pipeline. Lists only the pipelines this connection can see: an account API key sees all; a person or virtual agent sees the pipelines they are a member of (an administrator adds members in CRM settings). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
				description:
					"ID of the person who owns the deal. Must be a member of the deal's pipeline.",
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				default: 0,
				description:
					'Ignored once the deal has product lines: the value is then the sum of its lines',
			},
		],
	},

	// get, update, moveStage, notes
	{
		displayName: 'Deal ID',
		name: 'dealId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: show([
				'get',
				'update',
				'moveStage',
				'addNote',
				'getNotes',
				'updateNote',
				'deleteNote',
				'addProduct',
				'getProducts',
				'updateProduct',
				'deleteProduct',
			]),
		},
	},
	{
		displayName: 'Note ID',
		name: 'noteId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['updateNote', 'deleteNote']) },
		description:
			'Only the connection or person that wrote the note, or an administrator, can change it. A note written through an API key belongs to that key.',
	},
	{
		displayName: 'Note',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: show(['addNote', 'updateNote']) },
		description: 'The note text, up to 10,000 characters',
	},

	// product lines
	{
		displayName: 'Product Line ID',
		name: 'lineId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['updateProduct', 'deleteProduct']) },
		description: 'The ID of the line on the deal (from Get Products), not the catalog product ID',
	},
	{
		displayName: 'Product Name or ID',
		name: 'productId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getProducts' },
		default: '',
		displayOptions: { show: show(['addProduct']) },
		description:
			'A product from your catalog; its name and price are used unless you set them below. Leave as None for a custom line with a name and unit price. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Line Fields',
		name: 'lineFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['addProduct']) },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Required for a custom line',
			},
			{
				displayName: 'Quantity',
				name: 'quantity',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 1,
				description: 'More than 0. Default 1.',
			},
			{
				displayName: 'Unit Price',
				name: 'unitPrice',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 0,
				description: 'Required for a custom line. The line takes the deal currency.',
			},
		],
	},
	{
		displayName: 'Update Fields',
		name: 'lineUpdateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['updateProduct']) },
		options: [
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{
				displayName: 'Product Name or ID',
				name: 'productId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getProducts' },
				default: '',
				description:
					'Link the line to another catalog product. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Quantity',
				name: 'quantity',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 1,
				description: 'More than 0',
			},
			{
				displayName: 'Unit Price',
				name: 'unitPrice',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 0,
			},
		],
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
			{
				displayName: 'Owner ID',
				name: 'ownerId',
				type: 'string',
				default: '',
				description:
					"ID of the person who owns the deal. Must be a member of the deal's pipeline.",
			},
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				default: 0,
				description:
					'Ignored once the deal has product lines: the value is then the sum of its lines',
			},
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
