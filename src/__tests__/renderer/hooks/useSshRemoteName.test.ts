import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSshRemoteName } from '../../../renderer/hooks/mainPanel/useSshRemoteName';

const mockGetConfigs = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	(window as any).maestro = {
		sshRemote: {
			getConfigs: mockGetConfigs,
		},
	};
});

describe('useSshRemoteName', () => {
	it('returns null when SSH is not enabled', () => {
		const { result } = renderHook(() => useSshRemoteName(false, 'remote-1'));
		expect(result.current).toBeNull();
	});

	it('returns null when remoteId is undefined', () => {
		const { result } = renderHook(() => useSshRemoteName(true, undefined));
		expect(result.current).toBeNull();
	});

	it('returns null when remoteId is null', () => {
		const { result } = renderHook(() => useSshRemoteName(true, null));
		expect(result.current).toBeNull();
	});

	it('resolves remote name from configs', async () => {
		mockGetConfigs.mockResolvedValue({
			success: true,
			configs: [{ id: 'remote-1', name: 'My Server' }],
		});

		const { result } = renderHook(() => useSshRemoteName(true, 'remote-1'));

		await waitFor(() => {
			expect(result.current).toBe('My Server');
		});
	});

	it('returns null when remote is not found in configs', async () => {
		mockGetConfigs.mockResolvedValue({
			success: true,
			configs: [{ id: 'other-remote', name: 'Other' }],
		});

		const { result } = renderHook(() => useSshRemoteName(true, 'remote-1'));

		await waitFor(() => {
			expect(mockGetConfigs).toHaveBeenCalled();
		});
		expect(result.current).toBeNull();
	});

	it('returns null when getConfigs fails', async () => {
		mockGetConfigs.mockRejectedValue(new Error('Network error'));

		const { result } = renderHook(() => useSshRemoteName(true, 'remote-1'));

		await waitFor(() => {
			expect(mockGetConfigs).toHaveBeenCalled();
		});
		expect(result.current).toBeNull();
	});

	it('returns null when getConfigs returns unsuccessful result', async () => {
		mockGetConfigs.mockResolvedValue({ success: false });

		const { result } = renderHook(() => useSshRemoteName(true, 'remote-1'));

		await waitFor(() => {
			expect(mockGetConfigs).toHaveBeenCalled();
		});
		expect(result.current).toBeNull();
	});

	it('resets to null when SSH is disabled', async () => {
		mockGetConfigs.mockResolvedValue({
			success: true,
			configs: [{ id: 'remote-1', name: 'My Server' }],
		});

		const { result, rerender } = renderHook(({ enabled, id }) => useSshRemoteName(enabled, id), {
			initialProps: { enabled: true as boolean | undefined, id: 'remote-1' as string | undefined },
		});

		await waitFor(() => {
			expect(result.current).toBe('My Server');
		});

		rerender({ enabled: false, id: 'remote-1' });
		expect(result.current).toBeNull();
	});
});
