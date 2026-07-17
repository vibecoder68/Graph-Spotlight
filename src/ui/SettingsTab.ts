import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type GraphSpotlightPlugin from "../main";
import { DEFAULT_VIBRANT_COLORS, OverlayPosition } from "../types";
import { normalizeHexColor, parseColorPool } from "../utils/colors";
import { pluralize } from "../utils/dom";

const POSITIONS: Record<OverlayPosition, string> = {
	"top-left": "Top left",
	"top-center": "Top center",
	"top-right": "Top right",
	"bottom-left": "Bottom left",
	"bottom-center": "Bottom center",
	"bottom-right": "Bottom right",
};

export class GraphSpotlightSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: GraphSpotlightPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Graph Spotlight" });

		new Setting(containerEl)
			.setName("Show graph search bar")
			.setDesc("Adds the compact spotlight search overlay to supported graph views.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showSearchBar).onChange(async (value) => {
					this.plugin.settings.showSearchBar = value;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphViews();
				});
			});

		new Setting(containerEl)
			.setName("Global graph")
			.setDesc("Show the spotlight overlay in the global graph view.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.enableGlobalGraph).onChange(async (value) => {
					this.plugin.settings.enableGlobalGraph = value;
					await this.plugin.saveSettings();
					this.plugin.resetGraphRendering();
					this.plugin.refreshGraphViews();
				});
			});

		new Setting(containerEl)
			.setName("Local graph")
			.setDesc("Show the spotlight overlay in local graph views.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.enableLocalGraph).onChange(async (value) => {
					this.plugin.settings.enableLocalGraph = value;
					await this.plugin.saveSettings();
					this.plugin.resetGraphRendering();
					this.plugin.refreshGraphViews();
				});
			});

		new Setting(containerEl)
			.setName("Maximum active highlights")
			.setDesc("Defaults to 10, but the internals support larger sets.")
			.addSlider((slider) => {
				slider
					.setLimits(1, 50, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.maxHighlights)
					.onChange(async (value) => {
						this.plugin.settings.maxHighlights = value;
						if (this.plugin.highlights.length > value) {
							this.plugin.trimHighlights(value);
						}
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Overlay position")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(POSITIONS)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.overlayPosition).onChange(async (value) => {
					this.plugin.settings.overlayPosition = value as OverlayPosition;
					await this.plugin.saveSettings();
					this.plugin.refreshOverlays();
				});
			});

		containerEl.createEl("h3", { text: "Highlight rendering" });

		new Setting(containerEl)
			.setName("Grey unrelated notes")
			.setDesc("When highlights are active, recolor notes outside the highlighted neighborhoods to neutral grey.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.recolorUnrelated).onChange(async (value) => {
					this.plugin.settings.recolorUnrelated = value;
					await this.plugin.saveSettings();
					this.plugin.applyHighlights();
				});
			});

		new Setting(containerEl)
			.setName("Unrelated grey")
			.setDesc("A middle grey works well on both dark and light Obsidian themes.")
			.addColorPicker((picker) => {
				picker.setValue(this.plugin.settings.unrelatedColor).onChange(async (value) => {
					this.plugin.settings.unrelatedColor = normalizeHexColor(value) ?? this.plugin.settings.unrelatedColor;
					await this.plugin.saveSettings();
					this.plugin.applyHighlights();
				});
			});

		new Setting(containerEl)
			.setName("Unrelated note visibility")
			.addSlider((slider) => {
				slider
					.setLimits(0.45, 1, 0.01)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.unrelatedNodeOpacity)
					.onChange(async (value) => {
						this.plugin.settings.unrelatedNodeOpacity = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl)
			.setName("Color graph links")
			.setDesc("Experimental. Leave off if your Obsidian graph renderer behaves badly with link recoloring.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.colorLinks).onChange(async (value) => {
					this.plugin.settings.colorLinks = value;
					await this.plugin.saveSettings();
					this.plugin.applyHighlights();
					this.display();
				});
			});

		if (this.plugin.settings.colorLinks) {
			new Setting(containerEl)
				.setName("Unrelated link visibility")
				.addSlider((slider) => {
					slider
						.setLimits(0.2, 1, 0.01)
						.setDynamicTooltip()
						.setValue(this.plugin.settings.unrelatedLinkOpacity)
						.onChange(async (value) => {
							this.plugin.settings.unrelatedLinkOpacity = value;
							await this.plugin.saveSettings();
							this.plugin.applyHighlights();
						});
				});
		}

		new Setting(containerEl)
			.setName("Connected note opacity")
			.addSlider((slider) => {
				slider
					.setLimits(0.35, 1, 0.01)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.connectedNodeOpacity)
					.onChange(async (value) => {
						this.plugin.settings.connectedNodeOpacity = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl)
			.setName("Connected note dullness")
			.setDesc("Higher values move connected notes closer to neutral gray.")
			.addSlider((slider) => {
				slider
					.setLimits(0, 0.8, 0.01)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.connectedNodeDullness)
					.onChange(async (value) => {
						this.plugin.settings.connectedNodeDullness = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl)
			.setName("Highlighted link opacity")
			.setDesc("Used only when graph link coloring is enabled.")
			.addSlider((slider) => {
				slider
					.setLimits(0.2, 1, 0.01)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.edgeOpacity)
					.onChange(async (value) => {
						this.plugin.settings.edgeOpacity = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		containerEl.createEl("h3", { text: "Behavior" });

		new Setting(containerEl)
			.setName("Suggestion count")
			.addSlider((slider) => {
				slider
					.setLimits(3, 20, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.suggestionLimit)
					.onChange(async (value) => {
						this.plugin.settings.suggestionLimit = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Focus search on graph open")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoFocusSearchOnGraphOpen).onChange(async (value) => {
					this.plugin.settings.autoFocusSearchOnGraphOpen = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Clear when graph closes")
			.setDesc("Removes temporary highlights when no supported graph view remains open.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.clearOnGraphClose).onChange(async (value) => {
					this.plugin.settings.clearOnGraphClose = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Clear when active note closes")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.clearOnActiveNoteClose).onChange(async (value) => {
					this.plugin.settings.clearOnActiveNoteClose = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Clear when active note changes")
			.setDesc("Optional stricter mode for local-note workflows.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.clearOnActiveNoteChange).onChange(async (value) => {
					this.plugin.settings.clearOnActiveNoteChange = value;
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h3", { text: "Color pool" });

		new Setting(containerEl)
			.setName("Vibrant colors")
			.setDesc("Comma, semicolon, or whitespace separated hex colors used for new highlights.")
			.addTextArea((text) => {
				text.inputEl.addClass("graph-spotlight-settings-palette");
				text.setValue(this.plugin.settings.vibrantColors.join(", ")).onChange(async (value) => {
					const colors = parseColorPool(value);
					if (colors.length === 0) return;
					this.plugin.settings.vibrantColors = colors;
					await this.plugin.saveSettings();
				});
			})
			.addButton((button) => {
				button.setButtonText("Reset").onClick(async () => {
					this.plugin.settings.vibrantColors = [...DEFAULT_VIBRANT_COLORS];
					await this.plugin.saveSettings();
					this.display();
				});
			});

		containerEl.createEl("h3", { text: "Saved sets" });
		this.renderSavedSets(containerEl);
	}

	private renderSavedSets(containerEl: HTMLElement): void {
		if (this.plugin.settings.savedSets.length === 0) {
			containerEl.createDiv({ cls: "setting-item-description", text: "No saved highlight sets yet." });
			return;
		}

		for (const set of this.plugin.settings.savedSets) {
			const row = containerEl.createDiv({ cls: "graph-spotlight-saved-set" });
			const label = row.createDiv();
			label.createDiv({ cls: "graph-spotlight-saved-set-name", text: set.name });
			label.createDiv({
				cls: "graph-spotlight-saved-set-meta",
				text: pluralize(set.highlights.length, "highlight"),
			});
			const actions = row.createDiv({ cls: "setting-item-control" });

			new Setting(actions)
				.addButton((button) => {
					button.setButtonText("Load").onClick(() => this.plugin.loadSavedSet(set.id));
				})
				.addButton((button) => {
					button.setButtonText("Delete").setWarning().onClick(async () => {
						this.plugin.settings.savedSets = this.plugin.settings.savedSets.filter((item) => item.id !== set.id);
						await this.plugin.saveSettings();
						new Notice(`Deleted ${set.name}`);
						this.display();
					});
				});
		}
	}
}
