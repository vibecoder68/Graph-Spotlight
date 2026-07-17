# Community Submission Checklist

Use this checklist when you are ready to make Graph Spotlight available in Obsidian's in-app Community plugins directory.

## Fill These In First

- `manifest.json`: set `author` to the public author name you want shown in Obsidian.
- `manifest.json`: set `authorUrl` to your website or GitHub profile, or remove it if you do not want one.
- GitHub: publish the source repository, not only the compiled release files. The repo should include `src/`, `package.json`, `README.md`, `LICENSE`, and `manifest.json` at the root.

## Local Install Test

1. Unzip `outputs/graph-spotlight-0.1.6-local-install.zip`.
2. Put the `graph-spotlight` folder into `<Vault>/.obsidian/plugins/`.
3. In Obsidian, open Settings -> Community plugins.
4. Turn off Restricted mode if needed.
5. Enable Graph Spotlight.
6. Test global graph, local graph, search, add/remove highlights, saved sets, and bottom overlay placement.

## GitHub Release

1. Commit the source repository with `manifest.json`, `README.md`, and `LICENSE` at the root.
2. Create a GitHub release whose tag is exactly `0.1.6`.
3. Upload these files as individual release assets, not inside a zip:
   - `main.js`
   - `manifest.json`
   - `styles.css`

The release tag must match the `version` in `manifest.json`.

Do not rely on `graph-spotlight-0.1.6-release-assets.zip` for the Obsidian validator. The zip is only a convenient way to move the files around; the GitHub Release itself must show `main.js`, `manifest.json`, and `styles.css` as separate attached assets.

## Submit to Obsidian

1. Sign in at `https://community.obsidian.md`.
2. Link your GitHub account.
3. Choose Plugins -> New plugin.
4. Enter your GitHub repository URL.
5. Accept the developer policies and submit.

Obsidian reads your committed `manifest.json`, but installs plugin files from the GitHub release assets whose tag matches the manifest version.
