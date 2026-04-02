import { useState, useEffect } from 'react';

/**
 * Resolves the SSH remote name for display in the header when a session has SSH configured.
 */
export function useSshRemoteName(
	sshEnabled: boolean | undefined,
	remoteId: string | null | undefined
): string | null {
	const [sshRemoteName, setSshRemoteName] = useState<string | null>(null);

	useEffect(() => {
		if (!sshEnabled || !remoteId) {
			setSshRemoteName(null);
			return;
		}

		window.maestro.sshRemote
			.getConfigs()
			.then((result) => {
				if (result.success && result.configs) {
					const remote = result.configs.find((r: { id: string }) => r.id === remoteId);
					setSshRemoteName(remote?.name || null);
				} else {
					setSshRemoteName(null);
				}
			})
			.catch(() => setSshRemoteName(null));
	}, [sshEnabled, remoteId]);

	return sshRemoteName;
}
