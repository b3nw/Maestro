# Dashboard Beautification Auto-Run Docs

Run these docs sequentially, validating results after each one before proceeding to the next.

## Phase 1: Quick Wins (No blockers)

| Doc | File                                                             | What It Does                                                                        |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | [01-worktree-differentiation.md](01-worktree-differentiation.md) | Worktree badges, branch names, dashed borders, secondary accent for worktree agents |
| 2   | [02-status-color-system.md](02-status-color-system.md)           | Pulsing green/yellow/red/orange status dots with animations                         |
| 3   | [03-agent-instance-names.md](03-agent-instance-names.md)         | Show "My Project" instead of "claude-code" in all charts                            |

## Phase 2: Beauty Pass (Moderate effort)

| Doc | File                                                                 | What It Does                                                                              |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 4   | [04-card-components-animations.md](04-card-components-animations.md) | Card variants (elevated/outlined/ghost), hover states, count-up animations, bouncing dots |
| 5   | [05-realtime-metrics-cards.md](05-realtime-metrics-cards.md)         | Token count, cost badges, context usage bar with threshold coloring                       |
| 6   | [06-sparklines-agent-overview.md](06-sparklines-agent-overview.md)   | Mini sparkline trends in cards + per-agent overview cards at dashboard top                |

## Phase 3: Deep Differentiation (Requires backend changes)

| Doc | File                                                         | What It Does                                                        |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| 7   | [07-parent-child-tree.md](07-parent-child-tree.md)           | Expandable tree view in sidebar with connecting lines               |
| 8   | [08-worktree-analytics-tab.md](08-worktree-analytics-tab.md) | `isWorktree` field in stats DB, schema migration, new analytics tab |
| 9   | [09-interactive-drill-down.md](09-interactive-drill-down.md) | Click any agent to filter all charts — filter state layer           |

## Dependencies

- Docs 1-3 are independent of each other (can be run in any order within Phase 1)
- Doc 4 builds on the SummaryCards component (no hard dependency on Phase 1)
- Doc 5 builds on Doc 4's card system
- Doc 6 depends on Doc 4 (card animations) and references Doc 1 (worktree styling)
- Doc 7 depends on Doc 1 (worktree badges)
- Doc 8 is self-contained (backend changes + new tab)
- Doc 9 depends on Doc 3 (agent instance names) and Doc 6 (overview cards)
