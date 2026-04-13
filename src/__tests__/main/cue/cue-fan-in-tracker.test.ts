/**
 * Unit tests for CueFanInTracker — focused on the three new methods added
 * in Phase 8C: getActiveTrackerKeys, getTrackerCreatedAt, expireTracker,
 * plus the lifecycle cleanup of fanInCreatedAt in clearForSession and reset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
	CueSettings,
	CueSubscription,
	AgentCompletionData,
} from '../../../main/cue/cue-types';
import { createCueFanInTracker } from '../../../main/cue/cue-fan-in-tracker';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<CueSubscription> = {}): CueSubscription {
	return {
		name: 'fan-in-sub',
		event: 'agent.completed',
		enabled: true,
		prompt: 'compile results',
		source_sessions: ['session-a', 'session-b'],
		...overrides,
	};
}

function makeSettings(overrides: Partial<CueSettings> = {}): CueSettings {
	return {
		timeout_minutes: 30,
		timeout_on_fail: 'break',
		max_concurrent: 1,
		queue_size: 10,
		...overrides,
	};
}

function makeCompletion(overrides: Partial<AgentCompletionData> = {}): AgentCompletionData {
	return {
		sessionName: 'agent-a',
		status: 'completed',
		exitCode: 0,
		durationMs: 1000,
		stdout: 'output from agent',
		triggeredBy: 'fan-in-sub',
		chainDepth: 0,
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CueFanInTracker — new inspection methods', () => {
	let dispatch: ReturnType<typeof vi.fn>;
	let onLog: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		dispatch = vi.fn();
		onLog = vi.fn();
		vi.useFakeTimers();
	});

	function makeTracker() {
		return createCueFanInTracker({
			onLog,
			getSessions: () => [
				{ id: 'session-a', name: 'Agent A', toolType: 'claude-code', cwd: '/', projectRoot: '/' },
				{ id: 'session-b', name: 'Agent B', toolType: 'claude-code', cwd: '/', projectRoot: '/' },
			],
			dispatchSubscription: dispatch,
		});
	}

	describe('getActiveTrackerKeys', () => {
		it('returns empty array when no trackers are active', () => {
			const tracker = makeTracker();
			expect(tracker.getActiveTrackerKeys()).toEqual([]);
		});

		it('returns the key after the first completion arrives', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();

			tracker.handleCompletion(
				'owner-session',
				settings,
				sub,
				['session-a', 'session-b'],
				'session-a',
				'Agent A',
				makeCompletion()
			);

			expect(tracker.getActiveTrackerKeys()).toEqual(['owner-session:fan-in-sub']);
		});

		it('removes the key after all sources complete (fan-in fires)', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();
			const sources = ['session-a', 'session-b'];

			tracker.handleCompletion(
				'owner',
				settings,
				sub,
				sources,
				'session-a',
				'Agent A',
				makeCompletion()
			);
			tracker.handleCompletion(
				'owner',
				settings,
				sub,
				sources,
				'session-b',
				'Agent B',
				makeCompletion()
			);

			// Fan-in fired — no more active trackers
			expect(tracker.getActiveTrackerKeys()).toEqual([]);
		});
	});

	describe('getTrackerCreatedAt', () => {
		it('returns undefined for an unknown key', () => {
			const tracker = makeTracker();
			expect(tracker.getTrackerCreatedAt('nonexistent:key')).toBeUndefined();
		});

		it('returns the timestamp set when the first completion arrives', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();
			const before = Date.now();

			tracker.handleCompletion(
				'owner-session',
				settings,
				sub,
				['session-a', 'session-b'],
				'session-a',
				'Agent A',
				makeCompletion()
			);

			const createdAt = tracker.getTrackerCreatedAt('owner-session:fan-in-sub');
			expect(createdAt).toBeGreaterThanOrEqual(before);
			expect(createdAt).toBeLessThanOrEqual(Date.now());
		});
	});

	describe('expireTracker', () => {
		it('removes the tracker and its timer without dispatching', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();

			tracker.handleCompletion(
				'owner',
				settings,
				sub,
				['session-a', 'session-b'],
				'session-a',
				'Agent A',
				makeCompletion()
			);

			const key = 'owner:fan-in-sub';
			expect(tracker.getActiveTrackerKeys()).toContain(key);

			tracker.expireTracker(key);

			expect(tracker.getActiveTrackerKeys()).not.toContain(key);
			expect(tracker.getTrackerCreatedAt(key)).toBeUndefined();
			expect(dispatch).not.toHaveBeenCalled();
		});

		it('is a no-op for an unknown key', () => {
			const tracker = makeTracker();
			expect(() => tracker.expireTracker('nonexistent:key')).not.toThrow();
		});
	});

	describe('clearForSession — cleans up fanInCreatedAt', () => {
		it('removes createdAt entry when the owning session is cleared', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();

			tracker.handleCompletion(
				'owner',
				settings,
				sub,
				['session-a', 'session-b'],
				'session-a',
				'Agent A',
				makeCompletion()
			);

			expect(tracker.getTrackerCreatedAt('owner:fan-in-sub')).toBeDefined();

			tracker.clearForSession('owner');

			expect(tracker.getTrackerCreatedAt('owner:fan-in-sub')).toBeUndefined();
			expect(tracker.getActiveTrackerKeys()).toEqual([]);
		});
	});

	describe('reset — clears all fanInCreatedAt entries', () => {
		it('removes all createdAt entries on reset', () => {
			const tracker = makeTracker();
			const sub = makeSub();
			const settings = makeSettings();

			tracker.handleCompletion(
				'owner',
				settings,
				sub,
				['session-a', 'session-b'],
				'session-a',
				'Agent A',
				makeCompletion()
			);

			expect(tracker.getActiveTrackerKeys()).toHaveLength(1);

			tracker.reset();

			expect(tracker.getActiveTrackerKeys()).toEqual([]);
			expect(tracker.getTrackerCreatedAt('owner:fan-in-sub')).toBeUndefined();
		});
	});
});
