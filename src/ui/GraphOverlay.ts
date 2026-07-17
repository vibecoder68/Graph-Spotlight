import { Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type GraphSpotlightPlugin from "../main";
import { FileSuggestion, HighlightEntry } from "../types";

export class GraphOverlay {
	private rootEl: HTMLDivElement;
	private stackEl: HTMLDivElement;
	private inputEl: HTMLInputElement;
	private chipsEl: HTMLDivElement;
	private suggestionsEl: HTMLDivElement;
	private suggestions: FileSuggestion[] = [];
	private selectedIndex = 0;
	private suggestionTimer: number | null = null;
	private suggestionRequestId = 0;
	private readonly disposers: Array<() => void> = [];
	private readonly chipDisposers: Array<() => void> = [];
	private readonly suggestionDisposers: Array<() => void> = [];

	constructor(
		private readonly plugin: GraphSpotlightPlugin,
		private readonly leaf: WorkspaceLeaf,
		private readonly hostEl: HTMLElement,
	) {
		this.hostEl.addClass("graph-spotlight-host");
		this.rootEl = this.hostEl.createDiv({ cls: "graph-spotlight-overlay" });
		this.stackEl = this.rootEl.createDiv({ cls: "graph-spotlight-stack" });

		const barEl = this.stackEl.createDiv({ cls: "graph-spotlight-bar" });
		this.inputEl = barEl.createEl("input", {
			cls: "graph-spotlight-input",
			attr: {
				type: "search",
				placeholder: "Spotlight note...",
				"aria-label": "Search notes to highlight in graph",
				autocomplete: "off",
				spellcheck: "false",
			},
		});

		const clearButton = barEl.createEl("button", {
			cls: "clickable-icon graph-spotlight-icon-button",
			attr: { type: "button", "aria-label": "Clear highlights", title: "Clear highlights" },
		});
		setIcon(clearButton, "eraser");

		const menuButton = barEl.createEl("button", {
			cls: "clickable-icon graph-spotlight-icon-button",
			attr: { type: "button", "aria-label": "Highlight options", title: "Highlight options" },
		});
		setIcon(menuButton, "more-horizontal");

		this.chipsEl = this.stackEl.createDiv({ cls: "graph-spotlight-chips" });
		this.suggestionsEl = this.rootEl.createDiv({
			cls: "graph-spotlight-suggestions is-hidden",
			attr: { role: "listbox" },
		});

		this.listen(this.inputEl, "input", () => this.scheduleSuggestions());
		this.listen(this.inputEl, "keydown", (event) => this.handleInputKeydown(event));
		this.listen(this.inputEl, "blur", () => {
			window.setTimeout(() => this.hideSuggestions(), 120);
		});
		this.listen(clearButton, "click", () => this.plugin.clearHighlights());
		this.listen(menuButton, "click", (event) => this.openMenu(event));

		this.updateFromSettings();
		this.refresh();

		if (this.plugin.settings.autoFocusSearchOnGraphOpen) {
			window.setTimeout(() => this.inputEl.focus(), 50);
		}
	}

	refresh(): void {
		this.updateFromSettings();
		this.renderChips(this.plugin.highlights);
		if (this.inputEl.value.trim()) this.scheduleSuggestions(80);
	}

	destroy(): void {
		if (this.suggestionTimer !== null) window.clearTimeout(this.suggestionTimer);
		disposeAll(this.chipDisposers);
		disposeAll(this.suggestionDisposers);
		for (const dispose of this.disposers.splice(0)) dispose();
		this.rootEl.remove();
		this.hostEl.removeClass("graph-spotlight-host");
	}

	private updateFromSettings(): void {
		this.rootEl.dataset.position = this.plugin.settings.overlayPosition;
		const isBottomPlacement = this.plugin.settings.overlayPosition.startsWith("bottom");
		this.rootEl.dataset.flow = isBottomPlacement ? "up" : "down";
		this.stackEl.dataset.chipPlacement = isBottomPlacement ? "above" : "below";
		this.rootEl.toggleClass("is-hidden", !this.plugin.settings.showSearchBar);
	}

	private renderChips(highlights: HighlightEntry[]): void {
		disposeAll(this.chipDisposers);
		this.chipsEl.empty();

		for (const highlight of highlights) {
			const chipEl = this.chipsEl.createDiv({ cls: "graph-spotlight-chip" });
			chipEl.style.setProperty("--chip-color", highlight.color);

			const removeButton = chipEl.createEl("button", {
				cls: "clickable-icon graph-spotlight-chip-remove",
				attr: {
					type: "button",
					"aria-label": `Remove ${highlight.label}`,
					title: `Remove ${highlight.label}`,
				},
			});
			setIcon(removeButton, "x");
			this.listen(removeButton, "click", () => this.plugin.removeHighlight(highlight.id), this.chipDisposers);

			chipEl.createSpan({ cls: "graph-spotlight-chip-label", text: highlight.label });

			const colorInput = chipEl.createEl("input", {
				cls: "graph-spotlight-color",
				attr: {
					type: "color",
					value: highlight.color,
					"aria-label": `Color for ${highlight.label}`,
					title: `Color for ${highlight.label}`,
				},
			});
			this.listen(colorInput, "input", () => {
				chipEl.style.setProperty("--chip-color", colorInput.value);
				this.plugin.updateHighlightColor(highlight.id, colorInput.value);
			}, this.chipDisposers);
		}
	}

	private scheduleSuggestions(delay = 140): void {
		if (this.suggestionTimer !== null) window.clearTimeout(this.suggestionTimer);
		const requestId = ++this.suggestionRequestId;
		this.suggestionTimer = window.setTimeout(() => {
			this.suggestionTimer = null;
			this.updateSuggestions(requestId);
		}, delay);
	}

	private updateSuggestions(requestId = ++this.suggestionRequestId): void {
		const query = this.inputEl.value.trim();
		if (!query) {
			this.hideSuggestions();
			return;
		}

		if (requestId !== this.suggestionRequestId) return;
		this.suggestions = this.plugin.searchFiles(query, this.plugin.settings.suggestionLimit);
		this.selectedIndex = 0;
		this.renderSuggestions();
	}

	private renderSuggestions(): void {
		disposeAll(this.suggestionDisposers);
		this.suggestionsEl.empty();
		this.suggestionsEl.removeClass("is-hidden");

		if (this.suggestions.length === 0) {
			this.suggestionsEl.createDiv({ cls: "graph-spotlight-empty", text: "No notes found" });
			return;
		}

		this.suggestions.forEach((suggestion, index) => {
			const option = this.suggestionsEl.createEl("button", {
				cls: "graph-spotlight-suggestion",
				attr: {
					type: "button",
					role: "option",
					"aria-selected": index === this.selectedIndex ? "true" : "false",
				},
			});
			option.toggleClass("is-selected", index === this.selectedIndex);
			option.createSpan({ cls: "graph-spotlight-suggestion-title", text: suggestion.label });
			option.createSpan({ cls: "graph-spotlight-suggestion-path", text: suggestion.secondary });
			this.listen(option, "mousedown", (event) => event.preventDefault(), this.suggestionDisposers);
			this.listen(option, "click", () => this.addSuggestion(index), this.suggestionDisposers);
		});
	}

	private handleInputKeydown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.moveSelection(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			this.moveSelection(-1);
			return;
		}
		if (event.key === "Escape") {
			this.hideSuggestions();
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (this.suggestions.length > 0) {
				this.addSuggestion(this.selectedIndex);
				return;
			}

			const exact = this.plugin.findFileBySearch(this.inputEl.value);
			if (exact) {
				this.plugin.addHighlightByPath(exact.path);
				this.inputEl.value = "";
				this.hideSuggestions();
			}
		}
	}

	private moveSelection(delta: number): void {
		if (this.suggestions.length === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + this.suggestions.length) % this.suggestions.length;
		this.renderSuggestions();
	}

	private addSuggestion(index: number): void {
		const suggestion = this.suggestions[index];
		if (!suggestion) return;
		this.plugin.addHighlightByPath(suggestion.filePath);
		this.inputEl.value = "";
		this.hideSuggestions();
	}

	private hideSuggestions(): void {
		if (this.suggestionTimer !== null) {
			window.clearTimeout(this.suggestionTimer);
			this.suggestionTimer = null;
		}
		this.suggestionRequestId += 1;
		this.suggestions = [];
		this.selectedIndex = 0;
		disposeAll(this.suggestionDisposers);
		this.suggestionsEl.empty();
		this.suggestionsEl.addClass("is-hidden");
	}

	private openMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle("Save current set")
				.setIcon("save")
				.setDisabled(this.plugin.highlights.length === 0)
				.onClick(() => this.plugin.promptSaveCurrentSet());
		});
		menu.addItem((item) => {
			item
				.setTitle("Clear highlights")
				.setIcon("eraser")
				.setDisabled(this.plugin.highlights.length === 0)
				.onClick(() => this.plugin.clearHighlights());
		});

		if (this.plugin.settings.savedSets.length > 0) {
			menu.addSeparator();
			for (const set of this.plugin.settings.savedSets) {
				menu.addItem((item) => {
					item
						.setTitle(`Load ${set.name}`)
						.setIcon("folder-open")
						.onClick(() => this.plugin.loadSavedSet(set.id));
				});
			}
		} else {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("No saved sets").setDisabled(true);
			});
		}

		menu.showAtMouseEvent(event);
	}

	private listen<K extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: K,
		listener: (event: HTMLElementEventMap[K]) => void,
		disposers = this.disposers,
	): void {
		element.addEventListener(type, listener);
		disposers.push(() => element.removeEventListener(type, listener));
	}
}

function disposeAll(disposers: Array<() => void>): void {
	for (const dispose of disposers.splice(0)) dispose();
}
