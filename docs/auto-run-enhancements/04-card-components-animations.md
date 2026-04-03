# Doc 4: Card Components + Animations (A3+A4)

## Goal

Refactor the dashboard stat cards with elevated/outlined/ghost variants, add interactive hover states (subtle scale + brightness), and implement animation tiers: bouncing dots for thinking states, smooth staggered entrance transitions, and count-up number animations.

## Files to Modify

1. `src/renderer/components/UsageDashboard/SummaryCards.tsx` — Refactor stat card styling with variants
2. `src/renderer/components/UsageDashboard/UsageDashboardModal.tsx` — Add entrance animation orchestration
3. CSS file (e.g., `src/renderer/index.css` or equivalent global CSS) — Add keyframe animations

## Implementation Steps

### Step 1: Card Variant System

In `src/renderer/components/UsageDashboard/SummaryCards.tsx`, add a card variant system:

```tsx
type CardVariant = 'elevated' | 'outlined' | 'filled' | 'ghost';

interface StatCardProps {
	icon: React.ReactNode;
	value: string | number;
	label: string;
	subtitle?: string;
	variant?: CardVariant;
	accentColor?: string;
	theme: Theme;
	animationDelay?: number; // ms delay for staggered entrance
}

function getCardStyles(variant: CardVariant, theme: Theme, accentColor?: string) {
	const base = {
		borderRadius: '10px',
		padding: 'clamp(12px, 2vw, 16px)',
		transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
		cursor: 'default',
	};

	switch (variant) {
		case 'elevated':
			return {
				...base,
				backgroundColor: theme.colors.bgActivity,
				border: `1px solid ${theme.colors.border}`,
				boxShadow: `0 2px 8px ${theme.colors.bgMain}80`,
			};
		case 'outlined':
			return {
				...base,
				backgroundColor: 'transparent',
				border: `1px solid ${accentColor || theme.colors.accent}40`,
			};
		case 'filled':
			return {
				...base,
				backgroundColor: (accentColor || theme.colors.accent) + '15',
				border: `1px solid ${accentColor || theme.colors.accent}30`,
			};
		case 'ghost':
			return {
				...base,
				backgroundColor: 'transparent',
				border: '1px solid transparent',
			};
	}
}
```

### Step 2: Hover States

Add hover interaction to each stat card. Use CSS or inline style with a state:

```tsx
function StatCard({
	icon,
	value,
	label,
	subtitle,
	variant = 'elevated',
	accentColor,
	theme,
	animationDelay = 0,
}: StatCardProps) {
	const [hovered, setHovered] = useState(false);
	const cardStyles = getCardStyles(variant, theme, accentColor);

	return (
		<div
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				...cardStyles,
				transform: hovered ? 'scale(0.98)' : 'scale(1)',
				filter: hovered ? 'brightness(1.1)' : 'brightness(1)',
				animation: `card-enter 0.45s cubic-bezier(0.23, 1, 0.32, 1) ${animationDelay}ms both`,
			}}
		>
			{/* Card content */}
			<div className="flex items-center gap-2 mb-2">
				<span style={{ color: accentColor || theme.colors.accent }}>{icon}</span>
				<span className="text-xs uppercase tracking-wider" style={{ color: theme.colors.textDim }}>
					{label}
				</span>
			</div>
			<div
				className="text-2xl font-bold"
				style={{
					color: theme.colors.textMain,
					fontSize: 'clamp(18px, 3vw, 28px)',
				}}
			>
				<AnimatedNumber value={value} />
			</div>
			{subtitle && (
				<div className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
					{subtitle}
				</div>
			)}
		</div>
	);
}
```

### Step 3: Animated Number Counter

Create a count-up animation component for stat card values:

```tsx
function AnimatedNumber({ value }: { value: string | number }) {
	const [displayed, setDisplayed] = useState<string | number>(
		typeof value === 'number' ? 0 : value
	);
	const ref = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (typeof value !== 'number') {
			setDisplayed(value);
			return;
		}

		const target = value;
		const duration = 600; // ms
		const startTime = performance.now();
		const startValue = 0;

		function animate(currentTime: number) {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			// Ease out cubic
			const eased = 1 - Math.pow(1 - progress, 3);
			const current = Math.round(startValue + (target - startValue) * eased);
			setDisplayed(current);
			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		}

		requestAnimationFrame(animate);
	}, [value]);

	return (
		<span ref={ref}>{typeof displayed === 'number' ? displayed.toLocaleString() : displayed}</span>
	);
}
```

### Step 4: CSS Keyframe Animations

Add to the global CSS file:

```css
/* Card entrance animation - fade up with slight scale */
@keyframes card-enter {
	from {
		opacity: 0;
		transform: translateY(12px) scale(0.96);
	}
	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

/* Bouncing dots for loading/thinking states */
@keyframes bounce-dot {
	0%,
	80%,
	100% {
		transform: scale(0.6);
		opacity: 0.4;
	}
	40% {
		transform: scale(1);
		opacity: 1;
	}
}

.bounce-dots span {
	display: inline-block;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	margin: 0 2px;
	animation: bounce-dot 1.4s ease-in-out infinite;
}
.bounce-dots span:nth-child(1) {
	animation-delay: 0ms;
}
.bounce-dots span:nth-child(2) {
	animation-delay: 160ms;
}
.bounce-dots span:nth-child(3) {
	animation-delay: 320ms;
}
```

### Step 5: Bouncing Dots Component

Create a reusable loading indicator:

```tsx
function BouncingDots({ color }: { color: string }) {
	return (
		<span className="bounce-dots">
			<span style={{ backgroundColor: color }} />
			<span style={{ backgroundColor: color }} />
			<span style={{ backgroundColor: color }} />
		</span>
	);
}
```

Use this wherever a "thinking" or "loading" state needs to be shown (e.g., when stats are being fetched).

### Step 6: Staggered Card Entrance

In `SummaryCards.tsx`, where multiple stat cards are rendered in a grid, add incremental delays:

```tsx
// In the cards grid
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
	<StatCard
		icon={<BarChart3 size={16} />}
		value={data.totalQueries}
		label="Total Queries"
		variant="elevated"
		theme={theme}
		animationDelay={0}
	/>
	<StatCard
		icon={<Clock size={16} />}
		value={formatDuration(data.totalDuration)}
		label="Total Time"
		variant="elevated"
		theme={theme}
		animationDelay={80}
	/>
	<StatCard
		icon={<Zap size={16} />}
		value={formatDuration(data.avgDuration)}
		label="Avg Duration"
		variant="elevated"
		theme={theme}
		animationDelay={160}
	/>
	<StatCard
		icon={<Users size={16} />}
		value={data.totalSessions}
		label="Sessions"
		variant="elevated"
		theme={theme}
		animationDelay={240}
	/>
</div>
```

### Step 7: Apply to Dashboard Section Headers

Add subtle entrance animations to section headers in the dashboard:

```tsx
// Section headers with fade-in
<h3
	className="text-sm font-semibold mb-3"
	style={{
		color: theme.colors.textMain,
		animation: 'card-enter 0.4s ease both',
	}}
>
	Overview
</h3>
```

## Validation Checklist

- [ ] Stat cards have visible borders/shadows (elevated variant) — not flat
- [ ] Hovering a stat card triggers subtle scale (0.98) + brightness (1.1) effect
- [ ] Cards animate in with a staggered fade-up on dashboard open
- [ ] Number values count up from 0 when the dashboard opens (not instant)
- [ ] Duration values display correctly (they're strings, not animated as numbers)
- [ ] Bouncing dots component renders correctly when used for loading states
- [ ] Animation timing feels natural — not too fast, not sluggish (0.45s entrance)
- [ ] Hover transitions are smooth (200ms)
- [ ] Cards look good in both dark and light themes
- [ ] Grid layout still responsive (2 cols on small, 4 on large)
- [ ] No TypeScript errors
- [ ] No performance issues (animations use CSS transforms and opacity — GPU accelerated)
