import type { ModelMessage } from 'ai';
type ToolModelMessage = Extract<ModelMessage, { role: 'tool' }>;
type ToolResultPart = ToolModelMessage['content'][number];

const part: ToolResultPart = { type: 'tool-result', toolCallId: 'call_1', toolName: 'read', result: '...', isError: false };
const part2: ToolResultPart = { type: 'tool-result', toolCallId: 'call_2', toolName: 'read', output: { type: 'text', value: '...' } };
