# Doc 9: Interactive Chart Drill-Down (B3)

## Goal

Add a filter state layer to the dashboard so that clicking on any agent in any chart filters all other charts to show only that agent's data. This makes the dashboard explorable and lets users focus on a specific agent's activity across all visualizations.

## Files to Modify

1. `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` — Add filter state management
2. `src/renderer/components/UsageDashboard/AgentUsageChart.tsx` — Add click handler, respect filter
3. `src/renderer/components/UsageDashboard/AgentComparisonChart.tsx` — Add click handler, respect filter
4. `src/renderer/components/UsageDashboard/AgentEfficiencyChart.tsx` — Respect filter
5. `src/renderer/components/UsageDashboard/SummaryCards.tsx` — Show filtered totals when filter active
6. `src/renderer/components/UsageDashboard/ActivityHeatmap.tsx` — Respect filter
7. `src/renderer/components/UsageDashboard/DurationTrendsChart.tsx` — Respect filter
8. All other chart components in the dashboard — Respect filter

## Implementation Steps

### Step 1: Filter State in Dashboard Modal

In `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`, add a filter state:

```tsx
interface DashboardFilter {
	type: 'agent' | 'session';
	key: string; // sessionId or agentType
	displayName: string; // Human-readable name for the filter bar
}

function UsageDashboardModal(
	{
		/* existing props */
	}
) {
	const [filter, setFilter] = useState<DashboardFilter | null>(null);

	const handleFilterByAgent = useCallback((key: string, displayName: string) => {
		setFilter((prev) => (prev?.key === key ? null : { type: 'session', key, displayName }));
	}, []);

	const clearFilter = useCallback(() => setFilter(null), []);

	// Compute filtered stats
	const filteredStats = useMemo(() => {
		if (!filter || !stats) return stats;
		return filterStatsForAgent(stats, filter.key);
	}, [stats, filter]);

	// ... rest of component
}
```

### Step 2: Stats Filtering Utility

Create a utility to filter StatsAggregation to a single agent:

```tsx
function filterStatsForAgent(stats: StatsAggregation, agentKey: string): StatsAggregation {
	// Filter byAgent to just the selected agent
	const filteredByAgent: Record<string, { count: number; duration: number }> = {};
	if (stats.byAgent[agentKey]) {
		filteredByAgent[agentKey] = stats.byAgent[agentKey];
	}

	// Filter byAgentByDay
	const filteredByAgentByDay: Record<
		string,
		Array<{ date: string; count: number; duration: number }>
	> = {};
	if (stats.byAgentByDay[agentKey]) {
		filteredByAgentByDay[agentKey] = stats.byAgentByDay[agentKey];
	}

	// Filter bySessionByDay
	const filteredBySessionByDay: Record<
		string,
		Array<{ date: string; count: number; duration: number }>
	> = {};
	if (stats.bySessionByDay[agentKey]) {
		filteredBySessionByDay[agentKey] = stats.bySessionByDay[agentKey];
	}

	// Recalculate totals from the filtered agent data
	const agentData = filteredByAgent[agentKey] || { count: 0, duration: 0 };

	// Recalculate byDay from byAgentByDay or bySessionByDay
	const dailyData = filteredByAgentByDay[agentKey] || filteredBySessionByDay[agentKey] || [];

	return {
		...stats,
		totalQueries: agentData.count,
		totalDuration: agentData.duration,
		avgDuration: agentData.count > 0 ? agentData.duration / agentData.count : 0,
		byAgent: filteredByAgent,
		byDay: dailyData,
		byAgentByDay: filteredByAgentByDay,
		bySessionByDay: filteredBySessionByDay,
		// Note: bySource, byLocation, byHour may not be filterable without server-side support
		// Leave them as-is (showing global data) or hide those charts when filtered
	};
}
```

### Step 3: Filter Bar UI

Add a persistent filter indicator bar at the top of the dashboard when a filter is active:

```tsx
{
	/* Filter indicator bar */
}
{
	filter && (
		<div
			className="flex items-center justify-between px-4 py-2 rounded-lg mb-3"
			style={{
				backgroundColor: theme.colors.accent + '15',
				border: `1px solid ${theme.colors.accent}30`,
			}}
		>
			<div className="flex items-center gap-2">
				<Filter size={14} style={{ color: theme.colors.accent }} />
				<span className="text-xs" style={{ color: theme.colors.textMain }}>
					Filtered to:{' '}
					<span className="font-medium" style={{ color: theme.colors.accent }}>
						{filter.displayName}
					</span>
				</span>
			</div>
			<button
				onClick={clearFilter}
				className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
				style={{
					backgroundColor: theme.colors.accent + '20',
					color: theme.colors.accent,
				}}
			>
				<X size={12} />
				Clear
			</button>
		</div>
	);
}
```

Import `Filter` and `X` from lucide-react.

### Step 4: Make Charts Clickable

Update each chart component to accept `onAgentClick` and `activeFilter` props:

```tsx
interface ChartProps {
	data: StatsAggregation;
	theme: Theme;
	sessions: Session[];
	colorBlindMode?: boolean;
	// NEW:
	onAgentClick?: (key: string, displayName: string) => void;
	activeFilterKey?: string | null;
}
```

**AgentComparisonChart.tsx** — Add click handler to bar elements:

```tsx
// In the Recharts BarChart, add onClick to each Bar:
<Bar
	dataKey="count"
	onClick={(data) => {
		if (onAgentClick && data?.payload?.key) {
			onAgentClick(data.payload.key, data.payload.name);
		}
	}}
	cursor="pointer"
>
	{chartData.map((entry, index) => (
		<Cell
			key={entry.key}
			fill={getAgentColor(index, theme, colorBlindMode)}
			opacity={activeFilterKey && activeFilterKey !== entry.key ? 0.3 : 1}
			stroke={activeFilterKey === entry.key ? theme.colors.accent : 'none'}
			strokeWidth={activeFilterKey === entry.key ? 2 : 0}
		/>
	))}
</Bar>
```

**AgentUsageChart.tsx** — Add click handler to line legend or data points:

```tsx
// Make the legend items clickable:
<div
	key={agentKey}
	onClick={() => onAgentClick?.(agentKey, displayName)}
	className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity px-2 py-1 rounded"
	style={{
		backgroundColor: activeFilterKey === agentKey ? theme.colors.accent + '20' : 'transparent',
	}}
>
	<span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
	<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
		{displayName}
	</span>
</div>
```

Also dim non-selected lines:

```tsx
<Line
	key={agentKey}
	dataKey={agentKey}
	stroke={color}
	strokeOpacity={activeFilterKey && activeFilterKey !== agentKey ? 0.15 : 1}
	strokeWidth={activeFilterKey === agentKey ? 2.5 : 1.5}
/>
```

### Step 5: Pass Filter Props to All Charts

In `UsageDashboardModal.tsx`, pass the filter state and handler to every chart:

```tsx
<AgentComparisonChart
  data={filteredStats}
  theme={theme}
  sessions={sessions}
  colorBlindMode={colorBlindMode}
  onAgentClick={handleFilterByAgent}
  activeFilterKey={filter?.key || null}
/>

<AgentUsageChart
  data={filteredStats}
  theme={theme}
  sessions={sessions}
  colorBlindMode={colorBlindMode}
  onAgentClick={handleFilterByAgent}
  activeFilterKey={filter?.key || null}
/>

<AgentEfficiencyChart
  data={filteredStats}
  theme={theme}
  sessions={sessions}
  colorBlindMode={colorBlindMode}
  activeFilterKey={filter?.key || null}
/>

<SummaryCards
  data={filteredStats}
  theme={theme}
  sessions={sessions}
/>
```

### Step 6: Charts Without Agent Breakdown

Some charts (ActivityHeatmap, PeakHoursChart, WeekdayComparisonChart) show aggregate data (byHour, byDay) without per-agent breakdown. For these:

**Option A (simple)**: Hide them when filter is active and note "Agent-level hourly data not available"

**Option B (better, needs backend)**: Add per-agent hourly breakdowns to StatsAggregation and create filtered queries server-side.

For now, go with Option A:

```tsx
{
	!filter && <ActivityHeatmap data={stats} theme={theme} />;
}
{
	filter && (
		<div className="text-xs text-center py-6" style={{ color: theme.colors.textDim }}>
			Hourly breakdown not available for individual agents.{' '}
			<button onClick={clearFilter} className="underline" style={{ color: theme.colors.accent }}>
				Clear filter
			</button>{' '}
			to see all data.
		</div>
	);
}
```

### Step 7: Visual Feedback on Clickable Elements

Add cursor and hover styles to make it clear that chart elements are clickable:

```css
/* In global CSS or inline */
.chart-clickable {
	cursor: pointer;
	transition: opacity 0.15s ease;
}
.chart-clickable:hover {
	opacity: 0.8;
}
```

### Step 8: Keyboard Shortcut to Clear Filter

Add Escape key handler to clear the filter:

```tsx
useEffect(() => {
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && filter) {
			clearFilter();
		}
	};
	window.addEventListener('keydown', handleKeyDown);
	return () => window.removeEventListener('keydown', handleKeyDown);
}, [filter, clearFilter]);
```

## Validation Checklist

- [ ] Clicking a bar in AgentComparisonChart filters all charts to that agent
- [ ] Clicking the same bar again clears the filter (toggle behavior)
- [ ] Clicking a legend item in AgentUsageChart filters to that agent
- [ ] Filter bar appears at the top showing "Filtered to: [Agent Name]"
- [ ] "Clear" button in filter bar removes the filter
- [ ] Pressing Escape clears the filter
- [ ] Non-selected agents are dimmed (30% opacity) in all charts when filter is active
- [ ] Selected agent is highlighted (thicker stroke, accent border)
- [ ] Summary cards update to show filtered totals
- [ ] Charts without per-agent data show appropriate message when filtered
- [ ] Agent Overview Cards (from Doc 6) highlight the selected agent
- [ ] Filter state resets when time range changes
- [ ] Filter state resets when switching dashboard tabs
- [ ] No TypeScript errors
- [ ] Chart interactivity is smooth (no lag on click)
- [ ] Cursor changes to pointer on clickable chart elements
