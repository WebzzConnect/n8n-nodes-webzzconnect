import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({ resource: ['whatsAppTemplate'], operation: operations });

export const whatsAppTemplateOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['whatsAppTemplate'] } },
		options: [
			{
				name: 'Send',
				value: 'send',
				description: 'Send an approved WhatsApp template to a contact',
				action: 'Send an approved template',
			},
		],
		default: 'send',
	},
];

export const whatsAppTemplateFields: INodeProperties[] = [
	{
		displayName: 'WhatsApp Inbox Name or ID',
		name: 'inboxId',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getWhatsAppInboxes' },
		default: '',
		displayOptions: { show: show(['send']) },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: show(['send']) },
		description: 'The contact must have a phone number',
	},
	{
		displayName: 'Template Name or ID',
		name: 'template',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getWhatsAppTemplates', loadOptionsDependsOn: ['inboxId'] },
		default: '',
		displayOptions: { show: show(['send']) },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Approved templates of the chosen inbox. An expression value looks like template_name::en',
	},
	{
		displayName: 'Template Fields',
		name: 'templateFields',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		displayOptions: { show: show(['send']) },
		typeOptions: {
			loadOptionsDependsOn: ['inboxId', 'template'],
			resourceMapper: {
				resourceMapperMethod: 'getTemplateFields',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: false,
			},
		},
		description:
			'One field per variable of the chosen template: header text or media URL, body variables (numbered or named), URL button variables and the copy-code coupon',
	},
	{
		displayName: 'Body Variables (Expression-Mapped Template)',
		name: 'bodyVariables',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Variable',
		default: {},
		displayOptions: { show: show(['send']) },
		description:
			'Only needed when the template is set by an expression and Template Fields cannot load. Values for the {{1}}, {{2}}, ... body placeholders, in order, one entry per placeholder. When filled, these replace the body fields of Template Fields.',
		options: [
			{
				displayName: 'Variable',
				name: 'values',
				values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
			},
		],
	},
];
