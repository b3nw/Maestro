import { useState, useCallback } from 'react';
import { safeClipboardWrite } from '../../utils/clipboard';

/**
 * Clipboard copy handler with a centered flash notification.
 *
 * Returns the notification message (or null) and an async copy function.
 * The notification auto-dismisses after 2 seconds.
 */
export function useCopyToClipboard() {
	const [copyNotification, setCopyNotification] = useState<string | null>(null);

	const copyToClipboard = useCallback(async (text: string, message?: string) => {
		const ok = await safeClipboardWrite(text);
		if (ok) {
			// Show centered flash notification
			setCopyNotification(message || 'Copied to Clipboard');
			setTimeout(() => setCopyNotification(null), 2000);
		}
	}, []);

	return { copyNotification, copyToClipboard };
}
