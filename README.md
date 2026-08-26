# paseo-plugins

Local plugins for [paseo](https://github.com/getpaseo/paseo), in a pnpm workspace.

| Package | What it is |
| --- | --- |
| [`packages/claude-code-panel`](packages/claude-code-panel) | A workspace panel that renders your local Claude Code CLI sessions and lets you drive them from the paseo app. |

## Working in the workspace

```sh
pnpm install     # once, at the root
pnpm typecheck   # every package
pnpm test        # every package
```

A plugin is installed by pointing paseo at its directory, not at the workspace root:

```sh
paseo plugin install /path/to/paseo-plugins/packages/claude-code-panel
```

Each package's own README covers what it does and how to develop it.
