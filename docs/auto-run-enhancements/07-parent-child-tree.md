# Doc 7: Parent-Child Tree Visualization (C3)

## Goal

Add an expandable tree view in the sidebar that shows parent-child agent relationships with connecting lines, branch names, and per-child status indicators. This makes the worktree hierarchy visually obvious and navigable.

## Files to Modify

1. `src/renderer/components/SessionItem.tsx` — Add tree connecting lines for worktree children
2. `src/renderer/components/SessionList.tsx` (or wherever sessions are listed) — Add expand/collapse logic with tree rendering
3. CSS file — Add tree line styles

## Prerequisites

- Doc 1 (Worktree Differentiation) should be completed first — it adds the badge/branch/dashed border foundation
- Session objects have `parentSessionId` linking children to parents
- Session objects have `worktreeConfig` on parent sessions
- Session objects have `worktreesExpanded` boolean for expand/collapse state

## Implementation Steps

### Step 1: Identify Session List Component

First, find the component that renders the session list in the sidebar. It likely:

- Maps over sessions array
- Renders `<SessionItem>` for each
- Already groups worktree children under parents (check for `parentSessionId` filtering)

Look in `src/renderer/components/` for `SessionList.tsx`, `Sidebar.tsx`, or similar. The expand/collapse state for worktrees (`worktreesExpanded`) suggests this grouping already exists.

### Step 2: Tree Connector Lines (CSS)

Add tree visualization CSS that creates vertical and horizontal connecting lines between parent and child:

```css
/* Tree connector lines for parent-child relationships */
.tree-children {
	position: relative;
}

.tree-children::before {
	content: '';
	position: absolute;
	left: 20px; /* Align with parent's left edge + offset */
	top: 0;
	bottom: 12px; /* Stop before the last child's middle */
	width: 1px;
	background-color: var(--tree-line-color, rgba(255, 255, 255, 0.15));
}

.tree-child {
	position: relative;
}

.tree-child::before {
	content: '';
	position: absolute;
	left: 20px;
	top: 50%;
	width: 12px;
	height: 1px;
	background-color: var(--tree-line-color, rgba(255, 255, 255, 0.15));
}

/* Last child: cap the vertical line */
.tree-child:last-child::after {
	content: '';
	position: absolute;
	left: 20px;
	top: 50%;
	bottom: 0;
	width: 1px;
	background-color: var(--tree-bg-color, var(--bg-sidebar));
}
```

### Step 3: Expand/Collapse Button on Parent

In `SessionItem.tsx`, for sessions with `worktreeConfig` (parent agents), add an expand/collapse toggle:

```tsx
{
	session.worktreeConfig && (
		<button
			onClick={(e) => {
				e.stopPropagation();
				onToggleWorktrees?.(session.id);
			}}
			className="flex items-center justify-center w-4 h-4 rounded hover:bg-white/10 transition-colors"
			style={{ color: theme.colors.textDim }}
			title={session.worktreesExpanded ? 'Collapse worktrees' : 'Expand worktrees'}
		>
			<ChevronRight
				size={12}
				className="transition-transform duration-200"
				style={{
					transform: session.worktreesExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
				}}
			/>
		</button>
	);
}
```

Import `ChevronRight` from lucide-react. Add `onToggleWorktrees` to the component props interface if not already present.

### Step 4: Tree Rendering in Session List

In the session list component, modify the rendering to group parent and children:

```tsx
function renderSessionTree(session: Session, allSessions: Session[]) {
	const children = allSessions.filter((s) => s.parentSessionId === session.id);
	const hasChildren = children.length > 0;

	return (
		<div key={session.id}>
			{/* Parent session */}
			<SessionItem
				session={session}
				variant={session.parentSessionId ? 'worktree' : 'group'}
				onToggleWorktrees={handleToggleWorktrees}
				{...otherProps}
			/>

			{/* Children with tree lines */}
			{hasChildren && session.worktreesExpanded && (
				<div
					className="tree-children"
					style={
						{
							'--tree-line-color': theme.colors.accent + '30',
							'--tree-bg-color': theme.colors.bgSidebar,
						} as React.CSSProperties
					}
				>
					{children.map((child, index) => (
						<div key={child.id} className="tree-child">
							<SessionItem session={child} variant="worktree" {...otherProps} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
```

### Step 5: Animated Expand/Collapse

Add smooth height animation for the tree children container:

```tsx
// Wrap children in an animated container
<div
	className="tree-children overflow-hidden transition-all duration-200 ease-in-out"
	style={
		{
			maxHeight: session.worktreesExpanded ? `${children.length * 48}px` : '0px',
			opacity: session.worktreesExpanded ? 1 : 0,
			'--tree-line-color': theme.colors.accent + '30',
			'--tree-bg-color': theme.colors.bgSidebar,
		} as React.CSSProperties
	}
>
	{children.map((child) => (
		<div key={child.id} className="tree-child">
			<SessionItem session={child} variant="worktree" {...otherProps} />
		</div>
	))}
</div>
```

### Step 6: Child Count Badge on Collapsed Parent

When a parent's worktrees are collapsed, show a count badge:

```tsx
{
	session.worktreeConfig && !session.worktreesExpanded && childCount > 0 && (
		<span
			className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
			style={{
				backgroundColor: theme.colors.accent + '20',
				color: theme.colors.accent,
			}}
		>
			{childCount}
		</span>
	);
}
```

Where `childCount` is computed by counting sessions with matching `parentSessionId`.

### Step 7: Visual Polish

Ensure the tree lines align properly:

1. The vertical line should start at the parent's bottom edge and end at the last child's center
2. Each horizontal branch should extend from the vertical line to the child's left padding
3. Lines should use the theme's accent color at low opacity (20-30%)
4. Lines should be 1px wide (thin, subtle)

Adjust `left` values in the CSS to match the actual sidebar indentation:

- Parent items have `px-4` (16px padding)
- Worktree items have `pl-8` (32px padding)
- Tree vertical line should be at ~20px (between parent and child padding)
- Tree horizontal branch should span from 20px to 32px

## Validation Checklist

- [ ] Parent agents with worktree children show a chevron expand/collapse button
- [ ] Clicking the chevron toggles the worktree children visibility
- [ ] When expanded, vertical connecting lines appear from parent to children
- [ ] Each child has a horizontal branch line connecting to the vertical line
- [ ] The last child's vertical line is properly capped (doesn't extend below)
- [ ] Tree lines use accent color at low opacity (subtle, not overpowering)
- [ ] Expand/collapse animates smoothly (height + opacity transition)
- [ ] Collapsed parents show a child count badge (e.g., "3")
- [ ] Worktree children still show the "Worktree" badge and branch name (from Doc 1)
- [ ] Clicking a child session still navigates to it / selects it properly
- [ ] Nested tree works with deeply nested relationships (if any)
- [ ] Tree visualization works in both narrow and wide sidebar modes
- [ ] No TypeScript errors
- [ ] Performance is acceptable with many worktree children (e.g., 10+)
