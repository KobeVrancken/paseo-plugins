# paseo-plugins

Local plugins for [paseo](https://github.com/getpaseo/paseo), in a pnpm workspace.

| Package | What it is |
| --- | --- |
| [`plugins/claude-code-panel`](plugins/claude-code-panel) | A workspace panel that renders your local Claude Code CLI sessions and lets you drive them from the paseo app. |
| [`plugins/discord-rich-presence`](plugins/discord-rich-presence) | A Discord rich presence that shows what you are working on in paseo, with a badge per workspace state. |

## Working in the workspace

```sh
pnpm install     # once, at the root
pnpm typecheck   # every package
pnpm test        # every package
```

A plugin is installed by pointing paseo at its directory, not at the workspace root:

```sh
paseo plugin install /path/to/paseo-plugins/plugins/claude-code-panel
```

Plugins load only once the daemon config (`~/.paseo/config.json`) has `"pluginsEnabled": true`.
There is no hot reload: after editing a plugin, run `paseo plugin reload <id>`, which is also the only compile check of the two bundles the daemon builds from `index.ts`.

Each package's own README covers what it does and how to develop it.
