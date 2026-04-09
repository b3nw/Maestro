import type { MainLogLevel } from '../../shared/logger-types';
import type { SessionInfo } from '../../shared/types';
import { describeFilter, matchesFilter } from './cue-filter';
import { loadCueConfigDetailed, watchCueYaml } from './cue-yaml-loader';
import {
	setupFileWatcherSubscription,
	setupGitHubPollerSubscription,
	setupHeartbeatSubscription,
	setupScheduledSubscription,
	setupTaskScannerSubscription,
	type SubscriptionSetupDeps,
} from './cue-subscription-setup';
import { createCueEvent, type CueEvent, type CueSubscription } from './cue-types';
import {
	countActiveSubscriptions,
	hasTimeBasedSubscriptions,
	type SessionState,
} from './cue-session-state';
import type { CueSessionRegistry } from './cue-session-registry';

/**
 * Why a session is being initialized. Used to gate `app.startup` triggers,
 * which must fire exactly once per Electron process lifecycle and only when
 * the engine is starting because of a real system boot.
 *
 * - `system-boot`: Electron just launched. app.startup subscriptions fire.
 * - `user-toggle`: User flipped the Cue toggle off and back on. Do NOT fire
 *   app.startup again — that would surprise users who expect toggling to be
 *   idempotent.
 * - `refresh`: A YAML hot-reload re-initialized the session. app.startup
 *   already fired (or didn't) on this process; do not re-fire.
 * - `discovery`: Auto-discovery added a new session after boot. The startup
 *   moment for that session has already passed, so do not fire.
 */
export type SessionInitReason = 'system-boot' | 'user-toggle' | 'refresh' | 'discovery';

export interface InitSessionOptions {
	reason: SessionInitReason;
}

export interface CueSessionRuntimeServiceDeps {
	enabled: () => boolean;
	getSessions: () => SessionInfo[];
	onRefreshRequested: (sessionId: string, projectRoot: string) => void;
	onLog: (level: MainLogLevel, message: string, data?: unknown) => void;
	onPreventSleep?: (reason: string) => void;
	onAllowSleep?: (reason: string) => void;
	registry: CueSessionRegistry;
	executeCueRun: (
		sessionId: string,
		prompt: string,
		event: CueEvent,
		subscriptionName: string,
		outputPrompt?: string,
		chainDepth?: number
	) => void;
	dispatchSubscription: (
		ownerSessionId: string,
		sub: CueSubscription,
		event: CueEvent,
		sourceSessionName: string,
		chainDepth?: number
	) => void;
	clearQueue: (sessionId: string, preserveStartup?: boolean) => void;
	clearFanInState: (sessionId: string) => void;
}

export interface CueSessionRuntimeService {
	initSession(session: SessionInfo, opts: InitSessionOptions): void;
	refreshSession(
		sessionId: string,
		projectRoot: string
	): {
		reloaded: boolean;
		configRemoved: boolean;
		sessionName?: string;
		activeCount?: number;
	};
	removeSession(sessionId: string): void;
	teardownSession(sessionId: string): void;
	clearAll(): void;
}

export function createCueSessionRuntimeService(
	deps: CueSessionRuntimeServiceDeps
): CueSessionRuntimeService {
	const { registry } = deps;
	const pendingYamlWatchers = new Map<string, () => void>();

	function getSession(sessionId: string): SessionInfo | undefined {
		return deps.getSessions().find((session) => session.id === sessionId);
	}

	function initSession(session: SessionInfo, opts: InitSessionOptions): void {
		if (!deps.enabled()) return;

		const loadResult = loadCueConfigDetailed(session.projectRoot);
		if (!loadResult.ok) {
			// Distinguish missing (silent) from parse / validation failures (loud).
			if (loadResult.reason === 'parse-error') {
				deps.onLog(
					'error',
					`[CUE] Failed to parse cue.yaml for "${session.name}": ${loadResult.message}`
				);
			} else if (loadResult.reason === 'invalid') {
				deps.onLog(
					'error',
					`[CUE] cue.yaml for "${session.name}" is invalid:\n  - ${loadResult.errors.join('\n  - ')}`
				);
			}

			if (!pendingYamlWatchers.has(session.id)) {
				const yamlWatcher = watchCueYaml(session.projectRoot, () => {
					deps.onRefreshRequested(session.id, session.projectRoot);
				});
				pendingYamlWatchers.set(session.id, yamlWatcher);
			}
			return;
		}

		const config = loadResult.config;

		// Surface non-fatal materialization warnings (e.g. unresolved prompt_file)
		for (const warning of loadResult.warnings) {
			deps.onLog('warn', `[CUE] ${warning}`);
		}

		const state: SessionState = {
			config,
			timers: [],
			watchers: [],
			yamlWatcher: null,
			sleepPrevented: false,
			nextTriggers: new Map(),
		};

		state.yamlWatcher = watchCueYaml(session.projectRoot, () => {
			deps.onRefreshRequested(session.id, session.projectRoot);
		});

		const setupDeps: SubscriptionSetupDeps = {
			enabled: deps.enabled,
			registry,
			onLog: deps.onLog,
			dispatchSubscription: deps.dispatchSubscription,
			executeCueRun: deps.executeCueRun,
		};

		for (const sub of config.subscriptions) {
			if (sub.enabled === false) continue;
			if (sub.agent_id && sub.agent_id !== session.id) continue;

			if (sub.event === 'time.heartbeat' && sub.interval_minutes) {
				setupHeartbeatSubscription(setupDeps, session, state, sub);
			} else if (sub.event === 'time.scheduled' && sub.schedule_times?.length) {
				setupScheduledSubscription(setupDeps, session, state, sub);
			} else if (sub.event === 'file.changed' && sub.watch) {
				setupFileWatcherSubscription(setupDeps, session, state, sub);
			} else if (sub.event === 'task.pending' && sub.watch) {
				setupTaskScannerSubscription(setupDeps, session, state, sub);
			} else if (sub.event === 'github.pull_request' || sub.event === 'github.issue') {
				setupGitHubPollerSubscription(setupDeps, session, state, sub);
			}
		}

		// app.startup subscriptions fire exactly once per process lifecycle, and
		// only when the engine is starting because of a real system boot. Toggling
		// Cue off/on or hot-reloading a YAML must NOT re-fire startup events.
		if (opts.reason === 'system-boot') {
			for (const sub of config.subscriptions) {
				if (sub.enabled === false) continue;
				if (sub.agent_id && sub.agent_id !== session.id) continue;
				if (sub.event !== 'app.startup') continue;

				if (!registry.markStartupFired(session.id, sub.name)) continue;

				const event = createCueEvent('app.startup', sub.name, {
					reason: 'system_startup',
				});

				if (sub.filter && !matchesFilter(event.payload, sub.filter)) {
					deps.onLog(
						'cue',
						`[CUE] "${sub.name}" filter not matched (${describeFilter(sub.filter)})`
					);
					continue;
				}

				deps.onLog('cue', `[CUE] "${sub.name}" triggered (app.startup)`);
				state.lastTriggered = event.timestamp;
				deps.dispatchSubscription(session.id, sub, event, session.name);
			}
		}

		registry.register(session.id, state);

		state.sleepPrevented = hasTimeBasedSubscriptions(config, session.id);
		if (state.sleepPrevented) {
			deps.onPreventSleep?.(`cue:schedule:${session.id}`);
		}

		deps.onLog(
			'cue',
			`[CUE] Initialized session "${session.name}" with ${countActiveSubscriptions(config.subscriptions, session.id)} active subscription(s)`
		);
	}

	function teardownSession(sessionId: string): void {
		const state = registry.get(sessionId);
		if (!state) return;

		if (state.sleepPrevented) {
			deps.onAllowSleep?.(`cue:schedule:${sessionId}`);
		}

		for (const timer of state.timers) {
			clearInterval(timer);
		}
		for (const cleanup of state.watchers) {
			cleanup();
		}
		if (state.yamlWatcher) {
			state.yamlWatcher();
		}

		deps.clearFanInState(sessionId);
		deps.clearQueue(sessionId, true);

		// Drop time.scheduled dedup keys for this session — they only matter while
		// the session is initialized. Startup keys are NOT cleared here so that a
		// refresh inside the same process lifecycle does not re-fire app.startup.
		registry.clearScheduledForSession(sessionId);
	}

	function refreshSession(
		sessionId: string,
		projectRoot: string
	): { reloaded: boolean; configRemoved: boolean; sessionName?: string; activeCount?: number } {
		const hadSession = registry.has(sessionId);
		teardownSession(sessionId);
		registry.unregister(sessionId);

		const pendingWatcher = pendingYamlWatchers.get(sessionId);
		if (pendingWatcher) {
			pendingWatcher();
			pendingYamlWatchers.delete(sessionId);
		}

		const session = getSession(sessionId);
		if (!session) {
			return { reloaded: false, configRemoved: false };
		}

		initSession({ ...session, projectRoot }, { reason: 'refresh' });
		const newState = registry.get(sessionId);
		if (newState) {
			const activeCount = countActiveSubscriptions(newState.config.subscriptions, sessionId);
			return {
				reloaded: true,
				configRemoved: false,
				sessionName: session.name,
				activeCount,
			};
		}

		if (hadSession) {
			if (!pendingYamlWatchers.has(sessionId)) {
				const yamlWatcher = watchCueYaml(projectRoot, () => {
					deps.onRefreshRequested(sessionId, projectRoot);
				});
				pendingYamlWatchers.set(sessionId, yamlWatcher);
			}
			return {
				reloaded: false,
				configRemoved: true,
				sessionName: session.name,
			};
		}

		return { reloaded: false, configRemoved: false, sessionName: session.name };
	}

	function removeSessionInternal(sessionId: string): void {
		teardownSession(sessionId);
		registry.unregister(sessionId);
		deps.clearQueue(sessionId);
		// Removing a session means its app.startup history is no longer relevant —
		// if the same session id is re-added later (rare), we want startup to fire.
		registry.clearStartupForSession(sessionId);

		const pendingWatcher = pendingYamlWatchers.get(sessionId);
		if (pendingWatcher) {
			pendingWatcher();
			pendingYamlWatchers.delete(sessionId);
		}
	}

	return {
		initSession,
		refreshSession,

		removeSession(sessionId: string): void {
			removeSessionInternal(sessionId);
			deps.onLog('cue', `[CUE] Session removed: ${sessionId}`);
		},

		teardownSession,

		clearAll(): void {
			for (const [sessionId] of registry.snapshot()) {
				teardownSession(sessionId);
			}
			// Drop session state and time.scheduled keys; preserve startup keys
			// so toggling Cue off/on does not re-fire app.startup subscriptions.
			registry.clear();

			for (const [, cleanup] of pendingYamlWatchers) {
				cleanup();
			}
			pendingYamlWatchers.clear();
		},
	};
}
