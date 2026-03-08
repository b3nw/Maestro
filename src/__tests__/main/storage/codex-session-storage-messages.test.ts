/**
 * Tests for Codex session storage readSessionMessages - specifically verifying
 * that tool calls are properly parsed with toolUse for ToolCallCard rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Electron app
vi.mock('electron', () => ({
	app: { getPath: () => '/tmp' },
}));

// Mock logger
vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// Mock sentry
vi.mock('../../../main/utils/sentry', () => ({
	captureException: vi.fn(),
}));

// Mock remote-fs
vi.mock('../../../main/utils/remote-fs', () => ({
	readFileRemote: vi.fn(),
	readDirRemote: vi.fn(),
	statRemote: vi.fn(),
}));

// Mock fs
vi.mock('fs/promises', () => ({
	default: {
		readFile: vi.fn(),
		readdir: vi.fn(),
		stat: vi.fn(),
		access: vi.fn(),
	},
}));

import fs from 'fs/promises';
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';

/**
 * Create a realistic Codex v0.111.0 session JSONL content
 */
function createSessionContent(): string {
	const lines = [
		// Line 1: session metadata
		JSON.stringify({
			timestamp: '2026-03-08T03:10:29.069Z',
			type: 'session_meta',
			payload: {
				id: '019ccb6c-c0fd-7b70-92b7-558f514099c6',
				timestamp: '2026-03-08T03:10:28.101Z',
				cwd: 'C:\\Users\\test\\project',
				cli_version: '0.111.0',
			},
		}),
		// Line 2: user message
		JSON.stringify({
			timestamp: '2026-03-08T03:10:29.070Z',
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'user',
				content: [{ type: 'input_text', text: 'Fix the bug in main.ts' }],
			},
		}),
		// Line 3: assistant message
		JSON.stringify({
			timestamp: '2026-03-08T03:10:33.000Z',
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'assistant',
				content: [
					{
						type: 'output_text',
						text: "I'll review the code first.",
					},
				],
			},
		}),
		// Line 4: function_call
		JSON.stringify({
			timestamp: '2026-03-08T03:10:33.593Z',
			type: 'response_item',
			payload: {
				type: 'function_call',
				name: 'shell_command',
				arguments: '{"command":"cat main.ts","workdir":"C:\\\\Users\\\\test\\\\project"}',
				call_id: 'call_abc123',
			},
		}),
		// Line 5: function_call_output
		JSON.stringify({
			timestamp: '2026-03-08T03:10:40.169Z',
			type: 'response_item',
			payload: {
				type: 'function_call_output',
				call_id: 'call_abc123',
				output: 'Exit code: 0\nWall time: 1 seconds\nOutput:\nconst x = 1;',
			},
		}),
		// Line 6: custom_tool_call (apply_patch)
		JSON.stringify({
			timestamp: '2026-03-08T03:10:41.000Z',
			type: 'response_item',
			payload: {
				type: 'custom_tool_call',
				name: 'apply_patch',
				arguments:
					'{"patch":"--- a/main.ts\\n+++ b/main.ts\\n@@ -1 +1 @@\\n-const x = 1;\\n+const x = 2;"}',
				call_id: 'call_def456',
			},
		}),
		// Line 7: custom_tool_call_output
		JSON.stringify({
			timestamp: '2026-03-08T03:10:42.000Z',
			type: 'response_item',
			payload: {
				type: 'custom_tool_call_output',
				call_id: 'call_def456',
				output: 'Patch applied successfully',
			},
		}),
		// Line 8: final assistant message
		JSON.stringify({
			timestamp: '2026-03-08T03:10:44.000Z',
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'Fixed the bug.' }],
			},
		}),
	];
	return lines.join('\n');
}

describe('CodexSessionStorage - readSessionMessages', () => {
	let storage: CodexSessionStorage;

	beforeEach(() => {
		storage = new CodexSessionStorage();
		vi.clearAllMocks();
	});

	it('should parse function_call entries with toolUse', async () => {
		const content = createSessionContent();

		// Mock findSessionFile to return a path
		vi.spyOn(storage as any, 'findSessionFile').mockResolvedValue(
			'/home/user/.codex/sessions/2026/03/08/test.jsonl'
		);
		vi.mocked(fs.readFile).mockResolvedValue(content);

		const result = await storage.readSessionMessages('C:\\Users\\test\\project', 'test-session', {
			offset: 0,
			limit: 50,
		});

		expect(result.messages.length).toBeGreaterThan(0);

		// Find the shell_command tool call message
		const shellMsg = result.messages.find((m) => m.content === 'Tool: shell_command');
		expect(shellMsg).toBeDefined();
		expect(shellMsg!.toolUse).toBeDefined();
		expect(Array.isArray(shellMsg!.toolUse)).toBe(true);

		const toolUseArr = shellMsg!.toolUse as any[];
		expect(toolUseArr.length).toBe(1);
		expect(toolUseArr[0].tool).toBe('shell_command');
		expect(toolUseArr[0].state).toBeDefined();
		expect(toolUseArr[0].state.status).toBe('completed');
		expect(toolUseArr[0].state.input).toBeDefined();
		expect(toolUseArr[0].state.output).toBe(
			'Exit code: 0\nWall time: 1 seconds\nOutput:\nconst x = 1;'
		);
	});

	it('should parse custom_tool_call entries with toolUse', async () => {
		const content = createSessionContent();

		vi.spyOn(storage as any, 'findSessionFile').mockResolvedValue(
			'/home/user/.codex/sessions/2026/03/08/test.jsonl'
		);
		vi.mocked(fs.readFile).mockResolvedValue(content);

		const result = await storage.readSessionMessages('C:\\Users\\test\\project', 'test-session', {
			offset: 0,
			limit: 50,
		});

		const patchMsg = result.messages.find((m) => m.content === 'Tool: apply_patch');
		expect(patchMsg).toBeDefined();
		expect(patchMsg!.toolUse).toBeDefined();

		const toolUseArr = patchMsg!.toolUse as any[];
		expect(toolUseArr[0].tool).toBe('apply_patch');
		expect(toolUseArr[0].state.output).toBe('Patch applied successfully');
	});

	it('should NOT create messages for function_call_output entries', async () => {
		const content = createSessionContent();

		vi.spyOn(storage as any, 'findSessionFile').mockResolvedValue(
			'/home/user/.codex/sessions/2026/03/08/test.jsonl'
		);
		vi.mocked(fs.readFile).mockResolvedValue(content);

		const result = await storage.readSessionMessages('C:\\Users\\test\\project', 'test-session', {
			offset: 0,
			limit: 50,
		});

		// Should have: user msg, assistant msg, shell_command tool, apply_patch tool, final assistant msg = 5
		expect(result.messages.length).toBe(5);

		// Verify no message contains raw output text as content
		const outputMsg = result.messages.find((m) => m.content.includes('Exit code:'));
		expect(outputMsg).toBeUndefined();
	});

	it('should render plain text messages without toolUse', async () => {
		const content = createSessionContent();

		vi.spyOn(storage as any, 'findSessionFile').mockResolvedValue(
			'/home/user/.codex/sessions/2026/03/08/test.jsonl'
		);
		vi.mocked(fs.readFile).mockResolvedValue(content);

		const result = await storage.readSessionMessages('C:\\Users\\test\\project', 'test-session', {
			offset: 0,
			limit: 50,
		});

		const textMsg = result.messages.find((m) => m.content === "I'll review the code first.");
		expect(textMsg).toBeDefined();
		expect(textMsg!.toolUse).toBeUndefined();
	});

	it('toolUse array entries should satisfy ToolCallCard interface', async () => {
		const content = createSessionContent();

		vi.spyOn(storage as any, 'findSessionFile').mockResolvedValue(
			'/home/user/.codex/sessions/2026/03/08/test.jsonl'
		);
		vi.mocked(fs.readFile).mockResolvedValue(content);

		const result = await storage.readSessionMessages('C:\\Users\\test\\project', 'test-session', {
			offset: 0,
			limit: 50,
		});

		// Check all messages with toolUse
		for (const msg of result.messages) {
			if (msg.toolUse) {
				const arr = msg.toolUse as any[];
				expect(Array.isArray(arr)).toBe(true);
				expect(arr.length).toBeGreaterThan(0);

				for (const entry of arr) {
					// Must have 'tool' or 'name' for getToolName()
					expect(entry.tool || entry.name).toBeTruthy();
					// Must have state for ToolCallCard rendering
					expect(entry.state).toBeDefined();
					expect(entry.state.status).toBeDefined();
				}
			}
		}
	});
});
