# Graph Spotlight

Graph Spotlight adds a compact search bar to Obsidian's graph view. Search for notes, add up to a configurable number of temporary highlights, assign each one a vibrant color, and turn the rest of the graph into neutral grey context so the selected neighborhoods stand out.

## Features

- Minimal overlay inside global and local graph views.
- Search markdown notes by title or path.
- Temporary highlight chips with delete and color controls.
- Colored highlighted notes, connected notes, and graph links.
- Duller connected-note colors for context.
- Multi-highlight blending for notes connected to more than one spotlight.
- Named saved sets that can be reloaded later.
- Settings for placement, limits, neutral-grey context, palette, graph types, and clearing behavior.

## Installation

### From Obsidian Community Plugins

After Graph Spotlight is approved in Obsidian's Community plugins directory:

1. Open Obsidian Settings.
2. Go to Community plugins.
3. Search for Graph Spotlight.
4. Install and enable the plugin.

### Manual install

1. Download `graph-spotlight-0.1.6-local-install.zip` from the release assets.
2. Unzip it into `<Vault>/.obsidian/plugins/`.
3. Confirm the folder path is `<Vault>/.obsidian/plugins/graph-spotlight/`.
4. In Obsidian, open Settings -> Community plugins, reload plugins if needed, and enable Graph Spotlight.

## Usage

1. Open Obsidian's global graph or a local graph.
2. Use the Graph Spotlight search bar to find a note.
3. Select a note to add it as a temporary highlight.
4. Use the color circle on each highlight chip to change its color.
5. Use the x button on a highlight chip to remove it.
6. Use the options button beside the search bar to save or load highlight sets.
7. Configure placement, colors, graph types, and saved sets in Settings -> Graph Spotlight.

## Install for development

1. Copy this folder into `<Vault>/.obsidian/plugins/graph-spotlight/`.
2. Run `npm install`.
3. Run `npm run dev` while developing, or `npm run build` for a production bundle.
4. Reload Obsidian and enable Graph Spotlight in Settings -> Community plugins.

## Notes on graph internals

Obsidian exposes plugin lifecycle, settings, vault, workspace, and DOM APIs publicly, but not a stable per-node graph renderer API. This plugin keeps all graph renderer assumptions in `src/graph/GraphRendererAdapter.ts` so future Obsidian changes have one place to update.

If the internal renderer is unavailable in a future Obsidian version, the search UI and saved-set management will still load, but graph recoloring may need an adapter update.

Graph styling is applied only after highlight changes or when a graph overlay is first attached, and large renderer updates are split into small chunks so Obsidian's graph view remains interactive. Link coloring is experimental and disabled by default because Obsidian's internal link renderer varies more than node coloring.

Highlight additions, removals, color changes, and saved-set loads request one graph repaint after styling finishes so the colors appear without requiring mouse movement.

User-triggered highlight updates run on the next animation frame and nudge the graph after the first styling chunk, so color changes appear quickly while large graphs continue updating in small slices.

Search suggestions are debounced and use a cached note index. Bottom overlay placements automatically show chips and suggestions above the search bar.

By default, notes affected by three or more active highlights turn white instead of blending many colors together. The threshold and crowded-note color are configurable.
