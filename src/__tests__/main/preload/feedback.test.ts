import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();

vi.mock('electron', () => ({
	ipcRenderer: {
		invoke: (...args: unknown[]) => mockInvoke(...args),
	},
}));

import { createFeedbackApi } from '../../../main/preload/feedback';

describe('Feedback Preload API', () => {
	let api: ReturnType<typeof createFeedbackApi>;

	beforeEach(() => {
		vi.clearAllMocks();
		api = createFeedbackApi();
	});

	it('invokes feedback:check-gh-auth', async () => {
		mockInvoke.mockResolvedValue({ authenticated: true });

		const result = await api.checkGhAuth();

		expect(mockInvoke).toHaveBeenCalledWith('feedback:check-gh-auth');
		expect(result.authenticated).toBe(true);
	});

	it('invokes feedback:submit with attachments payload', async () => {
		mockInvoke.mockResolvedValue({ success: true });
		const attachments = [{ name: 'bug.png', dataUrl: 'data:image/png;base64,abc123' }];

		const result = await api.submit('session-123', 'Something broke', attachments);

		expect(mockInvoke).toHaveBeenCalledWith('feedback:submit', {
			sessionId: 'session-123',
			feedbackText: 'Something broke',
			attachments,
		});
		expect(result.success).toBe(true);
	});

	it('invokes feedback:compose-prompt with attachments payload', async () => {
		mockInvoke.mockResolvedValue({ prompt: 'rendered prompt' });
		const attachments = [{ name: 'bug.png', dataUrl: 'data:image/png;base64,abc123' }];

		const result = await api.composePrompt('Something broke', attachments);

		expect(mockInvoke).toHaveBeenCalledWith('feedback:compose-prompt', {
			feedbackText: 'Something broke',
			attachments,
		});
		expect(result.prompt).toBe('rendered prompt');
	});
});
