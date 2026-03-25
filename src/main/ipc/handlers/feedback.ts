/**
 * Feedback IPC Handlers
 *
 * This module handles:
 * - Checking GitHub CLI availability and authentication
 * - Submitting feedback text to the selected agent as a structured prompt
 */

import { ipcMain, app } from 'electron';
import fs from 'fs/promises';
import os from 'os';
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

const LOG_CONTEXT = '[Feedback]';
const ATTACHMENTS_REPO = 'maestro-feedback-attachments';

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
	getProcessManager: () => unknown;
}

export interface FeedbackAttachmentInput {
	name: string;
	dataUrl: string;
}

async function getGitHubLogin(): Promise<string> {
	const result = await execFileNoThrow('gh', ['api', 'user', '--jq', '.login'], undefined, getExpandedEnv());
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		throw new Error(result.stderr || 'Failed to resolve GitHub login.');
	}
	return result.stdout.trim();
}

function parseAttachmentDataUrl(attachment: FeedbackAttachmentInput): { base64: string; filename: string } {
	const match = attachment.dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
	if (!match) {
		throw new Error(`Unsupported image data for ${attachment.name}.`);
	}

	const extension = match[1].replace('jpeg', 'jpg');
	const hasExtension = /\.[a-zA-Z0-9]+$/.test(attachment.name);
	const filename = hasExtension ? attachment.name : `${attachment.name}.${extension}`;
	return { base64: match[2], filename };
}

async function ensureAttachmentsRepo(owner: string): Promise<void> {
	const repoCheck = await execFileNoThrow(
		'gh',
		['api', `repos/${owner}/${ATTACHMENTS_REPO}`],
		undefined,
		getExpandedEnv()
	);
	if (repoCheck.exitCode === 0) {
		return;
	}

	const repoCreate = await execFileNoThrow(
		'gh',
		[
			'api',
			'user/repos',
			'--method',
			'POST',
			'-f',
			`name=${ATTACHMENTS_REPO}`,
			'-F',
			'private=false',
			'-F',
			'has_issues=false',
			'-f',
			'description=Public image host for Maestro feedback issue attachments',
		],
		undefined,
		getExpandedEnv()
	);
	if (repoCreate.exitCode !== 0 && !repoCreate.stderr.includes('name already exists')) {
		throw new Error(repoCreate.stderr || 'Failed to create screenshot attachment repository.');
	}
}

async function uploadAttachments(
	attachments: FeedbackAttachmentInput[]
): Promise<{ markdown: string }> {
	if (attachments.length === 0) {
		return { markdown: 'None' };
	}

	const owner = await getGitHubLogin();
	await ensureAttachmentsRepo(owner);

	const uploadedMarkdown = [];
	for (let index = 0; index < attachments.length; index += 1) {
		const attachment = attachments[index];
		const { base64, filename } = parseAttachmentDataUrl(attachment);
		const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
		const repoPath = `feedback/${Date.now()}-${index}-${safeFilename}`;
		const payloadPath = path.join(os.tmpdir(), `maestro-feedback-upload-${Date.now()}-${index}.json`);
		await fs.writeFile(
			payloadPath,
			JSON.stringify({
				message: `Add feedback screenshot ${Date.now()}-${index}`,
				content: base64,
			}),
			'utf8'
		);
		const uploadResult = await execFileNoThrow(
			'gh',
			[
				'api',
				`repos/${owner}/${ATTACHMENTS_REPO}/contents/${repoPath}`,
				'--method',
				'PUT',
				'--input',
				payloadPath,
			],
			undefined,
			getExpandedEnv()
		);
		await fs.unlink(payloadPath).catch(() => {});
		if (uploadResult.exitCode !== 0) {
			throw new Error(uploadResult.stderr || `Failed to upload screenshot ${attachment.name}.`);
		}
		const uploadJson = JSON.parse(uploadResult.stdout);
		const rawUrl =
			uploadJson.content?.download_url ||
			`https://raw.githubusercontent.com/${owner}/${ATTACHMENTS_REPO}/main/${repoPath}`;
		uploadedMarkdown.push(`![${attachment.name}](${rawUrl})`);
	}

	return { markdown: uploadedMarkdown.join('\n\n') };
}

async function composeFeedbackPrompt(
	feedbackText: string,
	attachments: FeedbackAttachmentInput[]
): Promise<{ prompt: string }> {
	const { markdown } = await uploadAttachments(attachments);
	const promptTemplate = await fs.readFile(getPromptPath(), 'utf-8');
	const prompt = promptTemplate
		.replace('{{FEEDBACK}}', feedbackText)
		.replace('{{ATTACHMENT_CONTEXT}}', markdown);
	return { prompt };
}

async function ensureFeedbackLabel(): Promise<void> {
	const labelCheck = await execFileNoThrow(
		'gh',
		['api', 'repos/RunMaestro/Maestro/labels/Maestro-feedback'],
		undefined,
		getExpandedEnv()
	);
	if (labelCheck.exitCode === 0) {
		return;
	}

	const labelCreate = await execFileNoThrow(
		'gh',
		[
			'label',
			'create',
			'Maestro-feedback',
			'-R',
			'RunMaestro/Maestro',
			'--color',
			'663579',
			'--description',
			'Feedback issues filed from the Maestro in-app feedback flow',
		],
		undefined,
		getExpandedEnv()
	);
	if (labelCreate.exitCode !== 0 && !labelCreate.stderr.includes('already exists')) {
		throw new Error(labelCreate.stderr || 'Failed to ensure Maestro-feedback label exists.');
	}
}

function buildIssueTitle(feedbackText: string): string {
	const firstLine = feedbackText
		.split('\n')
		.map((line) => line.trim())
		.find(Boolean);
	const baseTitle = firstLine || 'Feedback submission';
	const compact = baseTitle.replace(/\s+/g, ' ');
	const trimmed = compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
	return trimmed.toLowerCase().startsWith('bug:')
		? trimmed
		: `General feedback: ${trimmed}`;
}

function buildIssueBody(feedbackText: string, attachmentMarkdown: string): string {
	const sections = [`## Description\n${feedbackText}`];
	if (attachmentMarkdown !== 'None') {
		sections.push(`## Screenshots\n${attachmentMarkdown}`);
	}
	sections.push('## Expected vs Current Behavior\nNot provided.');
	sections.push('## Impact and Priority\nNot provided.');
	return sections.join('\n\n');
}

/**
 * Register feedback IPC handlers.
 */
export function registerFeedbackHandlers(_deps: FeedbackHandlerDependencies): void {
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

				const normalizedAttachments = Array.isArray(attachments)
					? attachments.filter(
							(attachment): attachment is FeedbackAttachmentInput =>
								Boolean(attachment) &&
								typeof attachment.name === 'string' &&
								typeof attachment.dataUrl === 'string' &&
								attachment.dataUrl.startsWith('data:image/')
						)
					: [];
				const { markdown } = await uploadAttachments(normalizedAttachments);
				await ensureFeedbackLabel();

				const bodyPath = path.join(os.tmpdir(), `maestro-feedback-body-${Date.now()}.md`);
				await fs.writeFile(bodyPath, buildIssueBody(trimmedFeedback, markdown), 'utf8');
				const issueCreate = await execFileNoThrow(
					'gh',
					[
						'issue',
						'create',
						'-R',
						'RunMaestro/Maestro',
						'--title',
						buildIssueTitle(trimmedFeedback),
						'--body-file',
						bodyPath,
						'--label',
						'Maestro-feedback',
					],
					undefined,
					getExpandedEnv()
				);
				await fs.unlink(bodyPath).catch(() => {});
				if (issueCreate.exitCode !== 0) {
					return { success: false, error: issueCreate.stderr || 'Failed to create GitHub issue.' };
				}

				return { success: true };
			}
		)
	);

	ipcMain.handle(
		'feedback:compose-prompt',
		withIpcErrorLogging(
			handlerOpts('compose-prompt'),
			async ({
				feedbackText,
				attachments,
			}: {
				feedbackText: string;
				attachments?: FeedbackAttachmentInput[];
			}): Promise<{ prompt: string }> => {
				const trimmedFeedback = typeof feedbackText === 'string' ? feedbackText.trim() : '';
				if (!trimmedFeedback) {
					throw new Error('Feedback cannot be empty.');
				}
				if (trimmedFeedback.length > 5000) {
					throw new Error('Feedback exceeds the maximum length (5000).');
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

				const { prompt } = await composeFeedbackPrompt(trimmedFeedback, normalizedAttachments);

				return { prompt };
			}
		)
	);
}
