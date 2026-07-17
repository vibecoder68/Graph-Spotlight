import { App } from "obsidian";
import { HighlightEntry, SpotlightGraphState } from "../types";

type ResolvedLinks = Record<string, Record<string, number>>;

export class GraphIndex {
	private adjacency = new Map<string, Set<string>>();
	private dirty = true;

	constructor(private readonly app: App) {}

	invalidate(): void {
		this.dirty = true;
	}

	build(highlights: HighlightEntry[]): SpotlightGraphState {
		const highlightByPath = new Map<string, HighlightEntry[]>();
		const connectedByPath = new Map<string, HighlightEntry[]>();
		const edgeColors = new Map<string, string[]>();

		for (const highlight of highlights) {
			pushMapValue(highlightByPath, highlight.filePath, highlight);
		}

		if (highlights.length > 0) {
			this.ensureAdjacency();
		}

		for (const highlight of highlights) {
			const connectedPaths = this.adjacency.get(highlight.filePath);
			if (!connectedPaths) continue;

			for (const connectedPath of connectedPaths) {
				pushUniqueHighlight(connectedByPath, connectedPath, highlight);
				pushUniqueColor(edgeColors, edgeKey(highlight.filePath, connectedPath), highlight.color);
			}
		}

		return {
			highlights,
			highlightByPath,
			connectedByPath,
			edgeColors,
			hasHighlights: highlights.length > 0,
		};
	}

	private ensureAdjacency(): void {
		if (!this.dirty) return;
		const adjacency = new Map<string, Set<string>>();
		const resolvedLinks = this.getResolvedLinks();

		for (const [sourcePath, outgoing] of Object.entries(resolvedLinks)) {
			for (const targetPath of Object.keys(outgoing)) {
				pushAdjacent(adjacency, sourcePath, targetPath);
				pushAdjacent(adjacency, targetPath, sourcePath);
			}
		}

		this.adjacency = adjacency;
		this.dirty = false;
	}

	private getResolvedLinks(): ResolvedLinks {
		const cache = this.app.metadataCache as unknown as { resolvedLinks?: ResolvedLinks };
		return cache.resolvedLinks ?? {};
	}
}

export function edgeKey(a: string, b: string): string {
	return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function pushMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(value);
		return;
	}
	map.set(key, [value]);
}

function pushUniqueHighlight(map: Map<string, HighlightEntry[]>, key: string, value: HighlightEntry): void {
	const existing = map.get(key);
	if (existing) {
		if (!existing.some((entry) => entry.id === value.id)) existing.push(value);
		return;
	}
	map.set(key, [value]);
}

function pushUniqueColor(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) {
		if (!existing.includes(value)) existing.push(value);
		return;
	}
	map.set(key, [value]);
}

function pushAdjacent(map: Map<string, Set<string>>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) {
		existing.add(value);
		return;
	}
	map.set(key, new Set([value]));
}
