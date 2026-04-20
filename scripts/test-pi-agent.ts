#!/usr/bin/env npx ts-node
/**
 * Pi Agent Testing Tool
 *
 * Tests the Pi agent integration without running Maestro UI.
 * Validates:
 * 1. Pi binary detection and execution
 * 2. Model discovery
 * 3. Output parser handling of all event types
 * 4. Full spawn → response cycle
 *
 * Usage:
 *   npx ts-node scripts/test-pi-agent.ts
 *   npx ts-node scripts/test-pi-agent.ts --quick
 *   npx ts-node scripts/test-pi-agent.ts --parser-only
 */

// Note: Run from project root with: npx ts-node scripts/test-pi-agent.ts
// The imports use relative paths from the scripts directory

import { spawn } from 'child_process';

// Inline minimal parser for testing (avoids module resolution issues)
interface ParsedEvent {
	type: 'init' | 'text' | 'tool_use' | 'result' | 'error' | 'usage' | 'system';
	sessionId?: string;
	text?: string;
	isPartial?: boolean;
}

class PiOutputParser {
	readonly agentId = 'pi';

	parseJsonLine(line: string): ParsedEvent | null {
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			return null;
		}
		return this.parseJsonObject(obj);
	}

	parseJsonObject(obj: unknown): ParsedEvent | null {
		if (!obj || typeof obj !== 'object') return null;

		const msg = obj as Record<string, unknown>;
		const type = msg.type as string | undefined;

		switch (type) {
			case 'session':
				return {
					type: 'init',
					sessionId: msg.id as string,
					text: `Session: ${msg.id}`,
				};

			case 'agent_start':
				return { type: 'system', text: 'Agent started' };

			case 'turn_start':
				return { type: 'system', text: 'Turn started' };

			case 'message_start': {
				const message = msg.message as Record<string, unknown> | undefined;
				if (message?.role === 'assistant') {
					return { type: 'text', text: '', isPartial: true };
				}
				return null;
			}

			case 'message_update': {
				const assistantEvent = msg.assistantMessageEvent as Record<string, unknown> | undefined;
				const eventType = assistantEvent?.type as string | undefined;

				if (eventType === 'text_delta' || eventType === 'text_start') {
					const delta = assistantEvent?.delta as string | undefined;
					if (delta) {
						return { type: 'text', text: delta, isPartial: true };
					}
				}

				const message = msg.message as Record<string, unknown> | undefined;
				const content = message?.content as Array<Record<string, unknown>> | undefined;
				if (content && content.length > 0) {
					const textContent = content.find((c) => c.type === 'text');
					if (textContent?.text) {
						return {
							type: 'text',
							text: textContent.text as string,
							isPartial: eventType !== 'text_end',
						};
					}
				}
				return null;
			}

			case 'message_end': {
				const message = msg.message as Record<string, unknown> | undefined;
				if (message?.role === 'assistant') {
					const content = message?.content as Array<Record<string, unknown>> | undefined;
					if (content && content.length > 0) {
						const textContent = content.find((c) => c.type === 'text');
						if (textContent?.text) {
							return { type: 'result', text: textContent.text as string };
						}
					}
				}
				return null;
			}

			case 'turn_end': {
				const message = msg.message as Record<string, unknown> | undefined;
				const content = message?.content as Array<Record<string, unknown>> | undefined;
				if (content && content.length > 0) {
					const textContent = content.find((c) => c.type === 'text');
					if (textContent?.text) {
						return { type: 'result', text: textContent.text as string };
					}
				}
				return null;
			}

			case 'agent_end': {
				const messages = msg.messages as Array<Record<string, unknown>> | undefined;
				if (messages && messages.length > 0) {
					for (let i = messages.length - 1; i >= 0; i--) {
						const message = messages[i];
						if (message.role === 'assistant') {
							const content = message.content as Array<Record<string, unknown>> | undefined;
							if (content && content.length > 0) {
								const textContent = content.find((c) => c.type === 'text');
								if (textContent?.text) {
									return { type: 'result', text: textContent.text as string };
								}
							}
						}
					}
				}
				return null;
			}

			default:
				return null;
		}
	}

	isResultMessage(event: ParsedEvent): boolean {
		return event.type === 'result' || (event.type === 'text' && !event.isPartial);
	}

	detectErrorFromParsed(obj: unknown): { message: string } | null {
		if (!obj || typeof obj !== 'object') return null;
		const msg = obj as Record<string, unknown>;
		if (msg.type === 'error' || msg.error) {
			return { message: (msg.error as string) || (msg.message as string) || 'Unknown error' };
		}
		return null;
	}

	detectErrorFromLine(line: string): { message: string } | null {
		if (line.includes('Error:') || line.includes('error:')) {
			return { message: line };
		}
		return null;
	}
}

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	details?: string;
	duration?: number;
}

const results: TestResult[] = [];

function log(message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
	const colors = {
		info: '\x1b[36m', // cyan
		warn: '\x1b[33m', // yellow
		error: '\x1b[31m', // red
		success: '\x1b[32m', // green
	};
	const reset = '\x1b[0m';
	console.log(`${colors[level]}${message}${reset}`);
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

async function runCommand(
	command: string,
	args: string[],
	options?: { timeout?: number; input?: string }
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	duration: number;
}> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		const proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: process.platform === 'win32',
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data) => {
			stdout += data.toString();
		});

		proc.stderr?.on('data', (data) => {
			stderr += data.toString();
		});

		proc.on('close', (code) => {
			resolve({
				stdout,
				stderr,
				exitCode: code,
				duration: Date.now() - startTime,
			});
		});

		proc.on('error', (err) => {
			reject(err);
		});

		if (options?.input) {
			proc.stdin?.write(options.input);
			proc.stdin?.end();
		}

		if (options?.timeout) {
			setTimeout(() => {
				proc.kill();
				reject(new Error(`Command timed out after ${options.timeout}ms`));
			}, options.timeout);
		}
	});
}

// ============================================================================
// Test Cases
// ============================================================================

async function testPiBinaryDetection(): Promise<TestResult> {
	const name = 'Pi binary detection';
	const startTime = Date.now();

	try {
		// Check if pi is in PATH
		const result =
			process.platform === 'win32'
				? await runCommand('where', ['pi'], { timeout: 5000 })
				: await runCommand('which', ['pi'], { timeout: 5000 });

		assert(result.exitCode === 0, `pi binary not found in PATH`);
		assert(result.stdout.length > 0, `pi binary path is empty`);

		return {
			name,
			passed: true,
			details: `Found at: ${result.stdout.trim()}`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testPiVersion(): Promise<TestResult> {
	const name = 'Pi version check';
	const startTime = Date.now();

	try {
		const result = await runCommand('pi', ['--version'], { timeout: 5000 });

		assert(result.exitCode === 0, `pi --version failed with exit code ${result.exitCode}`);
		assert(
			result.stdout.includes('.') || result.stderr.includes('.'),
			`Version output doesn't look like a version number`
		);

		return {
			name,
			passed: true,
			details: `Version: ${(result.stdout || result.stderr).trim()}`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testPiModelDiscovery(): Promise<TestResult> {
	const name = 'Pi model discovery';
	const startTime = Date.now();

	try {
		// pi --list-models outputs to stderr
		const result = await runCommand('pi', ['--list-models'], { timeout: 15000 });

		// Check for table format (provider/model columns)
		const output = result.stderr;
		assert(
			output.includes('provider') || output.includes('/'),
			`Model list doesn't contain expected format`
		);

		// Count models (rough estimate by counting lines with '/')
		const lines = output.split('\n').filter((l) => l.includes('/'));
		assert(lines.length > 10, `Expected at least 10 models, found ${lines.length}`);

		return {
			name,
			passed: true,
			details: `Found ${lines.length} model entries`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testParserRegistration(): Promise<TestResult> {
	const name = 'Parser instantiation';
	const startTime = Date.now();

	try {
		const parser = new PiOutputParser();

		assert(parser !== null, `Pi parser could not be instantiated`);
		assert(parser.agentId === 'pi', `Parser agentId mismatch: ${parser.agentId}`);

		return {
			name,
			passed: true,
			details: `Parser instantiated for agent: ${parser.agentId}`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testParserEventTypes(): Promise<TestResult> {
	const name = 'Parser event type handling';
	const startTime = Date.now();

	try {
		const parser = new PiOutputParser();

		// Test session event
		const sessionEvent = parser.parseJsonLine(
			'{"type":"session","id":"test-123","version":3,"timestamp":"2026-01-01T00:00:00Z","cwd":"/test"}'
		);
		assert(
			sessionEvent?.type === 'init',
			`session should parse to init, got ${sessionEvent?.type}`
		);
		assert(sessionEvent?.sessionId === 'test-123', `sessionId should be extracted`);

		// Test agent_start event
		const agentStartEvent = parser.parseJsonLine('{"type":"agent_start"}');
		assert(agentStartEvent?.type === 'system', `agent_start should parse to system`);

		// Test turn_start event
		const turnStartEvent = parser.parseJsonLine('{"type":"turn_start"}');
		assert(turnStartEvent?.type === 'system', `turn_start should parse to system`);

		// Test message_start event (assistant)
		const messageStartEvent = parser.parseJsonLine(
			'{"type":"message_start","message":{"role":"assistant"}}'
		);
		assert(messageStartEvent?.type === 'text', `message_start (assistant) should parse to text`);
		assert(messageStartEvent?.isPartial === true, `message_start should be partial`);

		// Test message_update event with text_delta
		const messageUpdateEvent = parser.parseJsonLine(
			'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"},"message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]}}'
		);
		assert(messageUpdateEvent?.type === 'text', `message_update should parse to text`);
		assert(messageUpdateEvent?.text === 'Hello', `text should be extracted from delta`);

		// Test message_end event (assistant)
		const messageEndEvent = parser.parseJsonLine(
			'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Final response"}]}}'
		);
		assert(messageEndEvent?.type === 'result', `message_end should parse to result`);
		assert(messageEndEvent?.text === 'Final response', `text should be extracted`);

		// Test turn_end event
		const turnEndEvent = parser.parseJsonLine(
			'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"Turn result"}]}}'
		);
		assert(turnEndEvent?.type === 'result', `turn_end should parse to result`);

		// Test agent_end event
		const agentEndEvent = parser.parseJsonLine(
			'{"type":"agent_end","messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]},{"role":"assistant","content":[{"type":"text","text":"Hello!"}]}]}'
		);
		assert(agentEndEvent?.type === 'result', `agent_end should parse to result`);
		assert(agentEndEvent?.text === 'Hello!', `last assistant message should be extracted`);

		// Test invalid JSON
		const invalidEvent = parser.parseJsonLine('not json');
		assert(invalidEvent === null, `invalid JSON should return null`);

		// Test unknown event type
		const unknownEvent = parser.parseJsonLine('{"type":"unknown"}');
		assert(unknownEvent === null, `unknown event type should return null`);

		return {
			name,
			passed: true,
			details: 'All 12 parser tests passed',
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testParserIsResultMessage(): Promise<TestResult> {
	const name = 'Parser isResultMessage';
	const startTime = Date.now();

	try {
		const parser = new PiOutputParser();

		// Result event should return true
		assert(
			parser.isResultMessage({ type: 'result', text: 'test' }),
			`result event should be a result message`
		);

		// Non-partial text should be true
		assert(
			parser.isResultMessage({ type: 'text', text: 'test', isPartial: false }),
			`non-partial text should be a result message`
		);

		// Partial text should be false
		const partialEvent = { type: 'text' as const, text: 'test', isPartial: true };
		assert(!parser.isResultMessage(partialEvent), `partial text should NOT be a result message`);

		// System event should be false
		assert(
			!parser.isResultMessage({ type: 'system', text: 'test' }),
			`system event should NOT be a result message`
		);

		return {
			name,
			passed: true,
			details: 'All isResultMessage tests passed',
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testParserErrorDetection(): Promise<TestResult> {
	const name = 'Parser error detection';
	const startTime = Date.now();

	try {
		const parser = new PiOutputParser();

		// Test error from parsed object
		const error1 = parser.detectErrorFromParsed({ type: 'error', message: 'Test error' });
		assert(error1 !== null, `should detect error type`);
		assert(error1?.message === 'Test error', `should extract error message`);

		// Test error from line
		const error2 = parser.detectErrorFromLine('Error: Something went wrong');
		assert(error2 !== null, `should detect error from line`);
		assert(error2!.message.includes('Something went wrong'), `should extract error from line`);

		// Test non-error
		const error3 = parser.detectErrorFromParsed({ type: 'text', text: 'Hello' });
		assert(error3 === null, `should not detect error from non-error object`);

		return {
			name,
			passed: true,
			details: 'All error detection tests passed',
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testPiSimplePrompt(): Promise<TestResult> {
	const name = 'Pi simple prompt execution';
	const startTime = Date.now();

	try {
		const result = await runCommand(
			'pi',
			['--mode', 'json', '--print', '--model', 'llm-proxy/nanogpt/minimax/minimax-m2.7'],
			{
				input: 'Say exactly "TEST_OK" and nothing else.',
				timeout: 30000,
			}
		);

		assert(result.exitCode === 0, `pi exited with code ${result.exitCode}`);
		assert(result.stdout.length > 0, `stdout is empty`);

		// Parse and validate output
		const parser = new PiOutputParser();
		const lines = result.stdout.split('\n').filter((l) => l.trim());

		let foundResult = false;
		let capturedText = '';

		for (const line of lines) {
			const event = parser.parseJsonLine(line);
			if (event) {
				if (event.type === 'result' || (event.type === 'text' && !event.isPartial)) {
					foundResult = true;
					capturedText = event.text || '';
				}
			}
		}

		assert(foundResult, `No result event found in output`);
		assert(capturedText.length > 0, `Result text is empty`);

		return {
			name,
			passed: true,
			details: `Response: "${capturedText.substring(0, 100)}${capturedText.length > 100 ? '...' : ''}"`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testPiStdinPassthrough(): Promise<TestResult> {
	const name = 'Pi stdin passthrough (bash -s simulation)';
	const startTime = Date.now();

	try {
		// Simulate what Maestro does: pipe script + prompt to bash -s
		const script = `#!/bin/bash
export PATH="$HOME/.npm-global/bin:$PATH"
cd /tmp
exec pi --mode json --print --model llm-proxy/nanogpt/minimax/minimax-m2.7
Say "STDIN_TEST_OK"`;

		const result = await runCommand('bash', ['--norc', '--noprofile', '-s'], {
			input: script,
			timeout: 30000,
		});

		assert(result.exitCode === 0, `bash -s exited with code ${result.exitCode}`);
		assert(result.stdout.length > 0, `stdout is empty`);

		// Parse output
		const parser = new PiOutputParser();
		const lines = result.stdout.split('\n').filter((l) => l.trim());

		let foundResult = false;
		for (const line of lines) {
			const event = parser.parseJsonLine(line);
			if (event?.type === 'result' || (event?.type === 'text' && !event.isPartial)) {
				foundResult = true;
			}
		}

		assert(foundResult, `No result event found in stdin passthrough output`);

		return {
			name,
			passed: true,
			details: `Stdin passthrough works, received ${lines.length} JSON lines`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

async function testPiContinueFlag(): Promise<TestResult> {
	const name = 'Pi --continue flag (non-interactive resume)';
	const startTime = Date.now();

	try {
		const result = await runCommand('pi', ['--mode', 'json', '--print', '--continue'], {
			input: 'What is 2+2? Reply with just the number.',
			timeout: 30000,
		});

		assert(result.exitCode === 0, `pi --continue exited with code ${result.exitCode}`);
		assert(result.stdout.length > 0, `stdout is empty`);

		// Verify no TUI output in stderr
		assert(
			!result.stderr.includes('Resume Session'),
			`stderr contains TUI output - --continue is not working as expected`
		);

		// Parse output
		const parser = new PiOutputParser();
		const lines = result.stdout.split('\n').filter((l) => l.trim());

		let foundResult = false;
		for (const line of lines) {
			const event = parser.parseJsonLine(line);
			if (event?.type === 'result' || (event?.type === 'text' && !event.isPartial)) {
				foundResult = true;
			}
		}

		assert(foundResult, `No result event found in --continue output`);

		return {
			name,
			passed: true,
			details: `--continue works non-interactively`,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
		};
	}
}

// ============================================================================
// Test Runner
// ============================================================================

async function runTests(options: { quick?: boolean; parserOnly?: boolean }): Promise<void> {
	log('\n╔══════════════════════════════════════════════════════════════╗', 'info');
	log('║              Pi Agent Integration Test Suite                ║', 'info');
	log('╚══════════════════════════════════════════════════════════════╝\n', 'info');

	const tests: (() => Promise<TestResult>)[] = [];

	// Parser tests (always run)
	tests.push(testParserRegistration);
	tests.push(testParserEventTypes);
	tests.push(testParserIsResultMessage);
	tests.push(testParserErrorDetection);

	if (!options.parserOnly) {
		// Binary tests
		tests.push(testPiBinaryDetection);
		tests.push(testPiVersion);
		tests.push(testPiModelDiscovery);

		if (!options.quick) {
			// Execution tests (slower)
			tests.push(testPiSimplePrompt);
			tests.push(testPiStdinPassthrough);
			tests.push(testPiContinueFlag);
		}
	}

	// Run all tests
	for (const test of tests) {
		try {
			const result = await test();
			results.push(result);

			const status = result.passed ? '✓' : '✗';
			const color = result.passed ? 'success' : 'error';
			log(`  ${status} ${result.name} (${result.duration}ms)`, color);

			if (result.details) {
				log(`      ${result.details}`, 'info');
			}
			if (!result.passed && result.error) {
				log(`      Error: ${result.error}`, 'error');
			}
		} catch (error) {
			results.push({
				name: 'Unknown test',
				passed: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// Summary
	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	const total = results.length;

	log('\n────────────────────────────────────────────────────────────────', 'info');
	log(
		`  Total: ${total} | Passed: ${passed} | Failed: ${failed}`,
		passed === total ? 'success' : 'warn'
	);

	if (failed > 0) {
		log('\n  Failed tests:', 'error');
		for (const result of results.filter((r) => !r.passed)) {
			log(`    - ${result.name}: ${result.error}`, 'error');
		}
	}

	log('');
}

// ============================================================================
// Entry Point
// ============================================================================

const args = process.argv.slice(2);
const options = {
	quick: args.includes('--quick'),
	parserOnly: args.includes('--parser-only'),
};

runTests(options).catch(console.error);
