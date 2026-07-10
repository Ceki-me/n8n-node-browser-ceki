import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ContractClient } from '../../lib/contract-client';

const STATUS_OPTIONS = [
	{ name: '100 · Backlog', value: 100 },
	{ name: '200 · Hand (assigned)', value: 200 },
	{ name: '222 · Hand done', value: 222 },
	{ name: '300 · QA', value: 300 },
	{ name: '350 · QA done', value: 350 },
	{ name: '499 · Reviewer', value: 499 },
];

/**
 * Ceki Contract — operation node for the Ceki contract system (tasks/events).
 * Uses native fetch() — zero external runtime deps.
 */
export class CekiContract implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ceki Contract',
		name: 'cekiContract',
		icon: 'file:ceki.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{ "Contract: " + $operation }}',
		description: 'Work with Ceki contract tasks: list, create, assign, update status, comment, report progress, escalate to a human, and poll',
		defaults: { name: 'Ceki Contract' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'cekiApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				default: 'myEvents',
				options: [
					{ name: 'List My Contracts', value: 'listContracts' },
					{ name: 'List Tasks in Contract', value: 'listTasks' },
					{ name: 'Get Task', value: 'getTask' },
					{ name: 'My Assigned Events', value: 'myEvents' },
					{ name: 'Create Task', value: 'createTask' },
					{ name: 'Assign Executor', value: 'assign' },
					{ name: 'Update Status', value: 'setStatus' },
					{ name: 'Comment', value: 'comment' },
					{ name: 'Progress Report', value: 'progress' },
					{ name: 'Call Human', value: 'callHuman' },
					{ name: 'Poll Notifications', value: 'poll' },
				],
			},
			// --- contractId / eventId ---
			{
				displayName: 'Contract ID',
				name: 'contractId',
				type: 'number',
				default: 0,
				description: 'ceki contract id',
				displayOptions: { show: { operation: ['listTasks', 'createTask'] } },
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'number',
				default: 0,
				description: 'Task / event id (KalEvent)',
				displayOptions: {
					show: { operation: ['getTask', 'assign', 'setStatus', 'comment', 'progress', 'callHuman'] },
				},
			},
			// --- createTask fields ---
			{
				displayName: 'Label',
				name: 'label',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['createTask'] } },
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: { show: { operation: ['createTask', 'comment'] } },
			},
			{
				displayName: 'Executor (benefitable)',
				name: 'benefitableType',
				type: 'options',
				default: 'agent',
				options: [
					{ name: 'Agent', value: 'agent' },
					{ name: 'User (human)', value: 'user' },
				],
				displayOptions: { show: { operation: ['createTask', 'assign'] } },
			},
			{
				displayName: 'Executor ID',
				name: 'benefitableValue',
				type: 'number',
				default: 0,
				description: 'Agent ID or user ID of the executor',
				displayOptions: { show: { operation: ['createTask', 'assign'] } },
			},
			// --- status ---
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_OPTIONS,
				default: 200,
				displayOptions: { show: { operation: ['createTask', 'setStatus', 'progress'] } },
			},
			// --- progress desc ---
			{
				displayName: 'Progress Description',
				name: 'progressDesc',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'Body of the progress comment (does not overwrite the task spec)',
				displayOptions: { show: { operation: ['progress'] } },
			},
			// --- call human (escalate) ---
			{
				displayName: 'Call Kind',
				name: 'callKind',
				type: 'options',
				default: 'review',
				options: [
					{ name: 'Input (need clarification)', value: 'input' },
					{ name: 'Review (done, take a look)', value: 'review' },
					{ name: 'Stuck (blocked)', value: 'stuck' },
				],
				description: 'Type of escalation to a human (the call-human action)',
				displayOptions: { show: { operation: ['callHuman'] } },
			},
			{
				displayName: 'Message',
				name: 'callDesc',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'What to tell the human — context, question, or what was done',
				displayOptions: { show: { operation: ['callHuman'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const creds = await this.getCredentials('cekiApi');
		const token = creds.token as string;
		const client = new ContractClient(token);

		for (let i = 0; i < items.length; i++) {
			const op = this.getNodeParameter('operation', i) as string;
			let result: unknown;

			switch (op) {
				case 'listContracts':
					result = await client.listContracts();
					break;
				case 'listTasks': {
					const contractId = this.getNodeParameter('contractId', i) as number;
					result = await client.tasks(contractId);
					break;
				}
				case 'getTask': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					result = await client.task(eventId);
					break;
				}
				case 'myEvents':
					result = await client.myEvents();
					break;
				case 'createTask': {
					const contractId = this.getNodeParameter('contractId', i) as number;
					const label = this.getNodeParameter('label', i) as string;
					const description = (this.getNodeParameter('description', i) as string) || '';
					const status = this.getNodeParameter('status', i) as number;
					const bType = this.getNodeParameter('benefitableType', i) as string;
					const bValue = this.getNodeParameter('benefitableValue', i) as number;
					result = await client.create(contractId, {
						label,
						description: description || undefined,
						status,
						benefitable: bValue ? `${bType}:${bValue}` : undefined,
					});
					break;
				}
				case 'assign': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					const bType = this.getNodeParameter('benefitableType', i) as string;
					const bValue = this.getNodeParameter('benefitableValue', i) as number;
					if (!bValue) throw new Error('Executor ID is required for Assign');
					result = await client.propose(eventId, { benefitable: `${bType}:${bValue}` });
					break;
				}
				case 'setStatus': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					const status = this.getNodeParameter('status', i) as number;
					result = await client.propose(eventId, { status });
					break;
				}
				case 'comment': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					const description = (this.getNodeParameter('description', i) as string) || '';
					if (!description) throw new Error('Comment text is required');
					result = await client.comment(eventId, { description });
					break;
				}
				case 'progress': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					const status = this.getNodeParameter('status', i) as number;
					const desc = this.getNodeParameter('progressDesc', i) as string;
					result = await client.progress(eventId, { status, desc });
					break;
				}
				case 'callHuman': {
					const eventId = this.getNodeParameter('eventId', i) as number;
					const kind = this.getNodeParameter('callKind', i) as 'input' | 'review' | 'stuck';
					const desc = this.getNodeParameter('callDesc', i) as string;
					if (!desc) throw new Error('Message is required for Call Human');
					result = await client.callHuman(eventId, kind, desc);
					break;
				}
				case 'poll':
					result = await client.poll();
					break;
				default:
					throw new Error(`Unknown operation: ${op}`);
			}

			out.push({ json: { op, result: result as any } });
		}
		return [out];
	}
}
