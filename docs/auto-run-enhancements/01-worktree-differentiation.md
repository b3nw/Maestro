# Doc 1: Worktree Agent Differentiation (C1+C2)

## Goal

Visually distinguish worktree agents from parent/regular agents throughout the sidebar and dashboard. Add branch name display, distinct styling (dashed borders, secondary accent), and iconography so users can instantly tell agent types apart.

## Files to Modify

1. `src/renderer/components/SessionItem.tsx` — Add worktree badges, branch name, dashed border styling
2. `src/renderer/components/UsageDashboard/AgentUsageChart.tsx` — Color-code worktree vs parent agents
3. `src/renderer/components/UsageDashboard/AgentComparisonChart.tsx` — Visual marker for worktree agents
4. `src/renderer/components/UsageDashboard/AgentEfficiencyChart.tsx` — Worktree differentiation in bars
5. `src/renderer/components/UsageDashboard/SessionStats.tsx` — Worktree count in session breakdown

## Implementation Steps

### Step 1: SessionItem.tsx — Worktree Badge and Branch Name

In `src/renderer/components/SessionItem.tsx`, find the worktree variant rendering section (around line 102-105 where `variant === 'worktree'` is checked).

**Current behavior**: Worktree items show with extra left padding (`pl-8`), smaller text (`text-xs`), and a GitBranch icon. But there's no explicit "Worktree" badge or branch name displayed.

**Changes needed**:

1. **Add a "Worktree" badge** next to the session name for worktree variants. After the session name text span, add:

```tsx
{
	variant === 'worktree' && (
		<span
			className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
			style={{
				backgroundColor: theme.colors.accent + '20',
				color: theme.colors.accent,
				border: `1px solid ${theme.colors.accent}40`,
			}}
		>
			Worktree
		</span>
	);
}
```

2. **Display the branch name** below or beside the session name for worktree items. After the name + badge row, add:

```tsx
{
	variant === 'worktree' && session.worktreeBranch && (
		<span
			className="ml-1 text-[10px] truncate max-w-[120px]"
			style={{ color: theme.colors.textDim }}
			title={session.worktreeBranch}
		>
			{session.worktreeBranch}
		</span>
	);
}
```

3. **Apply dashed left border** to worktree items. Find the container div's border-left styling. For worktree variants, change from solid to dashed:

```tsx
// In the container div's style prop, modify borderLeft:
borderLeft: variant === 'worktree'
	? `2px dashed ${isActive ? theme.colors.accent : 'transparent'}`
	: `2px solid ${isActive ? theme.colors.accent : 'transparent'}`;
```

4. **Use a secondary accent color** for worktree items. Apply a slightly different background tint on hover/active:

```tsx
// For worktree variant active background, use accent at lower opacity:
backgroundColor: variant === 'worktree'
	? theme.colors.accent + '15' // 15% opacity for worktree
	: theme.colors.bgActivity + '40'; // Standard for parents
```

### Step 2: Parent Agent Enhancement

For sessions that HAVE worktree children (check `session.worktreeConfig` exists), add a subtle parent indicator:

1. **Add a tree/parent icon** next to sessions with `worktreeConfig`:

```tsx
{
	session.worktreeConfig && (
		<span
			className="ml-1 text-[10px]"
			style={{ color: theme.colors.textDim }}
			title="Parent agent with worktrees"
		>
			<FolderTree size={10} />
		</span>
	);
}
```

2. Import `FolderTree` from lucide-react at the top of the file (it's already a dependency).

### Step 3: Dashboard Chart Differentiation

**AgentUsageChart.tsx** (`src/renderer/components/UsageDashboard/AgentUsageChart.tsx`):

This chart already maps sessionId to session names for the top-10 usage chart. Extend it to:

1. Find where session names are resolved (the mapping logic that converts sessionId to display name).
2. For sessions where the Session object has `parentSessionId` set (worktree agents), append a branch icon or "(WT)" suffix to the label.
3. Use a dashed stroke style for worktree agent lines instead of solid:

```tsx
// When rendering Line components for each agent:
strokeDasharray={isWorktreeSession ? "5 3" : undefined}
```

**AgentComparisonChart.tsx** (`src/renderer/components/UsageDashboard/AgentComparisonChart.tsx`):

1. In the horizontal bar chart, add a visual pattern (diagonal stripes or lower opacity) for worktree agent bars.
2. Add a legend entry distinguishing "Agent" vs "Worktree Agent".

**AgentEfficiencyChart.tsx** (`src/renderer/components/UsageDashboard/AgentEfficiencyChart.tsx`):

1. Apply the same dashed/striped pattern for worktree agent entries.
2. Group worktree agents visually near their parent if possible.

### Step 4: SessionStats.tsx — Worktree Count

In `src/renderer/components/UsageDashboard/SessionStats.tsx`:

1. Add a new stat showing worktree vs regular session breakdown.
2. Access session data to count sessions with `parentSessionId` set vs those without.
3. Display as a small donut or simple stat pair: "Regular: X | Worktree: Y"

### Step 5: Helper Function

Create a shared helper to determine if a session is a worktree agent. Add to the component or a shared utils file:

```tsx
function isWorktreeAgent(session: Session): boolean {
	return !!session.parentSessionId;
}

function isParentAgent(session: Session): boolean {
	return !!session.worktreeConfig;
}
```

## Validation Checklist

After running this doc, verify:

- [ ] Worktree agents in the sidebar show a "Worktree" badge next to their name
- [ ] Branch name appears for worktree agents (e.g., "feature/my-branch")
- [ ] Worktree agents have dashed left borders (vs solid for regular agents)
- [ ] Worktree agents have a slightly different background tint when active
- [ ] Parent agents with worktrees show a tree/folder icon
- [ ] Dashboard charts visually distinguish worktree agents (dashed lines, patterns, or labels)
- [ ] SessionStats shows worktree vs regular breakdown
- [ ] No TypeScript errors (run `npm run typecheck` or equivalent)
- [ ] Theme colors are properly applied in both dark and light modes
- [ ] Existing sidebar functionality (click, rename, bookmark, drag) still works
