# Doc 2: Status Color System (A1)

## Goal

Implement a consistent, animated status color system across the sidebar and dashboard. Add pulsing animations for active states, standardize color usage (green=idle/ready, yellow=busy, red=error, orange=connecting), and make agent status instantly readable at a glance.

## Files to Modify

1. `src/renderer/components/SessionItem.tsx` — Enhanced status dot with animations
2. `src/shared/theme-types.ts` — Ensure status colors are in the theme (already has success/warning/error)
3. `src/renderer/components/UsageDashboard/SummaryCards.tsx` — Status-colored stat cards

## Implementation Steps

### Step 1: Define Status Color Mapping

In `src/renderer/components/SessionItem.tsx`, create a status color mapping function near the top of the file (or in a shared utils file if one exists for session helpers):

```tsx
function getEnhancedStatusColor(
	state: SessionState,
	theme: Theme
): {
	color: string;
	animate: boolean;
	label: string;
} {
	switch (state) {
		case 'idle':
			return { color: theme.colors.success, animate: false, label: 'Ready' };
		case 'busy':
			return { color: theme.colors.warning, animate: true, label: 'Working' };
		case 'error':
			return { color: theme.colors.error, animate: false, label: 'Error' };
		case 'connecting':
			return { color: '#ffb86c', animate: true, label: 'Connecting' }; // Orange, fallback if not in theme
		case 'waiting':
			return { color: theme.colors.accent, animate: true, label: 'Waiting' };
		default:
			return { color: theme.colors.textDim, animate: false, label: state };
	}
}
```

Note: Check what `SessionState` values actually exist in the codebase. The above covers the common ones — adjust based on the actual union type.

### Step 2: Enhanced Status Dot Component

Replace the current status dot rendering in `SessionItem.tsx` (around lines 329-365) with an enhanced version that uses proper ring animations:

```tsx
{
	/* Enhanced Status Dot */
}
<div className="relative ml-auto flex items-center gap-1.5">
	{/* Status dot with optional pulse ring */}
	<div className="relative">
		{/* Pulse ring (only when animated) */}
		{statusInfo.animate && (
			<div
				className="absolute inset-0 rounded-full animate-ping"
				style={{
					backgroundColor: statusInfo.color,
					opacity: 0.3,
				}}
			/>
		)}
		{/* Core dot */}
		<div
			className="relative w-2 h-2 rounded-full"
			style={{
				backgroundColor: isDisconnected ? 'transparent' : statusInfo.color,
				border: isDisconnected ? `1.5px solid ${theme.colors.textDim}` : 'none',
				boxShadow: statusInfo.animate ? `0 0 6px ${statusInfo.color}60` : 'none',
			}}
			title={statusInfo.label}
		/>
	</div>

	{/* Unread badge */}
	{!isActive && session.aiTabs?.some((tab) => tab.hasUnread) && (
		<div
			className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
			style={{ backgroundColor: theme.colors.error }}
		/>
	)}
</div>;
```

Where `statusInfo` is computed at the top of the render:

```tsx
const statusInfo = getEnhancedStatusColor(session.state, theme);
const isDisconnected = session.toolType === 'claude-code' && !session.agentSessionId && !isInBatch;
```

### Step 3: CSS Keyframe Animations

If not already defined, add these CSS animations. Check if there's a global CSS file (likely `src/renderer/index.css` or similar) and add:

```css
/* Status dot pulse - softer than default animate-ping */
@keyframes status-pulse {
	0%,
	100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.7;
		transform: scale(1.3);
	}
}

/* Gentle glow for busy state */
@keyframes status-glow {
	0%,
	100% {
		box-shadow: 0 0 4px currentColor;
	}
	50% {
		box-shadow: 0 0 8px currentColor;
	}
}
```

Note: Tailwind's `animate-ping` may already suffice. If the default ping animation is too aggressive, use a custom animation class instead.

### Step 4: SummaryCards Status Integration

In `src/renderer/components/UsageDashboard/SummaryCards.tsx`:

1. Find the stat card that shows "Active Sessions" or session count.
2. Add a colored dot next to the count indicating how many are in each state:

```tsx
{
	/* Mini status breakdown */
}
<div className="flex items-center gap-2 mt-1">
	{activeCount > 0 && (
		<span className="flex items-center gap-1 text-[10px]" style={{ color: theme.colors.warning }}>
			<span
				className="w-1.5 h-1.5 rounded-full inline-block"
				style={{ backgroundColor: theme.colors.warning }}
			/>
			{activeCount} busy
		</span>
	)}
	{idleCount > 0 && (
		<span className="flex items-center gap-1 text-[10px]" style={{ color: theme.colors.success }}>
			<span
				className="w-1.5 h-1.5 rounded-full inline-block"
				style={{ backgroundColor: theme.colors.success }}
			/>
			{idleCount} idle
		</span>
	)}
	{errorCount > 0 && (
		<span className="flex items-center gap-1 text-[10px]" style={{ color: theme.colors.error }}>
			<span
				className="w-1.5 h-1.5 rounded-full inline-block"
				style={{ backgroundColor: theme.colors.error }}
			/>
			{errorCount} error
		</span>
	)}
</div>;
```

### Step 5: Batch/AutoRun Status Enhancement

The current batch indicator shows a flashing orange indicator. Enhance it to be consistent with the new status system:

1. Find the batch/auto-run indicator in `SessionItem.tsx` (look for `isInBatch` references).
2. Apply the same glow effect used for busy status:

```tsx
{
	isInBatch && (
		<span
			className="text-[9px] font-bold px-1 rounded"
			style={{
				color: theme.colors.warning,
				backgroundColor: theme.colors.warning + '20',
				animation: 'status-pulse 2s ease-in-out infinite',
			}}
		>
			AUTO
		</span>
	);
}
```

## Validation Checklist

- [ ] Idle/ready agents show a solid green dot (no animation)
- [ ] Busy/working agents show a yellow/warning dot with a pulsing glow effect
- [ ] Error agents show a solid red dot
- [ ] Connecting agents show an orange dot with pulse animation
- [ ] Disconnected agents show a hollow dot (border only, no fill) — existing behavior preserved
- [ ] Auto-run batch agents show enhanced "AUTO" badge with gentle pulse
- [ ] Status dot has a tooltip showing the state label on hover
- [ ] Animations are smooth and not distracting (subtle glow, not jarring flash)
- [ ] Colors work correctly in both dark and light themes
- [ ] Dashboard summary cards show mini status breakdown if applicable
- [ ] No TypeScript errors
- [ ] Performance is not impacted (animations use CSS, not JS intervals)
