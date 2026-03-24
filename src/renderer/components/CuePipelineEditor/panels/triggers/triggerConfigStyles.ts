/** Shared styles for trigger configuration form fields. */

import type { Theme } from '../../../../types';

export const inputStyle: React.CSSProperties = {
	backgroundColor: '#2a2a3e',
	border: '1px solid #444',
	borderRadius: 4,
	color: '#e4e4e7',
	padding: '4px 8px',
	fontSize: 12,
	outline: 'none',
	width: '100%',
};

export const selectStyle: React.CSSProperties = {
	...inputStyle,
	cursor: 'pointer',
};

export const labelStyle: React.CSSProperties = {
	color: '#9ca3af',
	fontSize: 11,
	fontWeight: 500,
	marginBottom: 4,
	display: 'block',
};

export function getInputStyle(theme: Theme): React.CSSProperties {
	return {
		backgroundColor: theme.colors.bgActivity,
		border: `1px solid ${theme.colors.border}`,
		borderRadius: 4,
		color: theme.colors.textMain,
		padding: '4px 8px',
		fontSize: 12,
		outline: 'none',
		width: '100%',
	};
}

export function getSelectStyle(theme: Theme): React.CSSProperties {
	return {
		...getInputStyle(theme),
		cursor: 'pointer',
	};
}

export function getLabelStyle(theme: Theme): React.CSSProperties {
	return {
		color: theme.colors.textDim,
		fontSize: 11,
		fontWeight: 500,
		marginBottom: 4,
		display: 'block',
	};
}
