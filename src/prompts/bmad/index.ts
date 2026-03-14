/**
 * BMAD prompts module
 *
 * Bundled prompts from bmad-code-org/BMAD-METHOD.
 * These workflow prompts are generated from the upstream module catalogs and
 * imported at build time using Vite's glob + raw loading.
 *
 * Source: https://github.com/bmad-code-org/BMAD-METHOD
 */

import metadataJson from './metadata.json';
import { bmadCatalog, type BmadCatalogEntry } from './catalog';

const promptModules = import.meta.glob('./bmad.*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export interface BmadCommandDefinition {
	id: string;
	command: string;
	description: string;
	prompt: string;
	isCustom: boolean;
}

export interface BmadMetadata {
	lastRefreshed: string;
	commitSha: string;
	sourceVersion: string;
	sourceUrl: string;
}

function getPromptForEntry(entry: BmadCatalogEntry): string {
	return promptModules[`./bmad.${entry.id}.md`] ?? `# ${entry.name}\n\nPrompt not available.`;
}

/**
 * All bundled BMAD commands.
 */
export const bmadCommands: BmadCommandDefinition[] = bmadCatalog.map((entry) => ({
	id: entry.id,
	command: entry.command,
	description: entry.description,
	prompt: getPromptForEntry(entry),
	isCustom: entry.isCustom,
}));

/**
 * Get a BMAD command by ID.
 */
export function getBmadCommand(id: string): BmadCommandDefinition | undefined {
	return bmadCommands.find((cmd) => cmd.id === id);
}

/**
 * Get a BMAD command by slash command string.
 */
export function getBmadCommandBySlash(command: string): BmadCommandDefinition | undefined {
	return bmadCommands.find((cmd) => cmd.command === command);
}

/**
 * Get the metadata for bundled BMAD prompts.
 */
export function getBmadMetadata(): BmadMetadata {
	return {
		lastRefreshed: metadataJson.lastRefreshed,
		commitSha: metadataJson.commitSha,
		sourceVersion: metadataJson.sourceVersion,
		sourceUrl: metadataJson.sourceUrl,
	};
}
