import type { INodeProperties } from 'n8n-workflow';

export const connectionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['connection'] } },
		options: [
			{
				name: 'Get Info',
				value: 'getInfo',
				description:
					'Who this credential acts as: the account, and the virtual agent or person, with the agent\'s status. Works while the agent is paused.',
				action: 'Get info about this connection',
			},
		],
		default: 'getInfo',
	},
];
