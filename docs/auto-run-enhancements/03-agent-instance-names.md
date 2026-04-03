# Doc 3: Agent Instance Names in Charts (B1)

## Goal

Replace generic agent type labels (e.g., "claude-code") with actual session instance names (e.g., "My Project", "Backend API") across all dashboard charts. This makes charts immediately meaningful by showing which specific agent contributed what data.

## Files to Modify

1. `src/renderer/components/UsageDashboard/AgentUsageChart.tsx` — Already has partial name mapping; extend and clean up
2. `src/renderer/components/UsageDashboard/AgentComparisonChart.tsx` — Replace agentType keys with session names
3. `src/renderer/components/UsageDashboard/AgentEfficiencyChart.tsx` — Replace agentType keys with session names
4. `src/renderer/components/UsageDashboard/SessionStats.tsx` — Show session names instead of types
5. `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` — Pass sessions prop to child charts

## Prerequisites

- The `StatsAggregation` type has `byAgent: Record<string, { count: number; duration: number }>` where keys are `agentType` strings.
- It also has `bySessionByDay: Record<string, Array<{ date: string; count: number; duration: number }>>` where keys are `sessionId` strings.
- `AgentUsageChart.tsx` already maps sessionIds to session names for its top-10 chart — this pattern needs to be extended to all charts.

## Implementation Steps

### Step 1: Create Shared Name Resolution Utility

Create a utility function that can be shared across all chart components. Add it near the chart components or in a shared utils file:

**File**: `src/renderer/components/UsageDashboard/chartUtils.ts` (new file, or add to existing utils)

```tsx
import type { Session } from '../../types';

/**
 * Resolves a sessionId or agentType key to a human-readable display name.
 * Prioritizes session instance name, falls back to agent type, then the raw key.
 */
export function resolveAgentDisplayName(
	key: string,
	sessions: Session[]
): { name: string; isWorktree: boolean } {
	// Try to find a matching session by ID
	const session = sessions.find((s) => s.id === key);
	if (session) {
		return {
			name: session.name || session.toolType || key,
			isWorktree: !!session.parentSessionId,
		};
	}

	// Try to find by matching agentType — pick the first session of that type
	// and use its name, or just use the type as-is
	const byType = sessions.find((s) => s.toolType === key);
	if (byType) {
		return {
			name: byType.name || key,
			isWorktree: !!byType.parentSessionId,
		};
	}

	// Fallback: prettify the key
	return {
		name: prettifyAgentType(key),
		isWorktree: false,
	};
}

/**
 * Creates a lookup map from sessionId/agentType to display name.
 * Use this when you need to resolve many keys at once.
 */
export function buildNameMap(
	keys: string[],
	sessions: Session[]
): Map<string, { name: string; isWorktree: boolean }> {
	const map = new Map();
	for (const key of keys) {
		map.set(key, resolveAgentDisplayName(key, sessions));
	}
	return map;
}

/**
 * Prettifies raw agent type strings: "claude-code" -> "Claude Code"
 */
function prettifyAgentType(type: string): string {
	return type
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
```

### Step 2: Pass Sessions to Dashboard Charts

In `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`:

1. Find where the modal receives or accesses the list of sessions. It likely gets sessions from a context, store, or prop.
2. Pass `sessions` as a prop to each chart component that currently only receives `data` (StatsAggregation) and `theme`.

```tsx
// In UsageDashboardModal, where chart components are rendered:
<AgentUsageChart data={stats} theme={theme} sessions={sessions} colorBlindMode={colorBlindMode} />
<AgentComparisonChart data={stats} theme={theme} sessions={sessions} colorBlindMode={colorBlindMode} />
<AgentEfficiencyChart data={stats} theme={theme} sessions={sessions} colorBlindMode={colorBlindMode} />
<SessionStats data={stats} theme={theme} sessions={sessions} />
```

If sessions aren't available in the modal, you'll need to:

- Import the session store/context (check how SessionItem gets its sessions)
- Or pass sessions down from the parent component that renders UsageDashboardModal

### Step 3: Update AgentComparisonChart.tsx

In `src/renderer/components/UsageDashboard/AgentComparisonChart.tsx`:

1. Add `sessions: Session[]` to the component props interface.
2. Find where `data.byAgent` keys are used as chart labels.
3. Replace raw keys with resolved names:

```tsx
// Before: using agentType directly
const chartData = Object.entries(data.byAgent).map(([agentType, stats]) => ({
	name: agentType,
	count: stats.count,
	duration: stats.duration,
}));

// After: resolve to display names
const nameMap = buildNameMap(Object.keys(data.byAgent), sessions);
const chartData = Object.entries(data.byAgent).map(([key, stats]) => {
	const resolved = nameMap.get(key)!;
	return {
		name: resolved.name,
		count: stats.count,
		duration: stats.duration,
		isWorktree: resolved.isWorktree,
	};
});
```

### Step 4: Update AgentEfficiencyChart.tsx

Same pattern as AgentComparisonChart:

1. Add `sessions: Session[]` to props.
2. Use `buildNameMap()` to resolve agent keys to display names.
3. Replace all references to raw agent type strings in labels and tooltips.

### Step 5: Update SessionStats.tsx

In `src/renderer/components/UsageDashboard/SessionStats.tsx`:

1. Add `sessions: Session[]` to props.
2. Find where `data.sessionsByAgent` or `data.byAgent` keys are displayed.
3. Resolve to display names using `resolveAgentDisplayName()`.

### Step 6: Clean Up AgentUsageChart.tsx

`AgentUsageChart.tsx` already has its own name resolution logic. Refactor it to use the shared `chartUtils.ts`:

1. Remove the inline name mapping logic.
2. Import and use `buildNameMap()` from `chartUtils.ts`.
3. This ensures consistent name resolution across all charts.

### Step 7: Handle Name Collisions

Multiple sessions can have the same name. If two sessions are both named "My Project":

```tsx
// In buildNameMap, detect duplicates and append a disambiguator
const nameCounts = new Map<string, number>();
for (const [key, resolved] of map) {
	const count = nameCounts.get(resolved.name) || 0;
	nameCounts.set(resolved.name, count + 1);
	if (count > 0) {
		resolved.name = `${resolved.name} (${count + 1})`;
	}
}
```

## Validation Checklist

- [ ] AgentComparisonChart shows session names (e.g., "Backend API") instead of type labels ("claude-code")
- [ ] AgentEfficiencyChart shows session names
- [ ] AgentUsageChart continues to show session names (already working, now using shared utility)
- [ ] SessionStats shows session names where applicable
- [ ] Worktree agents are distinguishable (from Doc 1 work) in chart labels
- [ ] Name collisions are handled gracefully (disambiguated)
- [ ] Charts with no matching session data fall back to prettified type names
- [ ] Tooltips in charts show the resolved names
- [ ] No TypeScript errors after adding `sessions` prop to all chart components
- [ ] Chart legends update correctly with the new names
- [ ] Performance is acceptable (name resolution is O(n) and memoized per render)
