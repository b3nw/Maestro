# Doc 5: Real-time Metrics Cards (B2)

## Goal

Add compact, information-dense metrics cards showing token count, estimated cost, context window usage bar with threshold coloring (green <70%, yellow 70-90%, red >=90%), and elapsed time. These provide at-a-glance operational awareness directly in the dashboard.

## Files to Modify

1. `src/renderer/components/UsageDashboard/SummaryCards.tsx` — Add new metrics cards
2. `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` — Pass session/real-time data to cards
3. `src/renderer/hooks/stats/useStats.ts` — Ensure real-time subscription provides needed data

## Prerequisites

- Sessions have `contextWindow` data (check the Session type for context usage fields)
- Stats subscription provides real-time updates via `window.maestro.stats.onStatsUpdate()`
- Cost data may need to be derived from token counts and model pricing

## Implementation Steps

### Step 1: Identify Available Real-time Data

Before implementing, read the Session type and stats types to confirm what real-time data is available. Look for:

- `session.contextWindow` or similar — context usage percentage
- Token counts (input/output) — may be on individual query events or aggregated
- Cost calculation — may need to compute from tokens (check if a cost utility exists)
- Session elapsed time — can derive from session creation time

Check `src/renderer/types/index.ts` (Session interface) and `src/shared/stats-types.ts` for these fields.

### Step 2: Context Usage Bar Component

Create a context usage progress bar with threshold coloring:

```tsx
interface ContextUsageBarProps {
	used: number; // Current context tokens used
	total: number; // Max context window size
	theme: Theme;
}

function ContextUsageBar({ used, total, theme }: ContextUsageBarProps) {
	const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;

	const getBarColor = () => {
		if (percentage >= 90) return theme.colors.error; // Red
		if (percentage >= 70) return theme.colors.warning; // Yellow/Orange
		return theme.colors.success; // Green
	};

	return (
		<div className="w-full">
			<div className="flex items-center justify-between mb-1">
				<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
					Context
				</span>
				<span className="text-[10px] font-medium" style={{ color: getBarColor() }}>
					{percentage.toFixed(0)}%
				</span>
			</div>
			<div
				className="w-full h-1.5 rounded-full overflow-hidden"
				style={{ backgroundColor: theme.colors.bgMain }}
			>
				<div
					className="h-full rounded-full transition-all duration-500 ease-out"
					style={{
						width: `${percentage}%`,
						backgroundColor: getBarColor(),
						boxShadow: percentage >= 90 ? `0 0 6px ${theme.colors.error}60` : 'none',
					}}
				/>
			</div>
		</div>
	);
}
```

### Step 3: Token/Cost Badge Component

```tsx
interface TokenCostBadgeProps {
	inputTokens: number;
	outputTokens: number;
	theme: Theme;
}

function TokenCostBadge({ inputTokens, outputTokens, theme }: TokenCostBadgeProps) {
	const totalTokens = inputTokens + outputTokens;

	// Estimate cost (adjust rates based on actual model pricing)
	// These are placeholder rates — update based on the model used
	const estimatedCost = (inputTokens * 0.003 + outputTokens * 0.015) / 1000;

	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return n.toString();
	};

	return (
		<div className="flex items-center gap-3">
			<div>
				<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
					Tokens
				</div>
				<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					{formatTokens(totalTokens)}
				</div>
				<div className="text-[9px]" style={{ color: theme.colors.textDim }}>
					{formatTokens(inputTokens)} in / {formatTokens(outputTokens)} out
				</div>
			</div>
			<div>
				<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
					Est. Cost
				</div>
				<div className="text-sm font-medium" style={{ color: theme.colors.warning }}>
					${estimatedCost.toFixed(2)}
				</div>
			</div>
		</div>
	);
}
```

### Step 4: Real-time Metrics Card

Combine the above into a compact card for the dashboard:

```tsx
interface RealtimeMetricsCardProps {
	sessions: Session[];
	theme: Theme;
	animationDelay?: number;
}

function RealtimeMetricsCard({ sessions, theme, animationDelay = 0 }: RealtimeMetricsCardProps) {
	// Aggregate across active sessions
	const activeSessions = sessions.filter((s) => s.state === 'busy' || s.state === 'idle');

	// Sum up token usage and context from active sessions
	// Note: adjust field names based on actual Session type
	const totalInputTokens = activeSessions.reduce((sum, s) => sum + (s.inputTokens || 0), 0);
	const totalOutputTokens = activeSessions.reduce((sum, s) => sum + (s.outputTokens || 0), 0);

	// Context usage — use the most-filled session as the representative
	const maxContextSession = activeSessions.reduce((max, s) => {
		const usage = (s.contextUsed || 0) / (s.contextTotal || 1);
		const maxUsage = (max.contextUsed || 0) / (max.contextTotal || 1);
		return usage > maxUsage ? s : max;
	}, activeSessions[0] || {});

	return (
		<div
			style={{
				backgroundColor: theme.colors.bgActivity,
				border: `1px solid ${theme.colors.border}`,
				borderRadius: '10px',
				padding: 'clamp(12px, 2vw, 16px)',
				animation: `card-enter 0.45s cubic-bezier(0.23, 1, 0.32, 1) ${animationDelay}ms both`,
			}}
		>
			<div
				className="text-xs uppercase tracking-wider mb-3"
				style={{ color: theme.colors.textDim }}
			>
				Real-time Metrics
			</div>

			<div className="space-y-3">
				<TokenCostBadge
					inputTokens={totalInputTokens}
					outputTokens={totalOutputTokens}
					theme={theme}
				/>

				{maxContextSession.contextTotal && (
					<ContextUsageBar
						used={maxContextSession.contextUsed || 0}
						total={maxContextSession.contextTotal}
						theme={theme}
					/>
				)}

				{/* Active session count */}
				<div
					className="flex items-center gap-2 text-[10px]"
					style={{ color: theme.colors.textDim }}
				>
					<span
						className="w-1.5 h-1.5 rounded-full"
						style={{ backgroundColor: theme.colors.success }}
					/>
					{activeSessions.length} active session{activeSessions.length !== 1 ? 's' : ''}
				</div>
			</div>
		</div>
	);
}
```

### Step 5: Integration with Dashboard

In `SummaryCards.tsx`, add the RealtimeMetricsCard alongside existing summary cards:

```tsx
// After the existing stat cards grid
<div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
	<RealtimeMetricsCard sessions={sessions} theme={theme} animationDelay={320} />
	{/* Placeholder for future cards */}
</div>
```

### Step 6: Real-time Update Subscription

In the dashboard modal or the stats hook, ensure the component re-renders when stats update:

```tsx
// In UsageDashboardModal or parent component:
useEffect(() => {
	const unsubscribe = window.maestro.stats.onStatsUpdate(() => {
		// Trigger re-fetch or re-render
		refreshStats();
	});
	return unsubscribe;
}, []);
```

## Validation Checklist

- [ ] Context usage bar renders with correct coloring: green (<70%), yellow (70-90%), red (>=90%)
- [ ] Context bar percentage updates as sessions use more context
- [ ] Token counts display in human-readable format (K/M suffixes)
- [ ] Input/output token split is shown
- [ ] Cost estimate is displayed (even if approximate)
- [ ] Active session count is accurate
- [ ] Card animates in with the staggered entrance from Doc 4
- [ ] Bar has smooth transition animation when value changes
- [ ] Red threshold context bar has subtle glow effect
- [ ] Works in both dark and light themes
- [ ] No TypeScript errors
- [ ] Dashboard doesn't re-render excessively (debounced updates)
