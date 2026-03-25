import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackView } from '../../../renderer/components/FeedbackView';
import type { Session, Theme } from '../../../renderer/types';

const theme: Theme = {
	id: 'test-dark',
	name: 'Test Dark',
	mode: 'dark',
	colors: {
		bgMain: '#101322',
		bgSidebar: '#14192d',
		bgActivity: '#1b2140',
		textMain: '#f5f7ff',
		textDim: '#8d96b8',
		accent: '#8b5cf6',
		accentForeground: '#ffffff',
		border: '#2a3154',
		success: '#22c55e',
		warning: '#f59e0b',
		error: '#ef4444',
		info: '#3b82f6',
		bgAccentHover: '#6d28d9',
	},
};

const sessions = [
	{
		id: 'session-1',
		name: 'tester2',
		toolType: 'codex',
		state: 'idle',
		cwd: '/tmp/project',
		agentSessionId: '019d26d2-6a6b-7ba0-bc9d-b5f884837d76',
		aiTabs: [
			{
				id: 'tab-1',
				agentSessionId: '019d26d2-6a6b-7ba0-bc9d-b5f884837d76',
			},
		],
		activeTabId: 'tab-1',
	} as Session,
];

class MockFileReader {
	onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
	result: string | ArrayBuffer | null = null;
	readAsDataURL(file: Blob) {
		this.result = `data:${file.type};base64,mock-${(file as File).name}`;
		this.onload?.({
			target: {
				result: this.result,
			},
		} as ProgressEvent<FileReader>);
	}
}

describe('FeedbackView', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.maestro.feedback.checkGhAuth.mockResolvedValue({ authenticated: true });
		window.maestro.feedback.submit.mockResolvedValue({ success: true });
		window.maestro.process.spawn.mockResolvedValue({ success: true, pid: 12345 });
		window.maestro.process.getActiveProcesses.mockResolvedValue([
			{
				sessionId: 'session-1',
				toolType: 'codex',
				pid: 12345,
				cwd: '/tmp/project',
				isTerminal: false,
				isBatchMode: false,
			},
		]);
		window.maestro.agents.get.mockResolvedValue({
			id: 'codex',
			name: 'Codex',
			available: true,
			path: '/usr/local/bin/codex',
			command: 'codex',
			args: [],
		});
		vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
	});

	it('accepts dropped screenshots and submits them with feedback text', async () => {
		render(
			<FeedbackView
				theme={theme}
				sessions={sessions}
				onCancel={vi.fn()}
				onSubmitSuccess={vi.fn()}
			/>
		);

		await screen.findByLabelText(/feedback/i);

		const file = new File(['image-bytes'], 'bug.png', { type: 'image/png' });
		fireEvent.drop(screen.getByTestId('feedback-attachment-dropzone'), {
			dataTransfer: {
				files: [file],
			},
		});

		await waitFor(() => {
			expect(screen.getByText('bug.png')).toBeInTheDocument();
		});

		fireEvent.change(screen.getByLabelText(/feedback/i), {
			target: { value: 'The feedback modal crashes on open.' },
		});
		fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));

		await waitFor(() => {
			expect(window.maestro.feedback.submit).toHaveBeenCalledWith(
				'session-1',
				'The feedback modal crashes on open.',
				[
					expect.objectContaining({
						name: 'bug.png',
						dataUrl: 'data:image/png;base64,mock-bug.png',
					}),
				]
			);
		});
	});

	it('hides stale idle sessions that do not have a live process', async () => {
		window.maestro.process.getActiveProcesses.mockResolvedValue([]);
		window.maestro.agents.get.mockResolvedValue(null);
		const noResumeSessions = [
			{
				...sessions[0],
				agentSessionId: undefined,
				aiTabs: [{ id: 'tab-1', agentSessionId: null }],
				activeTabId: 'tab-1',
			} as Session,
		];

		render(
			<FeedbackView
				theme={theme}
				sessions={noResumeSessions}
				onCancel={vi.fn()}
				onSubmitSuccess={vi.fn()}
			/>
		);

		await waitFor(() => {
			expect(screen.getByText(/no live or resumable ai sessions are available yet/i)).toBeInTheDocument();
		});

		expect(screen.queryByLabelText(/feedback/i)).not.toBeInTheDocument();
	});

	it('resumes a session with agent history when no live process is attached', async () => {
		window.maestro.process.getActiveProcesses.mockResolvedValue([]);

		render(
			<FeedbackView
				theme={theme}
				sessions={sessions}
				onCancel={vi.fn()}
				onSubmitSuccess={vi.fn()}
			/>
		);

		const targetSelect = await screen.findByLabelText(/target agent/i);
		expect(targetSelect).toHaveDisplayValue(/tester2 \(codex, will resume\)/i);

		fireEvent.change(screen.getByLabelText(/feedback/i), {
			target: { value: 'Please file a bug for this issue.' },
		});
		fireEvent.click(screen.getByRole('button', { name: /send feedback/i }));

		await waitFor(() => {
			expect(window.maestro.feedback.submit).toHaveBeenCalledWith(
				'session-1',
				'Please file a bug for this issue.',
				[]
			);
		});
		expect(window.maestro.process.spawn).not.toHaveBeenCalled();
	});
});
