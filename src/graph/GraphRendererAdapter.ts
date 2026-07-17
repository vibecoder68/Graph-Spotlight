import { App, WorkspaceLeaf } from "obsidian";
import { edgeKey } from "./GraphIndex";
import { GraphRendererAdapterSettings, SpotlightGraphState } from "../types";
import { hexToPixiRgb, mixHexColors, softenColor } from "../utils/colors";

interface PixiColor {
	rgb: number;
	a: number;
}

interface GraphViewLike {
	getViewType?: () => string;
	containerEl?: HTMLElement;
	contentEl?: HTMLElement;
	renderer?: GraphRendererLike;
	graph?: { renderer?: GraphRendererLike };
	localGraph?: { renderer?: GraphRendererLike };
	engine?: { renderer?: GraphRendererLike };
	dataEngine?: { renderer?: GraphRendererLike };
}

interface GraphRendererLike {
	nodes?: unknown;
	links?: unknown;
	edges?: unknown;
}

type GraphObject = Record<string, unknown>;

interface OriginalNodeStyle {
	color?: unknown;
}

interface OriginalLinkStyle {
	color?: unknown;
	lineColor?: unknown;
}

const STYLE_CHUNK_SIZE = 100;
const STYLE_CHUNK_BUDGET_MS = 3;

export class GraphRendererAdapter {
	private readonly originalNodeStyles = new WeakMap<object, OriginalNodeStyle>();
	private readonly originalLinkStyles = new WeakMap<object, OriginalLinkStyle>();
	private readonly renderers = new Set<GraphRendererLike>();
	private readonly rendererTargets = new WeakMap<GraphRendererLike, HTMLElement>();
	private readonly pathCache = new Map<string, string | null>();
	private readonly pathLookup = new Map<string, string | null>();
	private pathLookupDirty = true;
	private styleRunId = 0;

	constructor(private readonly app: App) {}

	applyToOpenGraphs(
		state: SpotlightGraphState,
		settings: GraphRendererAdapterSettings,
		includeLeaf: (leaf: WorkspaceLeaf) => boolean = () => true,
		requestGraphRender = false,
	): void {
		const runId = ++this.styleRunId;
		if (state.hasHighlights) this.ensurePathLookup();

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!isSupportedGraphLeaf(leaf)) return;
			if (!includeLeaf(leaf)) return;
			const renderer = getRendererFromView(leaf.view as GraphViewLike);
			if (!renderer) return;
			const target = getGraphContainer(leaf);
			if (target) this.rendererTargets.set(renderer, target);
			this.renderers.add(renderer);
			this.applyRenderer(renderer, state, settings, requestGraphRender, target);
		});
	}

	restoreAll(): void {
		const runId = ++this.styleRunId;
		for (const renderer of this.renderers) {
			this.restoreRendererChunked(
				renderer,
				objectValues(renderer.nodes),
				[...objectValues(renderer.links), ...objectValues(renderer.edges)],
				runId,
				true,
				this.rendererTargets.get(renderer) ?? null,
			);
		}
		this.renderers.clear();
	}

	invalidatePathCache(): void {
		this.pathLookupDirty = true;
		this.pathCache.clear();
	}

	private applyRenderer(
		renderer: GraphRendererLike,
		state: SpotlightGraphState,
		settings: GraphRendererAdapterSettings,
		shouldRequestRender: boolean,
		repaintTarget: HTMLElement | null,
	): void {
		const runId = this.styleRunId;
		const nodes = objectValues(renderer.nodes);
		const links = settings.colorLinks ? [...objectValues(renderer.links), ...objectValues(renderer.edges)] : [];

		if (!state.hasHighlights) {
			this.restoreRendererChunked(renderer, nodes, links, runId, shouldRequestRender, repaintTarget);
			return;
		}

		let nodeIndex = 0;
		let linkIndex = 0;
		let nudgedAfterFirstChunk = false;

		const applyChunk = () => {
			if (runId !== this.styleRunId) return;
			try {
				const deadline = performance.now() + STYLE_CHUNK_BUDGET_MS;
				let processed = 0;

				while (
					nodeIndex < nodes.length &&
					processed < STYLE_CHUNK_SIZE &&
					performance.now() < deadline
				) {
					this.applyNodeStyle(nodes[nodeIndex], state, settings);
					nodeIndex += 1;
					processed += 1;
				}

				while (
					nodeIndex >= nodes.length &&
					linkIndex < links.length &&
					processed < STYLE_CHUNK_SIZE &&
					performance.now() < deadline
				) {
					this.applyLinkStyle(links[linkIndex], state, settings);
					linkIndex += 1;
					processed += 1;
				}

				if (shouldRequestRender && processed > 0 && !nudgedAfterFirstChunk) {
					nudgedAfterFirstChunk = true;
					nudgeGraphView(repaintTarget);
				}

				if (nodeIndex < nodes.length || linkIndex < links.length) {
					scheduleChunk(applyChunk, shouldRequestRender);
					return;
				}

				if (shouldRequestRender) nudgeGraphView(repaintTarget);
			} catch (error) {
				console.error("Graph Spotlight failed to apply graph colors. Restoring graph.", error);
				this.restoreRendererChunked(renderer, nodes, links, runId, true, repaintTarget);
			}
		};

		scheduleChunk(applyChunk, shouldRequestRender);
	}

	private applyNodeStyle(node: GraphObject, state: SpotlightGraphState, settings: GraphRendererAdapterSettings): void {
		this.snapshotNode(node);
		const nodePath = this.resolveGraphPath(extractNodePath(node));
		const highlighted = nodePath ? state.highlightByPath.get(nodePath) : undefined;
		const connected = nodePath ? state.connectedByPath.get(nodePath) : undefined;

		if (highlighted && highlighted.length > 0) {
			if (highlighted.length >= settings.crowdedNoteThreshold) {
				setNodeColor(node, settings.crowdedNoteColor, 1);
				return;
			}
			setNodeColor(node, mixHexColors(highlighted.map((entry) => entry.color)), 1);
			return;
		}

		if (connected && connected.length > 0) {
			if (connected.length >= settings.crowdedNoteThreshold) {
				setNodeColor(node, settings.crowdedNoteColor, settings.connectedNodeOpacity);
				return;
			}
			const baseColor = mixHexColors(connected.map((entry) => entry.color));
			const softened = softenColor(baseColor, settings.connectedNodeDullness);
			setNodeColor(node, softened, settings.connectedNodeOpacity);
			return;
		}

		if (settings.recolorUnrelated) {
			setNodeColor(node, settings.unrelatedColor, settings.unrelatedNodeOpacity);
		} else {
			this.restoreNode(node);
		}
	}

	private applyLinkStyle(link: GraphObject, state: SpotlightGraphState, settings: GraphRendererAdapterSettings): void {
		if (!settings.colorLinks) return;
		this.snapshotLink(link);
		const sourcePath = this.resolveGraphPath(extractEndpointPath(link.source));
		const targetPath = this.resolveGraphPath(extractEndpointPath(link.target));
		const colors = sourcePath && targetPath ? state.edgeColors.get(edgeKey(sourcePath, targetPath)) : undefined;

		if (colors && colors.length > 0) {
			setLinkColor(link, mixHexColors(colors), settings.edgeOpacity);
			return;
		}

		if (settings.recolorUnrelated) {
			setLinkColor(link, settings.unrelatedColor, settings.unrelatedLinkOpacity);
		} else {
			this.restoreLink(link);
		}
	}

	private restoreRendererChunked(
		renderer: GraphRendererLike,
		nodes: GraphObject[],
		links: GraphObject[],
		runId: number,
		shouldRequestRender: boolean,
		repaintTarget: HTMLElement | null,
	): void {
		let nodeIndex = 0;
		let linkIndex = 0;
		let nudgedAfterFirstChunk = false;

		const restoreChunk = () => {
			if (runId !== this.styleRunId) return;
			const deadline = performance.now() + STYLE_CHUNK_BUDGET_MS;
			let processed = 0;

			while (
				nodeIndex < nodes.length &&
				processed < STYLE_CHUNK_SIZE &&
				performance.now() < deadline
			) {
				this.restoreNode(nodes[nodeIndex]);
				nodeIndex += 1;
				processed += 1;
			}

			while (
				nodeIndex >= nodes.length &&
				linkIndex < links.length &&
				processed < STYLE_CHUNK_SIZE &&
				performance.now() < deadline
			) {
				this.restoreLink(links[linkIndex]);
				linkIndex += 1;
				processed += 1;
			}

			if (shouldRequestRender && processed > 0 && !nudgedAfterFirstChunk) {
				nudgedAfterFirstChunk = true;
				nudgeGraphView(repaintTarget);
			}

			if (nodeIndex < nodes.length || linkIndex < links.length) {
				scheduleChunk(restoreChunk, shouldRequestRender);
				return;
			}

			if (shouldRequestRender) nudgeGraphView(repaintTarget);
		};

		scheduleChunk(restoreChunk, shouldRequestRender);
	}

	private snapshotNode(node: GraphObject): void {
		if (this.originalNodeStyles.has(node)) return;
		this.originalNodeStyles.set(node, {
			color: cloneValue(node.color),
		});
	}

	private snapshotLink(link: GraphObject): void {
		if (this.originalLinkStyles.has(link)) return;
		this.originalLinkStyles.set(link, {
			color: cloneValue(link.color),
			lineColor: cloneValue(link.lineColor),
		});
	}

	private restoreNode(node: GraphObject): void {
		const original = this.originalNodeStyles.get(node);
		if (!original) return;
		restoreProperty(node, "color", original.color);
	}

	private restoreLink(link: GraphObject): void {
		const original = this.originalLinkStyles.get(link);
		if (!original) return;
		restoreProperty(link, "color", original.color);
		restoreProperty(link, "lineColor", original.lineColor);
	}

	private resolveGraphPath(value: string | null): string | null {
		if (!value) return null;
		const cached = this.pathCache.get(value);
		if (cached !== undefined) return cached;

		let resolved: string | null = value;
		if (this.app.vault.getAbstractFileByPath(value)) {
			this.pathCache.set(value, value);
			return value;
		}

		const markdownPath = value.endsWith(".md") ? value : `${value}.md`;
		if (this.app.vault.getAbstractFileByPath(markdownPath)) {
			this.pathCache.set(value, markdownPath);
			return markdownPath;
		}

		const normalized = value.replace(/\.md$/i, "").toLowerCase();
		const lookup = this.pathLookup.get(normalized);
		if (lookup) resolved = lookup;

		this.pathCache.set(value, resolved);
		return resolved;
	}

	private ensurePathLookup(): void {
		if (!this.pathLookupDirty) return;
		this.pathLookup.clear();

		for (const file of this.app.vault.getMarkdownFiles()) {
			setUniquePathLookup(this.pathLookup, file.path.toLowerCase(), file.path);
			setUniquePathLookup(this.pathLookup, file.path.replace(/\.md$/i, "").toLowerCase(), file.path);
			setUniquePathLookup(this.pathLookup, file.basename.toLowerCase(), file.path);
		}

		this.pathLookupDirty = false;
	}
}

export function isSupportedGraphLeaf(leaf: WorkspaceLeaf): boolean {
	const view = leaf.view as GraphViewLike;
	const type = view?.getViewType?.();
	return type === "graph" || type === "localgraph";
}

export function graphViewEnabled(leaf: WorkspaceLeaf, globalEnabled: boolean, localEnabled: boolean): boolean {
	const view = leaf.view as GraphViewLike;
	const type = view?.getViewType?.();
	if (type === "graph") return globalEnabled;
	if (type === "localgraph") return localEnabled;
	return false;
}

export function getGraphContainer(leaf: WorkspaceLeaf): HTMLElement | null {
	const view = leaf.view as GraphViewLike;
	const container = view.contentEl ?? view.containerEl ?? null;
	if (!container) return null;
	return (container.querySelector(".graph-view") as HTMLElement | null) ?? container;
}

function getRendererFromView(view: GraphViewLike): GraphRendererLike | null {
	return (
		view.renderer ??
		view.graph?.renderer ??
		view.localGraph?.renderer ??
		view.engine?.renderer ??
		view.dataEngine?.renderer ??
		null
	);
}

function objectValues(value: unknown): GraphObject[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.filter(isGraphObject);
	if (value instanceof Map) return Array.from(value.values()).filter(isGraphObject);
	if (value instanceof Set) return Array.from(value.values()).filter(isGraphObject);
	if (isGraphObject(value)) return Object.values(value).filter(isGraphObject);
	return [];
}

function isGraphObject(value: unknown): value is GraphObject {
	return typeof value === "object" && value !== null;
}

function extractEndpointPath(value: unknown): string | null {
	if (typeof value === "string") return normalizeGraphPath(value);
	if (!isGraphObject(value)) return null;
	return extractNodePath(value);
}

function extractNodePath(node: GraphObject): string | null {
	const direct = firstString(
		node.id,
		node.path,
		node.filePath,
		node.file && isGraphObject(node.file) ? node.file.path : null,
	);
	if (direct) return normalizeGraphPath(direct);

	const text = node.text;
	if (isGraphObject(text)) {
		const label = firstString(text.text, text._text, text.value);
		if (label) return normalizeGraphPath(label);
	}

	const getDisplayText = node.getDisplayText;
	if (typeof getDisplayText === "function") {
		try {
			const displayText = getDisplayText.call(node);
			if (typeof displayText === "string") return normalizeGraphPath(displayText);
		} catch {
			return null;
		}
	}

	return null;
}

function normalizeGraphPath(value: string): string {
	const trimmed = value.trim();
	if (trimmed.endsWith(".md")) return trimmed;
	return trimmed;
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return null;
}

function setNodeColor(node: GraphObject, hex: string, alpha: number): void {
	const color = pixiColor(hex, alpha);
	node.color = color;
}

function setLinkColor(link: GraphObject, hex: string, alpha: number): void {
	const color = pixiColor(hex, alpha);
	if ("lineColor" in link) link.lineColor = color;
	if ("color" in link) link.color = color;
}

function pixiColor(hex: string, alpha: number): PixiColor {
	return { rgb: hexToPixiRgb(hex), a: alpha };
}

function restoreProperty(source: GraphObject, key: string, value: unknown): void {
	if (typeof value === "undefined") {
		delete source[key];
		return;
	}
	source[key] = cloneValue(value);
}

function cloneValue<T>(value: T): T {
	if (!value || typeof value !== "object") return value;
	if (Array.isArray(value)) return [...value] as T;
	return { ...(value as Record<string, unknown>) } as T;
}

function nudgeGraphView(target: HTMLElement | null): void {
	if (!target) return;
	window.requestAnimationFrame(() => {
		try {
			const targets = getRepaintTargets(target);
			for (const repaintTarget of targets) {
				const rect = repaintTarget.getBoundingClientRect();
				const clientX = rect.left + rect.width / 2;
				const clientY = rect.top + rect.height / 2;
				const eventInit = {
					bubbles: true,
					cancelable: true,
					clientX,
					clientY,
				};

				if (typeof PointerEvent !== "undefined") {
					repaintTarget.dispatchEvent(new PointerEvent("pointermove", eventInit));
				}
				repaintTarget.dispatchEvent(new MouseEvent("mousemove", eventInit));
			}
		} catch {
			// A repaint nudge is best-effort; styling should never break graph interaction.
		}
	});
}

function getRepaintTargets(target: HTMLElement): HTMLElement[] {
	const canvas = target.querySelector("canvas");
	if (canvas instanceof HTMLElement && canvas !== target) return [canvas, target];
	return [target];
}

function scheduleChunk(callback: () => void, urgent = false): void {
	if (urgent) {
		window.requestAnimationFrame(callback);
		return;
	}

	const idleWindow = window as Window & {
		requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
	};

	if (typeof idleWindow.requestIdleCallback === "function") {
		idleWindow.requestIdleCallback(callback, { timeout: 80 });
		return;
	}

	window.requestAnimationFrame(callback);
}

function setUniquePathLookup(map: Map<string, string | null>, key: string, path: string): void {
	const existing = map.get(key);
	if (existing === undefined) {
		map.set(key, path);
		return;
	}
	if (existing !== path) map.set(key, null);
}
