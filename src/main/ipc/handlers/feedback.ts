/**
 * Feedback IPC Handlers
 *
 * This module handles:
 * - Checking GitHub CLI availability and authentication
 * - Submitting feedback text to the selected agent as a structured prompt
 */

import { ipcMain, app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';
import {
	isGhInstalled,
	setCachedGhStatus,
	getCachedGhStatus,
	getExpandedEnv,
} from '../../utils/cliDetection';
import { execFileNoThrow } from '../../utils/execFile';
import { ProcessManager } from '../../process-manager';
import {
	buildImagePromptPrefix,
	cleanupTempFiles,
	saveImageToTempFile,
} from '../../process-manager/utils/imageUtils';

const LOG_CONTEXT = '[Feedback]';

const GH_NOT_INSTALLED_MESSAGE =
	'GitHub CLI (gh) is not installed. Install it from https://cli.github.com';
const GH_NOT_AUTHENTICATED_MESSAGE =
	'GitHub CLI is not authenticated. Run "gh auth login" in your terminal.';

function getPromptPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, 'prompts', 'feedback.md');
	}

	return path.join(app.getAppPath(), 'src', 'prompts', 'feedback.md');
}

/**
 * Helper to create handler options with consistent context
 */
const handlerOpts = (
	operation: string,
	extra?: Partial<CreateHandlerOptions>
): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
	...extra,
});

/**
 * Dependencies required for feedback handler registration
 */
export interface FeedbackHandlerDependencies {
	getProcessManager: () => ProcessManager | null;
}

export interface FeedbackAttachmentInput {
	name: string;
	dataUrl: string;
}

/**
 * Register feedback IPC handlers.
 */
export function registerFeedbackHandlers(deps: FeedbackHandlerDependencies): void {
	const { getProcessManager } = deps;

	logger.info('Registering feedback IPC handlers', LOG_CONTEXT);

	// Check if GitHub CLI is installed and authenticated
	ipcMain.handle(
		'feedback:check-gh-auth',
		withIpcErrorLogging(
			handlerOpts('check-gh-auth'),
			async (): Promise<{ authenticated: boolean; message?: string }> => {
				// Prefer cache when available
				const cached = getCachedGhStatus();
				if (cached) {
					if (!cached.installed) {
						return { authenticated: false, message: GH_NOT_INSTALLED_MESSAGE };
					}
					if (!cached.authenticated) {
						return { authenticated: false, message: GH_NOT_AUTHENTICATED_MESSAGE };
					}
					return { authenticated: true };
				}

				// Check if gh is installed
				const installed = await isGhInstalled();
				if (!installed) {
					setCachedGhStatus(false, false);
					return { authenticated: false, message: GH_NOT_INSTALLED_MESSAGE };
				}

				// Check auth status (command output ignored; exit code is the signal)
				const authResult = await execFileNoThrow(
					'gh',
					['auth', 'status'],
					undefined,
					getExpandedEnv()
				);
				const authenticated = authResult.exitCode === 0;
				setCachedGhStatus(true, authenticated);

				if (!authenticated) {
					return { authenticated: false, message: GH_NOT_AUTHENTICATED_MESSAGE };
				}

				return { authenticated: true };
			}
		)
	);

	// Submit feedback by writing to an active process
	ipcMain.handle(
		'feedback:submit',
		withIpcErrorLogging(
			handlerOpts('submit'),
			async ({
				sessionId,
				feedbackText,
				attachments,
			}: {
				sessionId: string;
				feedbackText: string;
				attachments?: FeedbackAttachmentInput[];
			}): Promise<{ success: boolean; error?: string }> => {
				if (!sessionId || typeof sessionId !== 'string') {
					return { success: false, error: 'No target agent was selected.' };
				}

				const trimmedFeedback = typeof feedbackText === 'string' ? feedbackText.trim() : '';
				if (!trimmedFeedback) {
					return { success: false, error: 'Feedback cannot be empty.' };
				}
				if (trimmedFeedback.length > 5000) {
					return { success: false, error: 'Feedback exceeds the maximum length (5000).' };
				}

				const processManager = getProcessManager();
				if (!processManager) {
					return { success: false, error: 'Agent process not available' };
				}

				const normalizedAttachments = Array.isArray(attachments)
					? attachments.filter(
							(attachment): attachment is FeedbackAttachmentInput =>
								Boolean(attachment) &&
								typeof attachment.name === 'string' &&
								typeof attachment.dataUrl === 'string' &&
								attachment.dataUrl.startsWith('data:image/')
						)
					: [];
				const tempImagePaths = normalizedAttachments
					.map((attachment, index) => saveImageToTempFile(attachment.dataUrl, index))
					.filter((filePath): filePath is string => Boolean(filePath));
				const imagePromptPrefix = buildImagePromptPrefix(tempImagePaths);
				if (tempImagePaths.length > 0) {
					const cleanupTimer = setTimeout(() => cleanupTempFiles(tempImagePaths), 60 * 60 * 1000);
					cleanupTimer.unref?.();
				}

				const promptTemplate = await fs.readFile(getPromptPath(), 'utf-8');
				const attachmentContext =
					tempImagePaths.length > 0
						? tempImagePaths.map((filePath) => `- ${filePath}`).join('\n')
						: 'None';
				const finalPrompt = `${imagePromptPrefix}${promptTemplate
					.replace('{{FEEDBACK}}', trimmedFeedback)
					.replace('{{ATTACHMENT_CONTEXT}}', attachmentContext)}`;
				const writeSuccess = processManager.write(sessionId, `${finalPrompt}\n`);

				if (!writeSuccess) {
					return { success: false, error: 'Agent process not available' };
				}

				return { success: true };
			}
		)
	);
}
