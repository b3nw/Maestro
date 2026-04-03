# Doc 6: Sparklines + Agent Overview Cards (B5+D1)

## Goal

Add mini sparkline trend charts inside summary cards showing 7-day activity trends, and create a new "Agent Overview" section at the top of the dashboard with one card per active agent showing name, status dot, current branch, last activity sparkline, and cost.

## Files to Modify

1. `src/renderer/components/UsageDashboard/SummaryCards.tsx` — Add sparklines to existing stat cards
2. `src/renderer/components/UsageDashboard/AgentOverviewCards.tsx` — New component for per-agent overview
3. `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` — Add AgentOverviewCards section

## Implementation Steps

### Step 1: Sparkline Component

Create a lightweight SVG sparkline component:

```tsx
interface SparklineProps {
	data: number[]; // Array of values (e.g., daily counts for 7 days)
	width?: number;
	height?: number;
	color: string;
	fillOpacity?: number; // 0 for line-only, 0.1-0.3 for area fill
}

function Sparkline({ data, width = 80, height = 24, color, fillOpacity = 0.15 }: SparklineProps) {
	if (!data.length || data.every((d) => d === 0)) {
		// Empty state: flat line
		return (
			<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
				<line
					x1={0}
					y1={height / 2}
					x2={width}
					y2={height / 2}
					stroke={color}
					strokeWidth={1}
					strokeOpacity={0.3}
					strokeDasharray="2 2"
				/>
			</svg>
		);
	}

	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max - min || 1;
	const padding = 2;
	const usableHeight = height - padding * 2;
	const stepX = width / (data.length - 1 || 1);

	const points = data.map((value, i) => ({
		x: i * stepX,
		y: padding + usableHeight - ((value - min) / range) * usableHeight,
	}));

	const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

	// Area fill path (line path + close to bottom)
	const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
			{/* Gradient fill */}
			{fillOpacity > 0 && <path d={areaPath} fill={color} opacity={fillOpacity} />}
			{/* Line */}
			<path
				d={linePath}
				fill="none"
				stroke={color}
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{/* End dot */}
			<circle
				cx={points[points.length - 1].x}
				cy={points[points.length - 1].y}
				r={2}
				fill={color}
			/>
		</svg>
	);
}
```

### Step 2: Add Sparklines to Summary Cards

In `SummaryCards.tsx`, add sparklines to each stat card using the `byDay` data from `StatsAggregation`:

```tsx
// Extract last 7 days of data for sparklines
function getLast7Days(byDay: Array<{ date: string; count: number; duration: number }>): number[] {
	const last7 = byDay.slice(-7);
	// Pad with zeros if less than 7 days
	while (last7.length < 7) {
		last7.unshift({ date: '', count: 0, duration: 0 });
	}
	return last7.map((d) => d.count);
}

function getLast7DaysDuration(
	byDay: Array<{ date: string; count: number; duration: number }>
): number[] {
	const last7 = byDay.slice(-7);
	while (last7.length < 7) {
		last7.unshift({ date: '', count: 0, duration: 0 });
	}
	return last7.map((d) => d.duration);
}
```

Then in each StatCard, place the sparkline in the bottom-right corner:

```tsx
<StatCard
	icon={<BarChart3 size={16} />}
	value={data.totalQueries}
	label="Total Queries"
	variant="elevated"
	theme={theme}
	animationDelay={0}
	sparklineData={getLast7Days(data.byDay)}
	sparklineColor={theme.colors.accent}
/>
```

Update the StatCard component to accept and render the sparkline:

```tsx
// Inside StatCard, add to bottom-right:
{
	sparklineData && (
		<div className="absolute bottom-2 right-2 opacity-60">
			<Sparkline
				data={sparklineData}
				color={sparklineColor || theme.colors.accent}
				width={60}
				height={20}
			/>
		</div>
	);
}
```

Make the card container `relative` to position the sparkline absolutely.

### Step 3: Agent Overview Cards Component

Create a new component `AgentOverviewCards.tsx`:

**File**: `src/renderer/components/UsageDashboard/AgentOverviewCards.tsx`

```tsx
import React from 'react';
import type { Theme } from '../../../shared/theme-types';
import type { Session } from '../../types';
import type { StatsAggregation } from '../../../shared/stats-types';

interface AgentOverviewCardsProps {
	sessions: Session[];
	data: StatsAggregation;
	theme: Theme;
}

function AgentOverviewCards({ sessions, data, theme }: AgentOverviewCardsProps) {
	// Get active/recent sessions (filter out very old inactive ones)
	const relevantSessions = sessions.filter((s) => s.state !== 'closed' && s.state !== 'terminated');

	if (relevantSessions.length === 0) return null;

	return (
		<div>
			<h3 className="text-sm font-semibold mb-3" style={{ color: theme.colors.textMain }}>
				Active Agents
			</h3>
			<div
				className="grid gap-2"
				style={{
					gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))`,
				}}
			>
				{relevantSessions.map((session, index) => (
					<AgentCard
						key={session.id}
						session={session}
						data={data}
						theme={theme}
						animationDelay={index * 60}
					/>
				))}
			</div>
		</div>
	);
}

interface AgentCardProps {
	session: Session;
	data: StatsAggregation;
	theme: Theme;
	animationDelay: number;
}

function AgentCard({ session, data, theme, animationDelay }: AgentCardProps) {
	const isWorktree = !!session.parentSessionId;

	// Get this session's daily data for sparkline
	const sessionDailyData = data.bySessionByDay[session.id] || [];
	const sparkData = sessionDailyData.slice(-7).map((d) => d.count);
	while (sparkData.length < 7) sparkData.unshift(0);

	// Get session's total queries
	const sessionStats = data.byAgent[session.id] ||
		data.byAgent[session.toolType] || { count: 0, duration: 0 };

	// Status color
	const statusColor =
		session.state === 'busy'
			? theme.colors.warning
			: session.state === 'error'
				? theme.colors.error
				: session.state === 'idle'
					? theme.colors.success
					: theme.colors.textDim;

	return (
		<div
			style={{
				backgroundColor: theme.colors.bgActivity,
				border: `1px solid ${isWorktree ? theme.colors.accent + '30' : theme.colors.border}`,
				borderStyle: isWorktree ? 'dashed' : 'solid',
				borderRadius: '8px',
				padding: '10px 12px',
				animation: `card-enter 0.4s cubic-bezier(0.23, 1, 0.32, 1) ${animationDelay}ms both`,
			}}
		>
			{/* Header row: status dot + name + worktree badge */}
			<div className="flex items-center gap-2 mb-1.5">
				<div
					className="w-2 h-2 rounded-full flex-shrink-0"
					style={{
						backgroundColor: statusColor,
						animation: session.state === 'busy' ? 'status-pulse 2s ease-in-out infinite' : 'none',
					}}
				/>
				<span
					className="text-xs font-medium truncate"
					style={{ color: theme.colors.textMain }}
					title={session.name}
				>
					{session.name || session.toolType}
				</span>
				{isWorktree && (
					<span
						className="text-[8px] px-1 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
						style={{
							backgroundColor: theme.colors.accent + '20',
							color: theme.colors.accent,
						}}
					>
						WT
					</span>
				)}
			</div>

			{/* Branch name for worktree agents */}
			{isWorktree && session.worktreeBranch && (
				<div
					className="text-[10px] truncate mb-1.5 pl-4"
					style={{ color: theme.colors.textDim }}
					title={session.worktreeBranch}
				>
					{session.worktreeBranch}
				</div>
			)}

			{/* Metrics row + sparkline */}
			<div className="flex items-end justify-between">
				<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
					<span style={{ color: theme.colors.textMain, fontWeight: 500 }}>
						{sessionStats.count}
					</span>{' '}
					queries
				</div>
				<Sparkline
					data={sparkData}
					color={isWorktree ? theme.colors.accent : theme.colors.success}
					width={50}
					height={16}
					fillOpacity={0.1}
				/>
			</div>
		</div>
	);
}

export default React.memo(AgentOverviewCards);
```

### Step 4: Integrate into Dashboard Modal

In `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx`:

1. Import the new component:

```tsx
import AgentOverviewCards from './AgentOverviewCards';
```

2. Add it at the top of the dashboard content, before the summary cards:

```tsx
{
	/* Agent Overview Section — at the top */
}
<AgentOverviewCards sessions={sessions} data={stats} theme={theme} />;

{
	/* Existing Summary Cards */
}
<SummaryCards data={stats} theme={theme} sessions={sessions} />;
```

### Step 5: Export Sparkline for Reuse

Make the Sparkline component importable by other dashboard components:

```tsx
// Export from a shared location, e.g., src/renderer/components/UsageDashboard/Sparkline.tsx
export { Sparkline };
```

## Validation Checklist

- [ ] Each summary card shows a mini sparkline in the bottom-right showing 7-day trend
- [ ] Sparklines render correctly: line + area fill + end dot
- [ ] Empty sparklines (all zeros) show a dashed horizontal line
- [ ] Agent Overview Cards section appears at the top of the dashboard
- [ ] Each active agent has its own card with: name, status dot, query count, sparkline
- [ ] Worktree agents show "WT" badge and branch name in their overview card
- [ ] Worktree agent cards have dashed borders
- [ ] Cards animate in with staggered delays
- [ ] Status dots use correct colors (green idle, yellow busy, red error)
- [ ] Sparkline colors match agent type (accent for worktree, success for regular)
- [ ] Grid layout is responsive (auto-fill, wraps on smaller screens)
- [ ] No TypeScript errors
- [ ] Clicking a card doesn't break anything (no click handler needed yet — future drill-down)
