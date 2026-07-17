export type OverlayPosition =
	| "top-left"
	| "top-center"
	| "top-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

export type ChipPlacement = "above" | "below";

export interface HighlightEntry {
	id: string;
	filePath: string;
	label: string;
	color: string;
	createdAt: number;
}

export interface SavedHighlight {
	filePath: string;
	label: string;
	color: string;
}

export interface SavedHighlightSet {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	highlights: SavedHighlight[];
}

export interface GraphSpotlightSettings {
	showSearchBar: boolean;
	enableGlobalGraph: boolean;
	enableLocalGraph: boolean;
	maxHighlights: number;
	overlayPosition: OverlayPosition;
	chipPlacement: ChipPlacement;
	recolorUnrelated: boolean;
	unrelatedColor: string;
	unrelatedNodeOpacity: number;
	unrelatedLinkOpacity: number;
	colorLinks: boolean;
	crowdedNoteThreshold: number;
	crowdedNoteColor: string;
	connectedNodeOpacity: number;
	connectedNodeDullness: number;
	edgeOpacity: number;
	suggestionLimit: number;
	autoFocusSearchOnGraphOpen: boolean;
	clearOnGraphClose: boolean;
	clearOnActiveNoteClose: boolean;
	clearOnActiveNoteChange: boolean;
	vibrantColors: string[];
	savedSets: SavedHighlightSet[];
}

export const DEFAULT_VIBRANT_COLORS = [
	"#ff4d6d",
	"#ff8a00",
	"#ffd166",
	"#06d6a0",
	"#00c2ff",
	"#4d96ff",
	"#9b5de5",
	"#f15bb5",
	"#2ec4b6",
	"#b8f35a",
	"#ff5f1f",
	"#00f5d4",
];

export const DEFAULT_SETTINGS: GraphSpotlightSettings = {
	showSearchBar: true,
	enableGlobalGraph: true,
	enableLocalGraph: true,
	maxHighlights: 10,
	overlayPosition: "top-left",
	chipPlacement: "below",
	recolorUnrelated: true,
	unrelatedColor: "#8b9098",
	unrelatedNodeOpacity: 1,
	unrelatedLinkOpacity: 0.62,
	colorLinks: false,
	crowdedNoteThreshold: 3,
	crowdedNoteColor: "#ffffff",
	connectedNodeOpacity: 0.86,
	connectedNodeDullness: 0.34,
	edgeOpacity: 0.9,
	suggestionLimit: 8,
	autoFocusSearchOnGraphOpen: false,
	clearOnGraphClose: true,
	clearOnActiveNoteClose: true,
	clearOnActiveNoteChange: false,
	vibrantColors: DEFAULT_VIBRANT_COLORS,
	savedSets: [],
};

export interface FileSuggestion {
	filePath: string;
	label: string;
	secondary: string;
	score: number;
}

export interface SpotlightGraphState {
	highlights: HighlightEntry[];
	highlightByPath: Map<string, HighlightEntry[]>;
	connectedByPath: Map<string, HighlightEntry[]>;
	edgeColors: Map<string, string[]>;
	hasHighlights: boolean;
}

export interface GraphRendererAdapterSettings {
	recolorUnrelated: boolean;
	unrelatedColor: string;
	unrelatedNodeOpacity: number;
	unrelatedLinkOpacity: number;
	colorLinks: boolean;
	crowdedNoteThreshold: number;
	crowdedNoteColor: string;
	connectedNodeOpacity: number;
	connectedNodeDullness: number;
	edgeOpacity: number;
}
