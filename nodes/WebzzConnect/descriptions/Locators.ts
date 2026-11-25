import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

/** Version 1.2 and later. */
export const FROM_V12 = { '@version': [{ _cnd: { gte: 1.2 } }] } as Show;
/** Versions saved before 1.2. */
export const BEFORE_V12 = { '@version': [1, 1.1] } as Show;

interface IdFieldOptions {
	displayName: string;
	name: string;
	searchListMethod: string;
	show: Show;
	required?: boolean;
	description?: string;
	listHint?: string;
}

/**
 * A record ID field. Workflows saved before 1.2 keep the plain text field (same name, so their
 * value stays); 1.2 picks the record from a searchable list or takes its numeric ID.
 */
export function idField(options: IdFieldOptions): INodeProperties[] {
	const { displayName, name, searchListMethod, show, required = true, description } = options;
	return [
		{
			displayName,
			name,
			type: 'string',
			required,
			default: '',
			displayOptions: { show: { ...show, ...BEFORE_V12 } },
			...(description ? { description } : {}),
		},
		{
			displayName,
			name,
			type: 'resourceLocator',
			required,
			default: { mode: 'list', value: '' },
			displayOptions: { show: { ...show, ...FROM_V12 } },
			...(options.listHint || description
				? { description: options.listHint ?? description }
				: {}),
			modes: [
				{
					displayName: 'From List',
					name: 'list',
					type: 'list',
					typeOptions: { searchListMethod, searchable: true },
				},
				{
					displayName: 'By ID',
					name: 'id',
					type: 'string',
					placeholder: 'e.g. 123',
					validation: [
						{
							type: 'regex',
							properties: { regex: '^\\d+$', errorMessage: 'Enter a numeric ID' },
						},
					],
				},
			],
		},
	];
}

/** Simplify toggle of the read operations, from 1.2. Older versions always return the raw data. */
export function simplifyField(show: Show): INodeProperties {
	return {
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { ...show, ...FROM_V12 } },
		description: 'Whether to return a simplified version of the response instead of the raw data',
	};
}
