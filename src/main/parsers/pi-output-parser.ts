/**
 * Pi Output Parser
 *
 * Parses JSON output from the Pi coding agent.
 *
 * Pi's JSON output format uses these event types:
 * - session: Initial session info with id, version, timestamp, cwd
 * - agent_start: Agent initialization
 * - turn_start: Beginning of a turn
 * - message_start: Message beginning (role: user/assistant)
 * - message_update: Message content updates with assistantMessageEvent
 * - message_end: Message completion
 * - turn_end: End of turn with final message
 * - agent_end: Agent completion with all messages
 *
 * The response text is in message_update events with assistantMessageEvent.type === 'text_delta'
 * and in message_end/message_update events with content arrays.
 */

import { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import type { ToolType, AgentError } from '../../shared/types';

export class PiOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'pi';

	/**
	 * Parse a single JSON line from agent output
	 */
	parseJsonLine(line: string): ParsedEvent | null {
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			return null;
		}
		return this.parseJsonObject(obj);
	}

	/**
	 * Parse a JSON object into a normalized event.
	 */
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
				return {
					type: 'system',
					text: 'Agent started',
				};

			case 'turn_start':
				return {
					type: 'system',
					text: 'Turn started',
				};

			case 'message_start': {
				const message = msg.message as Record<string, unknown> | undefined;
				const role = message?.role as string | undefined;
				if (role === 'assistant') {
					return {
						type: 'text',
						text: '',
						isPartial: true,
					};
				}
				return null;
			}

			case 'message_update': {
				const assistantEvent = msg.assistantMessageEvent as Record<string, unknown> | undefined;
				const eventType = assistantEvent?.type as string | undefined;

				if (eventType === 'text_delta' || eventType === 'text_start') {
					const delta = assistantEvent?.delta as string | undefined;
					if (delta) {
						return {
							type: 'text',
							text: delta,
							isPartial: true,
						};
					}
				}

				// Also check the message content
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
				const role = message?.role as string | undefined;
				if (role === 'assistant') {
					const content = message?.content as Array<Record<string, unknown>> | undefined;
					if (content && content.length > 0) {
						const textContent = content.find((c) => c.type === 'text');
						if (textContent?.text) {
							return {
								type: 'result',
								text: textContent.text as string,
							};
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
						return {
							type: 'result',
							text: textContent.text as string,
						};
					}
				}
				return null;
			}

			case 'agent_end': {
				const messages = msg.messages as Array<Record<string, unknown>> | undefined;
				if (messages && messages.length > 0) {
					// Find the last assistant message
					for (let i = messages.length - 1; i >= 0; i--) {
						const message = messages[i];
						if (message.role === 'assistant') {
							const content = message.content as Array<Record<string, unknown>> | undefined;
							if (content && content.length > 0) {
								const textContent = content.find((c) => c.type === 'text');
								if (textContent?.text) {
									return {
										type: 'result',
										text: textContent.text as string,
									};
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

	/**
	 * Check if this event represents a final result.
	 */
	isResultMessage(event: ParsedEvent): boolean {
		return event.type === 'result' || (event.type === 'text' && !event.isPartial);
	}

	/**
	 * Extract session ID from an event.
	 */
	extractSessionId(event: ParsedEvent): string | null {
		return event.sessionId || null;
	}

	/**
	 * Extract usage statistics from an event.
	 */
	extractUsage(event: ParsedEvent): ParsedEvent['usage'] | null {
		// Pi reports usage in message events, but we'd need the raw object
		// For now, return null - usage is extracted elsewhere
		return event.usage || null;
	}

	/**
	 * Extract slash commands from an event.
	 */
	extractSlashCommands(_event: ParsedEvent): string[] | null {
		// Pi doesn't report slash commands in JSON output
		return null;
	}

	/**
	 * Detect errors from a parsed JSON object.
	 */
	detectErrorFromParsed(obj: unknown): AgentError | null {
		if (!obj || typeof obj !== 'object') return null;

		const msg = obj as Record<string, unknown>;

		// Check for error type
		if (msg.type === 'error' || msg.error) {
			const errorMsg = (msg.error as string) || (msg.message as string) || 'Unknown error';
			return {
				type: 'unknown',
				message: errorMsg,
				recoverable: false,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: msg,
			};
		}

		return null;
	}

	/**
	 * Detect errors from a raw line.
	 */
	detectErrorFromLine(line: string): AgentError | null {
		// Check for common Pi error patterns
		if (line.includes('Error:') || line.includes('error:')) {
			return {
				type: 'unknown',
				message: line,
				recoverable: false,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: { errorLine: line },
			};
		}

		return null;
	}

	/**
	 * Detect errors from process exit.
	 */
	detectErrorFromExit(exitCode: number | null, stderr?: string): AgentError | null {
		if (exitCode === 0) return null;

		return {
			type: 'unknown',
			message: stderr || `Process exited with code ${exitCode}`,
			recoverable: false,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: { exitCode: exitCode ?? undefined, stderr },
		};
	}
}
