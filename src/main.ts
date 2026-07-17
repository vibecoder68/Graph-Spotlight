import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { GraphIndex } from "./graph/GraphIndex";
import { GraphOverlay } from "./ui/GraphOverlay";
import { GraphRendererAdapter, getGraphContainer, graphViewEnabled, isSupportedGraphLeaf } from "./graph/GraphRendererAdapter";
import { SaveSetModal } from "./ui/SaveSetModal";
import { GraphSpotlightSettingTab } from "./ui/SettingsTab";
import {
	DEFAULT_SETTINGS,
	FileSuggestion,
	GraphRendererAdapterSettings,
	GraphSpotlightSettings,
	HighlightEntry,
} from "./types";
import { normalizeHexColor, pickVibrantColor } from "./utils/colors";
import { createId, pluralize } from "./utils/dom";

interface ClearOptions {
	silent?: boolean;
	skipGraphRefresh?: boolean;
}

interface ApplyOptions {
	refreshOverlays?: boolean;
	requestGraphRender?: boolean;
}

interface SearchRecord {
	file: TFile;
	basename: string;
	path: string;
}

type LegacyGraphSpotlightSettings = Partial<GraphSpotlightSettings> & {
	dimUnrelated?: boolean;
	dimOpacity?: number;
};

export default class GraphSpotlightPlugin extends Plugin {
	settings: GraphSpotlightSettings = { ...DEFAULT_SETTINGS, vibrantColors: [...DEFAULT_SETTINGS.vibrantColors] };
	highlights: HighlightEntry[] = [];

	private graphIndex!: GraphIndex;
	private rendererAdapter!: GraphRendererAdapter;
	private readonly overlays = new Map<WorkspaceLeaf, GraphOverlay>();
	private refreshTimer: number | null = null;
	private applyTimer: number | null = null;
	private pendingGraphRenderRequest = false;
	private lastActiveFilePath: string | null = null;
	private searchRecords: SearchRecord[] = [];
	private searchIndexDirty = true;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.graphIndex = new GraphIndex(this.app);
		this.rendererAdapter = new GraphRendererAdapter(this.app);

		this.addSettingTab(new GraphSpotlightSettingTab(this.app, this));

		this.addCommand({
			id: "clear-spotlights",
			name: "Clear spotlights",
			callback: () => this.clearHighlights(),
		});
		this.addCommand({
			id: "save-current-set",
			name: "Save current spotlight set",
			callback: () => this.promptSaveCurrentSet(),
		});
		this.addCommand({
			id: "refresh-rendering",
			name: "Refresh spotlight rendering",
			callback: () => this.refreshGraphViews(),
		});

		this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.handleFileOpen(file)));
		this.registerEvent(this.app.vault.on("create", () => this.handleVaultFilesChanged()));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file)));
		this.registerEvent(this.app.metadataCache.on("resolved", () => {
			this.graphIndex.invalidate();
			if (this.highlights.length > 0) this.scheduleApplyHighlights(300);
		}));

		this.app.workspace.onLayoutReady(() => this.refreshGraphViews());
	}

	onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.applyTimer !== null) {
			window.clearTimeout(this.applyTimer);
			this.applyTimer = null;
		}

		for (const overlay of this.overlays.values()) {
			overlay.destroy();
		}
		this.overlays.clear();
		this.rendererAdapter.restoreAll();
	}

	async loadSettings(): Promise<void> {
		const loaded = normalizeLoadedSettings(await this.loadData());
		const legacy = loaded;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded ?? {}),
			recolorUnrelated: legacy?.recolorUnrelated ?? legacy?.dimUnrelated ?? DEFAULT_SETTINGS.recolorUnrelated,
			unrelatedColor: normalizeHexColor(legacy?.unrelatedColor ?? "") ?? DEFAULT_SETTINGS.unrelatedColor,
			unrelatedNodeOpacity: legacy?.unrelatedNodeOpacity ?? legacy?.dimOpacity ?? DEFAULT_SETTINGS.unrelatedNodeOpacity,
			unrelatedLinkOpacity:
				legacy?.unrelatedLinkOpacity ??
				(typeof legacy?.dimOpacity === "number" ? Math.max(0.2, legacy.dimOpacity * 1.8) : DEFAULT_SETTINGS.unrelatedLinkOpacity),
			colorLinks: loaded?.colorLinks ?? DEFAULT_SETTINGS.colorLinks,
			crowdedNoteThreshold: Math.max(2, loaded?.crowdedNoteThreshold ?? DEFAULT_SETTINGS.crowdedNoteThreshold),
			crowdedNoteColor: normalizeHexColor(loaded?.crowdedNoteColor ?? "") ?? DEFAULT_SETTINGS.crowdedNoteColor,
			vibrantColors: sanitizeColorPool(loaded?.vibrantColors) ?? [...DEFAULT_SETTINGS.vibrantColors],
			savedSets: Array.isArray(loaded?.savedSets) ? loaded.savedSets : [],
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshGraphViews(): void {
		const seen = new Set<WorkspaceLeaf>();
		let supportedGraphCount = 0;
		let createdOverlay = false;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!isSupportedGraphLeaf(leaf)) return;
			if (!graphViewEnabled(leaf, this.settings.enableGlobalGraph, this.settings.enableLocalGraph)) return;
			supportedGraphCount += 1;
			seen.add(leaf);

			if (!this.settings.showSearchBar) return;
			if (this.overlays.has(leaf)) return;

			const host = getGraphContainer(leaf);
			if (!host) return;
			this.overlays.set(leaf, new GraphOverlay(this, leaf, host));
			createdOverlay = true;
		});

		for (const [leaf, overlay] of Array.from(this.overlays.entries())) {
			if (!seen.has(leaf) || !this.settings.showSearchBar) {
				overlay.destroy();
				this.overlays.delete(leaf);
			}
		}

		if (supportedGraphCount === 0 && this.settings.clearOnGraphClose && this.highlights.length > 0) {
			this.clearHighlights({ silent: true, skipGraphRefresh: true });
			return;
		}

		this.refreshOverlays();
		if (createdOverlay && this.highlights.length > 0) this.scheduleApplyHighlights(250);
	}

	refreshOverlays(): void {
		for (const overlay of this.overlays.values()) {
			overlay.refresh();
		}
	}

	resetGraphRendering(): void {
		this.rendererAdapter.restoreAll();
	}

	applyHighlights(options: ApplyOptions | boolean = true): void {
		const normalizedOptions =
			typeof options === "boolean" ? { refreshOverlays: options, requestGraphRender: false } : options;

		if (normalizedOptions.refreshOverlays ?? true) this.refreshOverlays();
		this.scheduleApplyHighlights(80, normalizedOptions.requestGraphRender ?? false);
	}

	addHighlightByPath(filePath: string): void {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice("That note is no longer available.");
			return;
		}

		if (this.highlights.some((highlight) => highlight.filePath === file.path)) {
			new Notice(`${file.basename} is already highlighted.`);
			return;
		}

		if (this.highlights.length >= this.settings.maxHighlights) {
			new Notice(`Graph Spotlight is limited to ${pluralize(this.settings.maxHighlights, "active highlight")} for now.`);
			return;
		}

		this.highlights = [
			...this.highlights,
			{
				id: createId("highlight"),
				filePath: file.path,
				label: file.basename,
				color: pickVibrantColor(
					this.highlights.map((highlight) => highlight.color),
					this.settings.vibrantColors,
				),
				createdAt: Date.now(),
			},
		];
		this.applyHighlights({ requestGraphRender: true });
	}

	removeHighlight(id: string): void {
		const next = this.highlights.filter((highlight) => highlight.id !== id);
		if (next.length === this.highlights.length) return;
		this.highlights = next;
		this.applyHighlights({ requestGraphRender: true });
	}

	updateHighlightColor(id: string, color: string): void {
		const normalized = normalizeHexColor(color);
		if (!normalized) return;
		this.highlights = this.highlights.map((highlight) =>
			highlight.id === id ? { ...highlight, color: normalized } : highlight,
		);
		this.applyHighlights({ requestGraphRender: true });
	}

	clearHighlights(options: ClearOptions = {}): void {
		if (this.highlights.length === 0) return;
		this.highlights = [];
		this.rendererAdapter.applyToOpenGraphs(this.graphIndex.build(this.highlights), this.getRendererSettings(), (leaf) =>
			graphViewEnabled(leaf, this.settings.enableGlobalGraph, this.settings.enableLocalGraph),
			true,
		);
		this.refreshOverlays();
		if (!options.silent) new Notice("Graph spotlights cleared.");
		if (!options.skipGraphRefresh) this.refreshOverlays();
	}

	trimHighlights(maxHighlights: number): void {
		if (this.highlights.length <= maxHighlights) return;
		this.highlights = this.highlights.slice(0, maxHighlights);
		this.applyHighlights({ requestGraphRender: true });
	}

	promptSaveCurrentSet(): void {
		if (this.highlights.length === 0) {
			new Notice("Add at least one graph spotlight before saving a set.");
			return;
		}
		new SaveSetModal(this.app, (name) => {
			void this.saveCurrentSet(name);
		}).open();
	}

	async saveCurrentSet(name: string): Promise<void> {
		const normalizedName = name.trim();
		if (!normalizedName) return;

		const now = Date.now();
		const highlights = this.highlights.map((highlight) => ({
			filePath: highlight.filePath,
			label: highlight.label,
			color: highlight.color,
		}));
		const existing = this.settings.savedSets.find((set) => set.name.toLowerCase() === normalizedName.toLowerCase());

		if (existing) {
			existing.name = normalizedName;
			existing.updatedAt = now;
			existing.highlights = highlights;
		} else {
			this.settings.savedSets = [
				...this.settings.savedSets,
				{
					id: createId("set"),
					name: normalizedName,
					createdAt: now,
					updatedAt: now,
					highlights,
				},
			];
		}

		await this.saveSettings();
		new Notice(`Saved ${normalizedName}.`);
	}

	loadSavedSet(id: string): void {
		const set = this.settings.savedSets.find((candidate) => candidate.id === id);
		if (!set) return;

		const missing: string[] = [];
		const highlights: HighlightEntry[] = [];

		for (const saved of set.highlights.slice(0, this.settings.maxHighlights)) {
			const file = this.app.vault.getAbstractFileByPath(saved.filePath);
			if (!(file instanceof TFile)) {
				missing.push(saved.label);
				continue;
			}

			highlights.push({
				id: createId("highlight"),
				filePath: file.path,
				label: file.basename,
				color: normalizeHexColor(saved.color) ?? pickVibrantColor([], this.settings.vibrantColors),
				createdAt: Date.now(),
			});
		}

		this.highlights = highlights;
		this.applyHighlights({ requestGraphRender: true });

		if (missing.length > 0) {
			new Notice(`Loaded ${set.name}; ${pluralize(missing.length, "note")} could not be found.`);
		} else {
			new Notice(`Loaded ${set.name}.`);
		}
	}

	searchFiles(query: string, limit: number): FileSuggestion[] {
		const normalizedQuery = normalizeSearch(query);
		if (!normalizedQuery) return [];

		return this.getSearchRecords()
			.map((record) => scoreFile(record, normalizedQuery))
			.filter((suggestion): suggestion is FileSuggestion => suggestion !== null)
			.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
			.slice(0, limit);
	}

	findFileBySearch(query: string): TFile | null {
		const normalizedQuery = normalizeSearch(query);
		if (!normalizedQuery) return null;

		const exact = this.getSearchRecords().find((record) => {
			return record.basename === normalizedQuery || record.path === normalizedQuery;
		});
		if (exact) return exact.file;

		const first = this.searchFiles(query, 1).first();
		if (!first) return null;
		const file = this.app.vault.getAbstractFileByPath(first.filePath);
		return file instanceof TFile ? file : null;
	}

	private scheduleRefresh(delay = 120): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshGraphViews();
		}, delay);
	}

	private scheduleApplyHighlights(delay = 80, requestGraphRender = false): void {
		this.pendingGraphRenderRequest = this.pendingGraphRenderRequest || requestGraphRender;
		if (this.applyTimer !== null) window.clearTimeout(this.applyTimer);
		const effectiveDelay = requestGraphRender ? 0 : delay;
		this.applyTimer = window.setTimeout(() => {
			this.applyTimer = null;
			const shouldRequestGraphRender = this.pendingGraphRenderRequest;
			this.pendingGraphRenderRequest = false;
			this.applyHighlightsNow(shouldRequestGraphRender);
		}, effectiveDelay);
	}

	private applyHighlightsNow(requestGraphRender = false): void {
		const state = this.graphIndex.build(this.highlights);
		this.rendererAdapter.applyToOpenGraphs(state, this.getRendererSettings(), (leaf) =>
			graphViewEnabled(leaf, this.settings.enableGlobalGraph, this.settings.enableLocalGraph),
			requestGraphRender,
		);
	}

	private handleFileOpen(file: TFile | null): void {
		const nextPath = file?.path ?? null;
		const previousPath = this.lastActiveFilePath;

		if (!nextPath && previousPath && this.settings.clearOnActiveNoteClose) {
			this.clearHighlights({ silent: true });
		} else if (
			nextPath &&
			previousPath &&
			nextPath !== previousPath &&
			this.settings.clearOnActiveNoteChange
		) {
			this.clearHighlights({ silent: true });
		}

		this.lastActiveFilePath = nextPath;
		this.scheduleRefresh(50);
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		this.rendererAdapter.invalidatePathCache();
		this.graphIndex.invalidate();
		this.searchIndexDirty = true;
		if (!(file instanceof TFile)) return;

		let changed = false;
		this.highlights = this.highlights.map((highlight) => {
			if (highlight.filePath !== oldPath) return highlight;
			changed = true;
			return { ...highlight, filePath: file.path, label: file.basename };
		});

		for (const set of this.settings.savedSets) {
			for (const highlight of set.highlights) {
				if (highlight.filePath === oldPath) {
					highlight.filePath = file.path;
					highlight.label = file.basename;
					set.updatedAt = Date.now();
					changed = true;
				}
			}
		}

		if (changed) {
			void this.saveSettings();
			this.applyHighlights({ requestGraphRender: true });
		}
	}

	private handleDelete(file: TAbstractFile): void {
		this.rendererAdapter.invalidatePathCache();
		this.graphIndex.invalidate();
		this.searchIndexDirty = true;
		if (!(file instanceof TFile)) return;
		const next = this.highlights.filter((highlight) => highlight.filePath !== file.path);
		if (next.length === this.highlights.length) return;
		this.highlights = next;
		this.applyHighlights({ requestGraphRender: true });
	}

	private handleVaultFilesChanged(): void {
		this.rendererAdapter.invalidatePathCache();
		this.graphIndex.invalidate();
		this.searchIndexDirty = true;
		if (this.highlights.length > 0) this.scheduleApplyHighlights(250);
	}

	private getSearchRecords(): SearchRecord[] {
		if (!this.searchIndexDirty) return this.searchRecords;
		this.searchRecords = this.app.vault.getMarkdownFiles().map((file) => ({
			file,
			basename: normalizeSearch(file.basename),
			path: normalizeSearch(file.path),
		}));
		this.searchIndexDirty = false;
		return this.searchRecords;
	}

	private getRendererSettings(): GraphRendererAdapterSettings {
		return {
			recolorUnrelated: this.settings.recolorUnrelated,
			unrelatedColor: this.settings.unrelatedColor,
			unrelatedNodeOpacity: this.settings.unrelatedNodeOpacity,
			unrelatedLinkOpacity: this.settings.unrelatedLinkOpacity,
			colorLinks: this.settings.colorLinks,
			crowdedNoteThreshold: this.settings.crowdedNoteThreshold,
			crowdedNoteColor: this.settings.crowdedNoteColor,
			connectedNodeOpacity: this.settings.connectedNodeOpacity,
			connectedNodeDullness: this.settings.connectedNodeDullness,
			edgeOpacity: this.settings.edgeOpacity,
		};
	}
}

function sanitizeColorPool(colors: string[] | undefined): string[] | null {
	if (!Array.isArray(colors)) return null;
	const normalized = colors
		.map((color) => normalizeHexColor(color))
		.filter((color): color is string => color !== null);
	return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

function normalizeLoadedSettings(value: unknown): LegacyGraphSpotlightSettings | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as LegacyGraphSpotlightSettings;
}

function normalizeSearch(value: string): string {
	return value.toLowerCase().trim().replace(/\.md$/, "");
}

function scoreFile(record: SearchRecord, query: string): FileSuggestion | null {
	const { basename, path, file } = record;
	let score = 0;

	if (basename === query) score = 1000;
	else if (basename.startsWith(query)) score = 850 - basename.length;
	else if (basename.includes(query)) score = 680 - basename.indexOf(query);
	else if (path.includes(query)) score = 480 - path.indexOf(query);
	else {
		const fuzzyScore = fuzzyMatchScore(basename, query);
		if (fuzzyScore > 0) score = fuzzyScore;
	}

	if (score <= 0) return null;

	return {
		filePath: file.path,
		label: file.basename,
		secondary: file.path,
		score,
	};
}

function fuzzyMatchScore(value: string, query: string): number {
	let score = 0;
	let valueIndex = 0;
	let streak = 0;

	for (const char of query) {
		const foundIndex = value.indexOf(char, valueIndex);
		if (foundIndex === -1) return 0;
		streak = foundIndex === valueIndex ? streak + 1 : 0;
		score += 18 + streak * 8 - Math.max(0, foundIndex - valueIndex);
		valueIndex = foundIndex + 1;
	}

	return score;
}
