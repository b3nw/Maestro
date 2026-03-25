import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';

const registeredHandlers = new Map<string, Function>();
const mockProcessManager = {
	write: vi.fn(),
};

vi.mock('electron', () => ({
	ipcMain: {
		handle: vi.fn((channel: string, handler: Function) => {
			registeredHandlers.set(channel, handler);
		}),
	},
	app: {
		isPackaged: false,
		getAppPath: () => '/mock/app',
	},
}));

vi.mock('fs/promises', () => ({
	default: {
		readFile: vi.fn(),
	},
}));

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../main/utils/cliDetection', () => ({
	isGhInstalled: vi.fn(),
	setCachedGhStatus: vi.fn(),
	getCachedGhStatus: vi.fn(),
	getExpandedEnv: vi.fn(() => ({ PATH: '/usr/bin' })),
}));

vi.mock('../../../../main/utils/execFile', () => ({
	execFileNoThrow: vi.fn(),
}));

vi.mock('../../../../main/process-manager/utils/imageUtils', () => ({
	saveImageToTempFile: vi.fn(),
	buildImagePromptPrefix: vi.fn((paths: string[]) =>
		paths.length > 0 ? `[Attached images: ${paths.join(', ')}]\n\n` : ''
	),
	cleanupTempFiles: vi.fn(),
}));

import fs from 'fs/promises';
import {
	getCachedGhStatus,
	isGhInstalled,
	setCachedGhStatus,
} from '../../../../main/utils/cliDetection';
import { execFileNoThrow } from '../../../../main/utils/execFile';
import {
	buildImagePromptPrefix,
	cleanupTempFiles,
	saveImageToTempFile,
} from '../../../../main/process-manager/utils/imageUtils';
import { registerFeedbackHandlers } from '../../../../main/ipc/handlers/feedback';

describe('feedback handlers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		registeredHandlers.clear();
		mockProcessManager.write.mockReset();
		registerFeedbackHandlers({
			getProcessManager: () => mockProcessManager as any,
		});
	});

	it('registers feedback handlers', () => {
		expect(ipcMain.handle).toHaveBeenCalledWith('feedback:check-gh-auth', expect.any(Function));
		expect(ipcMain.handle).toHaveBeenCalledWith('feedback:submit', expect.any(Function));
	});

	it('returns cached gh auth result when available', async () => {
		vi.mocked(getCachedGhStatus).mockReturnValue({ installed: true, authenticated: true });

		const handler = registeredHandlers.get('feedback:check-gh-auth');
		const result = await handler!({});

		expect(result).toEqual({ authenticated: true });
		expect(isGhInstalled).not.toHaveBeenCalled();
	});

	it('writes feedback prompt with attached image paths', async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			'# Feedback\n\nUser-provided feedback:\n{{FEEDBACK}}\n'
		);
		mockProcessManager.write.mockReturnValue(true);
		vi.mocked(saveImageToTempFile).mockReturnValue('/tmp/maestro-image-1.png');

		const handler = registeredHandlers.get('feedback:submit');
		const result = await handler!({}, {
			sessionId: 'session-123',
			feedbackText: 'The modal crashes',
			attachments: [{ name: 'bug.png', dataUrl: 'data:image/png;base64,abc123' }],
		});

		expect(saveImageToTempFile).toHaveBeenCalledWith('data:image/png;base64,abc123', 0);
		expect(buildImagePromptPrefix).toHaveBeenCalledWith(['/tmp/maestro-image-1.png']);
		expect(mockProcessManager.write).toHaveBeenCalledWith(
			'session-123',
			expect.stringContaining('/tmp/maestro-image-1.png')
		);
		expect(mockProcessManager.write).toHaveBeenCalledWith(
			'session-123',
			expect.stringContaining('The modal crashes')
		);
		expect(cleanupTempFiles).not.toHaveBeenCalled();
		expect(result).toEqual({ success: true });
	});

	it('revalidates gh auth when cache is empty', async () => {
		vi.mocked(getCachedGhStatus).mockReturnValue(null);
		vi.mocked(isGhInstalled).mockResolvedValue(true);
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 0,
			stdout: '',
			stderr: '',
		} as any);

		const handler = registeredHandlers.get('feedback:check-gh-auth');
		const result = await handler!({});

		expect(execFileNoThrow).toHaveBeenCalledWith('gh', ['auth', 'status'], undefined, {
			PATH: '/usr/bin',
		});
		expect(setCachedGhStatus).toHaveBeenCalledWith(true, true);
		expect(result).toEqual({ authenticated: true });
	});
});
