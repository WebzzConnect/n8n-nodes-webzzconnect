import type { INodeProperties } from 'n8n-workflow';

type LabelOperation = 'addLabels' | 'removeLabels' | 'setLabels';

// Literal strings per operation: the n8n lint rules check description text statically.
const TEXT_HELP: Record<LabelOperation, string> = {
	addLabels: 'Comma-separated labels to add (sent in lowercase). Labels it already has are kept.',
	removeLabels:
		"Comma-separated labels to remove (case doesn't matter). Labels it doesn't have are ignored.",
	setLabels:
		'Comma-separated labels it should have (sent in lowercase). Its other labels are removed.',
};

/**
 * The Labels field of a label operation. Version 1 nodes keep the comma-separated text field
 * they were saved with; version 1.1 picks from the account's labels (an expression may give a
 * list or comma-separated text). Both send lowercase titles.
 */
export function labelFields(
	resource: string,
	operation: LabelOperation,
	extraShow: Record<string, Array<string | boolean>> = {},
): INodeProperties[] {
	const show = { resource: [resource], operation: [operation], ...extraShow };
	return [
		{
			displayName: 'Labels',
			name: 'labels',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'e.g. vip, hot-lead',
			displayOptions: { show: { ...show, '@version': [1] } },
			description: TEXT_HELP[operation],
		},
		{
			displayName: 'Label Names or IDs',
			name: 'labels',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getLabels' },
			required: true,
			default: [],
			displayOptions: { show, hide: { '@version': [1] } },
			// An expression may also give comma-separated text.
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	];
}
