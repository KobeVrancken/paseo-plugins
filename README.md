# paseo-plugins

Local plugins for [paseo](https://github.com/getpaseo/paseo) organized in a pnpm workspace.

| Package                                                          | What it is                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`plugins/claude-code-panel`](plugins/claude-code-panel)         | A workspace panel that renders your local Claude Code CLI sessions and lets you drive them from the paseo app. |
| [`plugins/discord-rich-presence`](plugins/discord-rich-presence) | A Discord rich presence that shows what you are working on in paseo, with a badge per workspace state.         |
| [`plugins/cappuccino-macchiato`](plugins/cappuccino-macchiato)   | A dark app theme in the Catppuccin Macchiato palette.                                                          |

## Local development

```sh
pnpm install     # once, at the root
pnpm typecheck   # every package
pnpm test        # every package
```

Paseo plugins must be enabled. Each one is installed by its own directory rather than by the workspace root:

```sh
paseo plugin install "/absolute/path/to/paseo-plugins/plugins/claude-code-panel"
paseo plugin ls
```

There is no hot reload: after editing a plugin, run `paseo plugin reload <id>`, which is also the only compile check of the two bundles the daemon builds from `index.ts`.

## Plugin settings

A plugin's settings are its own file under `~/.cache/paseo-plugins/<plugin-id>/settings.json`, rather than the daemon config, because the daemon config drops keys it does not know.

## See also

Each package's own README.md covers what it does and how to develop it.
