import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type GraphSpotlightPlugin from "../main";
import { DEFAULT_VIBRANT_COLORS, OverlayPosition } from "../types";
import { normalizeHexColor, parseColorPool } from "../utils/colors";
import { pluralize } from "../utils/dom";

const OVERLAY_POSITIONS: OverlayPosition[] = [
	"top-left",
	"top-center",
	"top-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
];

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

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Graph Spotlight",
				items: [
					{
						name: "Show graph search bar",
						desc: "Adds the compact spotlight search overlay to supported graph views.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.showSearchBar).onChange(async (value) => {
									this.plugin.settings.showSearchBar = value;
									await this.plugin.saveSettings();
									this.plugin.refreshGraphViews();
								});
							});
						},
					},
					{
						name: "Global graph",
						desc: "Show the spotlight overlay in the global graph view.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.enableGlobalGraph).onChange(async (value) => {
									this.plugin.settings.enableGlobalGraph = value;
									await this.plugin.saveSettings();
									this.plugin.resetGraphRendering();
									this.plugin.refreshGraphViews();
								});
							});
						},
					},
					{
						name: "Local graph",
						desc: "Show the spotlight overlay in local graph views.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.enableLocalGraph).onChange(async (value) => {
									this.plugin.settings.enableLocalGraph = value;
									await this.plugin.saveSettings();
									this.plugin.resetGraphRendering();
									this.plugin.refreshGraphViews();
								});
							});
						},
					},
					{
						name: "Maximum active highlights",
						desc: "Defaults to 10, but the internals support larger sets.",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(1, 50, 1)
									.setValue(this.plugin.settings.maxHighlights)
									.onChange(async (value) => {
										this.plugin.settings.maxHighlights = value;
										if (this.plugin.highlights.length > value) {
											this.plugin.trimHighlights(value);
										}
										await this.plugin.saveSettings();
									});
							});
						},
					},
					{
						name: "Overlay position",
						render: (setting) => {
							setting.addDropdown((dropdown) => {
								for (const value of OVERLAY_POSITIONS) {
									dropdown.addOption(value, POSITIONS[value]);
								}
								dropdown.setValue(this.plugin.settings.overlayPosition).onChange(async (value) => {
									if (!isOverlayPosition(value)) return;
									this.plugin.settings.overlayPosition = value;
									await this.plugin.saveSettings();
									this.plugin.refreshOverlays();
								});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Highlight rendering",
				items: [
					{
						name: "Grey unrelated notes",
						desc: "When highlights are active, recolor notes outside the highlighted neighborhoods to neutral grey.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.recolorUnrelated).onChange(async (value) => {
									this.plugin.settings.recolorUnrelated = value;
									await this.plugin.saveSettings();
									this.plugin.applyHighlights();
								});
							});
						},
					},
					{
						name: "Unrelated grey",
						desc: "A middle grey works well on both dark and light Obsidian themes.",
						render: (setting) => {
							setting.addColorPicker((picker) => {
								picker.setValue(this.plugin.settings.unrelatedColor).onChange(async (value) => {
									this.plugin.settings.unrelatedColor = normalizeHexColor(value) ?? this.plugin.settings.unrelatedColor;
									await this.plugin.saveSettings();
									this.plugin.applyHighlights();
								});
							});
						},
					},
					{
						name: "Unrelated note visibility",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(0.45, 1, 0.01)
									.setValue(this.plugin.settings.unrelatedNodeOpacity)
									.onChange(async (value) => {
										this.plugin.settings.unrelatedNodeOpacity = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
					{
						name: "Color graph links",
						desc: "Experimental. Leave off if your Obsidian graph renderer behaves badly with link recoloring.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.colorLinks).onChange(async (value) => {
									this.plugin.settings.colorLinks = value;
									await this.plugin.saveSettings();
									this.plugin.applyHighlights();
									this.update();
								});
							});
						},
					},
					{
						name: "Unrelated link visibility",
						visible: () => this.plugin.settings.colorLinks,
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(0.2, 1, 0.01)
									.setValue(this.plugin.settings.unrelatedLinkOpacity)
									.onChange(async (value) => {
										this.plugin.settings.unrelatedLinkOpacity = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
					{
						name: "Connected note opacity",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(0.35, 1, 0.01)
									.setValue(this.plugin.settings.connectedNodeOpacity)
									.onChange(async (value) => {
										this.plugin.settings.connectedNodeOpacity = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
					{
						name: "Connected note dullness",
						desc: "Higher values move connected notes closer to neutral gray.",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(0, 0.8, 0.01)
									.setValue(this.plugin.settings.connectedNodeDullness)
									.onChange(async (value) => {
										this.plugin.settings.connectedNodeDullness = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
					{
						name: "Crowded note threshold",
						desc: "Notes affected by this many highlights use the crowded note color instead of a blended color.",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(2, 10, 1)
									.setValue(this.plugin.settings.crowdedNoteThreshold)
									.onChange(async (value) => {
										this.plugin.settings.crowdedNoteThreshold = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
					{
						name: "Crowded note color",
						desc: "White is the default so notes touched by many highlight groups stand out clearly.",
						render: (setting) => {
							setting.addColorPicker((picker) => {
								picker.setValue(this.plugin.settings.crowdedNoteColor).onChange(async (value) => {
									this.plugin.settings.crowdedNoteColor = normalizeHexColor(value) ?? this.plugin.settings.crowdedNoteColor;
									await this.plugin.saveSettings();
									this.plugin.applyHighlights();
								});
							});
						},
					},
					{
						name: "Highlighted link opacity",
						desc: "Used only when graph link coloring is enabled.",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(0.2, 1, 0.01)
									.setValue(this.plugin.settings.edgeOpacity)
									.onChange(async (value) => {
										this.plugin.settings.edgeOpacity = value;
										await this.plugin.saveSettings();
										this.plugin.applyHighlights();
									});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Behavior",
				items: [
					{
						name: "Suggestion count",
						render: (setting) => {
							setting.addSlider((slider) => {
								slider
									.setLimits(3, 20, 1)
									.setValue(this.plugin.settings.suggestionLimit)
									.onChange(async (value) => {
										this.plugin.settings.suggestionLimit = value;
										await this.plugin.saveSettings();
									});
							});
						},
					},
					{
						name: "Focus search on graph open",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.autoFocusSearchOnGraphOpen).onChange(async (value) => {
									this.plugin.settings.autoFocusSearchOnGraphOpen = value;
									await this.plugin.saveSettings();
								});
							});
						},
					},
					{
						name: "Clear when graph closes",
						desc: "Removes temporary highlights when no supported graph view remains open.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.clearOnGraphClose).onChange(async (value) => {
									this.plugin.settings.clearOnGraphClose = value;
									await this.plugin.saveSettings();
								});
							});
						},
					},
					{
						name: "Clear when active note closes",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.clearOnActiveNoteClose).onChange(async (value) => {
									this.plugin.settings.clearOnActiveNoteClose = value;
									await this.plugin.saveSettings();
								});
							});
						},
					},
					{
						name: "Clear when active note changes",
						desc: "Optional stricter mode for local-note workflows.",
						render: (setting) => {
							setting.addToggle((toggle) => {
								toggle.setValue(this.plugin.settings.clearOnActiveNoteChange).onChange(async (value) => {
									this.plugin.settings.clearOnActiveNoteChange = value;
									await this.plugin.saveSettings();
								});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Color pool",
				items: [
					{
						name: "Vibrant colors",
						desc: "Comma, semicolon, or whitespace separated hex colors used for new highlights.",
						render: (setting) => {
							setting
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
										this.update();
									});
								});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Saved sets",
				items:
					this.plugin.settings.savedSets.length === 0
						? [{ name: "No saved highlight sets yet.", searchable: false }]
						: this.plugin.settings.savedSets.map((set) => ({
								name: set.name,
								desc: pluralize(set.highlights.length, "highlight"),
								render: (setting: Setting) => {
									setting
										.addButton((button) => {
											button.setButtonText("Load").onClick(() => this.plugin.loadSavedSet(set.id));
										})
										.addButton((button) => {
											button.setButtonText("Delete").setDestructive().onClick(async () => {
												this.plugin.settings.savedSets = this.plugin.settings.savedSets.filter((item) => item.id !== set.id);
												await this.plugin.saveSettings();
												new Notice(`Deleted ${set.name}`);
												this.update();
											});
										});
								},
							})),
			},
		];
	}

	display(): void {
		this.renderSettings();
	}

	private renderSettings(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("Graph Spotlight").setHeading();

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
				for (const value of OVERLAY_POSITIONS) {
					dropdown.addOption(value, POSITIONS[value]);
				}
				dropdown.setValue(this.plugin.settings.overlayPosition).onChange(async (value) => {
					if (!isOverlayPosition(value)) return;
					this.plugin.settings.overlayPosition = value;
					await this.plugin.saveSettings();
					this.plugin.refreshOverlays();
				});
			});

		new Setting(containerEl).setName("Highlight rendering").setHeading();

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
					this.renderSettings();
				});
			});

		if (this.plugin.settings.colorLinks) {
			new Setting(containerEl)
				.setName("Unrelated link visibility")
				.addSlider((slider) => {
					slider
						.setLimits(0.2, 1, 0.01)
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
					.setValue(this.plugin.settings.connectedNodeDullness)
					.onChange(async (value) => {
						this.plugin.settings.connectedNodeDullness = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl)
			.setName("Crowded note threshold")
			.setDesc("Notes affected by this many highlights use the crowded note color instead of a blended color.")
			.addSlider((slider) => {
				slider
					.setLimits(2, 10, 1)
					.setValue(this.plugin.settings.crowdedNoteThreshold)
					.onChange(async (value) => {
						this.plugin.settings.crowdedNoteThreshold = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl)
			.setName("Crowded note color")
			.setDesc("White is the default so notes touched by many highlight groups stand out clearly.")
			.addColorPicker((picker) => {
				picker.setValue(this.plugin.settings.crowdedNoteColor).onChange(async (value) => {
					this.plugin.settings.crowdedNoteColor = normalizeHexColor(value) ?? this.plugin.settings.crowdedNoteColor;
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
					.setValue(this.plugin.settings.edgeOpacity)
					.onChange(async (value) => {
						this.plugin.settings.edgeOpacity = value;
						await this.plugin.saveSettings();
						this.plugin.applyHighlights();
					});
			});

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Suggestion count")
			.addSlider((slider) => {
				slider
					.setLimits(3, 20, 1)
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

		new Setting(containerEl).setName("Color pool").setHeading();

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
					this.renderSettings();
				});
			});

		new Setting(containerEl).setName("Saved sets").setHeading();
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
					button.setButtonText("Delete").setDestructive().onClick(async () => {
						this.plugin.settings.savedSets = this.plugin.settings.savedSets.filter((item) => item.id !== set.id);
						await this.plugin.saveSettings();
						new Notice(`Deleted ${set.name}`);
						this.renderSettings();
					});
				});
		}
	}
}

function isOverlayPosition(value: string): value is OverlayPosition {
	return value in POSITIONS;
}
