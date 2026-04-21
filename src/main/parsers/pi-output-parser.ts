/**
 * Pi Output Parser
 *
 * Parses JSON output from the Pi coding agent (`pi --mode json --print`).
 *
 * Pi outputs JSONL with the following event-streaming format:
 *
 * 1. Session event:
 *    {"type":"session","id":"...","version":3,"timestamp":"...","cwd":"..."}
 *
 * 2. Flow events:
 *    {"type":"agent_start"}
 *    {"type":"turn_start"}
 *
 * 3. Message lifecycle:
 *    {"type":"message_start","message":{"role":"assistant","content":[],"provider":"...","model":"...","stopReason":"..."}}
 *    {"type":"message_update","assistantMessageEvent":{"type":"text_start"|"text_delta"|"text_end","delta":"...","contentIndex":0}}
 *    {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"usage":{...},"stopReason":"stop"}}
 *
 * 4. Turn/Agent end:
 *    {"type":"turn_end","message":{...},"toolResults":[]}
 *    {"type":"agent_end","messages":[...]}
 *
 * Text streaming uses the `assistantMessageEvent.delta` field in `message_update` events.
 * Final text is in the `message.content[].text` of `message_end`, `turn_end`, or `agent_end`.
 * Usage data is in `message.usage` with fields: input, output, cacheRead, cacheWrite, totalTokens, cost.
 * Errors are indicated by `message.stopReason === "error"` with details in `message.errorMessage`.
 *
 * Verified against Pi v0.67.68 output (2026-04-21).
 */

import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import type { ToolType, AgentError } from '../../shared/types';

/**
 * Raw event structure from Pi --mode json output
 */
interface PiStreamEvent {
	type:
		| 'session'
		| 'agent_start'
		| 'agent_end'
		| 'turn_start'
		| 'turn_end'
		| 'message_start'
		| 'message_update'
		| 'message_end';
	// session fields
	id?: string;
	version?: number;
	timestamp?: string;
	cwd?: string;
	// message_update fields
	assistantMessageEvent?: {
		type: 'text_start' | 'text_delta' | 'text_end';
		contentIndex?: number;
		delta?: string;
		content?: string;
		partial?: PiMessagePayload;
	};
	// message_start / message_end / turn_end fields
	message?: PiMessagePayload;
	// agent_end fields
	messages?: PiMessagePayload[];
	// turn_end fields
	toolResults?: unknown[];
}

interface PiMessagePayload {
	role: 'user' | 'assistant';
	content: Array<{ type: string; text?: string }>;
	api?: string;
	provider?: string;
	model?: string;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			total?: number;
		};
	};
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
	responseId?: string;
}

/**
 * Type guard to validate parsed JSON matches PiStreamEvent structure
 */
function isPiStreamEvent(data: unknown): data is PiStreamEvent {
	if (typeof data !== 'object' || data === null) {
		return false;
	}
	const obj = data as Record<string, unknown>;
	return (
		typeof obj.type === 'string' &&
		[
			'session',
			'agent_start',
			'agent_end',
			'turn_start',
			'turn_end',
			'message_start',
			'message_update',
			'message_end',
		].includes(obj.type)
	);
}

/**
 * Extract text from content blocks
 */
function extractTextFromContent(content?: Array<{ type: string; text?: string }>): string {
	if (!content || content.length === 0) return '';
	return content
		.filter((c) => c.type === 'text' && c.text)
		.map((c) => c.text!)
		.join('');
}

export class PiOutputParser implements AgentOutputParser {
	readonly agentId: ToolType = 'pi';

	/**
	 * Parse a single JSON line from agent output
	 */
	parseJsonLine(line: string): ParsedEvent | null {
		if (!line.trim()) return null;

		try {
			const parsed: unknown = JSON.parse(line);
			return (
				this.parseJsonObject(parsed) ?? {
					type: 'text' as const,
					text: line,
					isPartial: true,
					raw: parsed,
				}
			);
		} catch {
			if (line.trim()) {
				return {
					type: 'text',
					text: line,
					isPartial: true,
					raw: line,
				};
			}
			return null;
		}
	}

	/**
	 * Parse a JSON object into a normalized event.
	 */
	parseJsonObject(parsed: unknown): ParsedEvent | null {
		if (!parsed || typeof parsed !== 'object') return null;
		if (!isPiStreamEvent(parsed)) return null;

		const data = parsed;

		switch (data.type) {
			case 'session':
				return {
					type: 'init',
					sessionId: data.id,
					text: `Session: ${data.id}`,
					raw: data,
				};

			case 'agent_start':
			case 'turn_start':
				return { type: 'system', raw: data };

			case 'message_start':
				return this.parseMessageStart(data);

			case 'message_update':
				return this.parseMessageUpdate(data);

			case 'message_end':
				return this.parseMessageEnd(data);

			case 'turn_end':
				return this.parseTurnEnd(data);

			case 'agent_end':
				return this.parseAgentEnd(data);

			default:
				return { type: 'system', raw: data };
		}
	}

	/**
	 * Parse message_start events
	 */
	private parseMessageStart(data: PiStreamEvent): ParsedEvent | null {
		const message = data.message;
		if (!message) return null;

		// Check for immediate errors in message_start
		if (message.stopReason === 'error' && message.errorMessage) {
			return {
				type: 'error',
				text: message.errorMessage,
				raw: data,
			};
		}

		if (message.role === 'assistant') {
			return { type: 'text', text: '', isPartial: true, raw: data };
		}

		// User message start - just a system event
		return { type: 'system', raw: data };
	}

	/**
	 * Parse message_update events - these contain text deltas for streaming
	 */
	private parseMessageUpdate(data: PiStreamEvent): ParsedEvent | null {
		const assistantEvent = data.assistantMessageEvent;
		if (!assistantEvent) return null;

		const eventType = assistantEvent.type;

		// Extract text from delta (text_delta and text_start events)
		if (eventType === 'text_delta' || eventType === 'text_start') {
			const delta = assistantEvent.delta;
			if (delta) {
				return { type: 'text', text: delta, isPartial: true, raw: data };
			}
		}

		// text_end may contain the complete content
		if (eventType === 'text_end') {
			const content = assistantEvent.content;
			if (content) {
				return { type: 'text', text: content, isPartial: false, raw: data };
			}
		}

		// Fallback: check message.content for accumulated text
		const message = data.message;
		if (message?.role === 'assistant') {
			const text = extractTextFromContent(message.content);
			if (text) {
				return { type: 'text', text, isPartial: eventType !== 'text_end', raw: data };
			}
		}

		return null;
	}

	/**
	 * Parse message_end events - these contain the final message
	 */
	private parseMessageEnd(data: PiStreamEvent): ParsedEvent | null {
		const message = data.message;
		if (!message) return null;

		// Check for error
		if (message.stopReason === 'error') {
			return {
				type: 'error',
				text: message.errorMessage || 'Unknown error',
				raw: data,
			};
		}

		if (message.role === 'assistant') {
			const text = extractTextFromContent(message.content);
			if (text) {
				return {
					type: 'result',
					text,
					usage: this.extractUsageFromPayload(message),
					raw: data,
				};
			}
		}

		return null;
	}

	/**
	 * Parse turn_end events
	 */
	private parseTurnEnd(data: PiStreamEvent): ParsedEvent | null {
		const message = data.message;
		if (!message) return null;

		if (message.role === 'assistant') {
			const text = extractTextFromContent(message.content);
			if (text) {
				return {
					type: 'result',
					text,
					usage: this.extractUsageFromPayload(message),
					raw: data,
				};
			}
		}

		return null;
	}

	/**
	 * Parse agent_end events - extract final result from last assistant message
	 */
	private parseAgentEnd(data: PiStreamEvent): ParsedEvent | null {
		const messages = data.messages;
		if (!messages || messages.length === 0) return null;

		// Find last assistant message
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === 'assistant') {
				const text = extractTextFromContent(msg.content);
				if (text) {
					return {
						type: 'result',
						text,
						usage: this.extractUsage(msg) || undefined,
						raw: data,
					};
				}
			}
		}

		return null;
	}

	/**
	 * Extract usage statistics from a message payload
	 */
	private extractUsageFromPayload(message: PiMessagePayload): ParsedEvent['usage'] | undefined {
		const usage = message.usage;
		if (!usage) return undefined;

		return {
			inputTokens: usage.input || 0,
			outputTokens: usage.output || 0,
			cacheReadTokens: usage.cacheRead || 0,
			cacheCreationTokens: usage.cacheWrite || 0,
			costUsd: usage.cost?.total,
		};
	}

	/**
	 * Check if this event represents a final result.
	 */
	isResultMessage(event: ParsedEvent): boolean {
		if (event.type === 'result') return true;
		if (event.type === 'text' && !event.isPartial) return true;
		const raw = event.raw as PiStreamEvent | undefined;
		return raw?.type === 'turn_end' || raw?.type === 'agent_end';
	}

	/**
	 * Extract session ID from an event.
	 */
	extractSessionId(event: ParsedEvent): string | null {
		if (event.sessionId) return event.sessionId;
		const raw = event.raw as PiStreamEvent | undefined;
		return raw?.id || null;
	}

	/**
	 * Extract usage statistics from an event.
	 * This is the interface method called by StdoutHandler.
	 */
	extractUsage(eventOrMessage: ParsedEvent | PiMessagePayload): ParsedEvent['usage'] | null {
		// If called with a ParsedEvent (from StdoutHandler)
		if ('type' in eventOrMessage && typeof eventOrMessage.type === 'string') {
			const event = eventOrMessage as ParsedEvent;
			if (event.usage) return event.usage;
			// Try to extract from raw message
			const raw = event.raw as PiStreamEvent | undefined;
			if (raw?.message?.usage) {
				return this.extractUsageFromPayload(raw.message);
			}
			return null;
		}
		// If called with a PiMessagePayload (from internal methods)
		return this.extractUsageFromPayload(eventOrMessage as PiMessagePayload);
	}

	/**
	 * Extract slash commands from an event.
	 * Pi doesn't report slash commands in JSON output.
	 */
	extractSlashCommands(_event: ParsedEvent): string[] | null {
		return null;
	}

	/**
	 * Detect errors from a parsed JSON object.
	 */
	detectErrorFromParsed(parsed: unknown): AgentError | null {
		if (!parsed || typeof parsed !== 'object') return null;

		const obj = parsed as PiStreamEvent;

		// Check for error stopReason in message events
		if (
			(obj.type === 'message_start' || obj.type === 'message_end') &&
			obj.message?.stopReason === 'error'
		) {
			const errorMsg = obj.message.errorMessage || 'Unknown error';
			return {
				type: 'unknown',
				message: errorMsg,
				recoverable: true,
				agentId: this.agentId,
				timestamp: Date.now(),
				parsedJson: parsed,
			};
		}

		// Check for generic error type
		const msg = parsed as Record<string, unknown>;
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
		if (!line.trim()) return null;

		try {
			const error = this.detectErrorFromParsed(JSON.parse(line));
			if (error) {
				error.raw = { ...(error.raw as Record<string, unknown>), errorLine: line };
			}
			return error;
		} catch {
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
	}

	/**
	 * Detect errors from process exit.
	 */
	detectErrorFromExit(exitCode: number, stderr: string, stdout: string): AgentError | null {
		if (exitCode === 0) return null;

		const combined = `${stderr}\n${stdout}`;

		if (combined.includes('credential(s) exhausted')) {
			return {
				type: 'rate_limited',
				message: `Pi rate limited: ${stderr.trim().split('\n')[0].substring(0, 200)}`,
				recoverable: true,
				agentId: this.agentId,
				timestamp: Date.now(),
				raw: { exitCode, stderr, stdout },
			};
		}

		const stderrPreview = stderr?.trim()
			? `: ${stderr.trim().split('\n')[0].substring(0, 200)}`
			: '';
		return {
			type: 'agent_crashed',
			message: `Pi exited with code ${exitCode}${stderrPreview}`,
			recoverable: true,
			agentId: this.agentId,
			timestamp: Date.now(),
			raw: { exitCode, stderr, stdout },
		};
	}
}
