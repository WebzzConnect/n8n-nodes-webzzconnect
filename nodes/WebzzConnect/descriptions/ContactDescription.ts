import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({ resource: ['contact'], operation: operations });

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a contact',
				action: 'Create a contact',
			},
			{
				name: 'Create or Update',
				value: 'createOrUpdate',
				description: 'Find a contact by email or phone and update it, or create it',
				action: 'Create or update a contact',
			},
			{ name: 'Get', value: 'get', description: 'Get a contact by ID', action: 'Get a contact' },
			{
				name: 'Search',
				value: 'search',
				description: 'Search contacts by name, email or phone',
				action: 'Search contacts',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a contact',
				action: 'Update a contact',
			},
		],
		default: 'create',
	},
];

const extraFields: INodeProperties[] = [
	{
		displayName: 'City',
		name: 'city',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Company Name',
		name: 'companyName',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: '',
		description: 'Country name or ISO code',
	},
	{
		displayName: 'Custom Attributes',
		name: 'customAttributes',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Attribute',
		default: {},
		description: 'Custom attributes defined in your WebzzConnect account',
		options: [
			{
				displayName: 'Attribute',
				name: 'values',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						description: 'The attribute key as defined in WebzzConnect',
					},
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Identifier',
		name: 'identifier',
		type: 'string',
		default: '',
		description: 'Your own unique ID for the contact',
	},
];

export const contactFields: INodeProperties[] = [
	// create + createOrUpdate
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: { show: show(['create', 'createOrUpdate']) },
		description: 'At least an email or a phone number is required for Create or Update',
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		default: '',
		placeholder: '+972501234567',
		displayOptions: { show: show(['create', 'createOrUpdate']) },
		description:
			'International format is best. A national format such as 050-1234567 is normalized by WebzzConnect.',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: { show: show(['create', 'createOrUpdate']) },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['create', 'createOrUpdate']) },
		options: extraFields,
	},

	// get + update
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['get', 'update']) },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['update']) },
		options: [
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{ displayName: 'Phone Number', name: 'phoneNumber', type: 'string', default: '' },
			...extraFields,
		],
	},

	// search
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['search']) },
		description: 'Matches on name, email or phone number. Limited to 100 searches per minute.',
	},
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
];
