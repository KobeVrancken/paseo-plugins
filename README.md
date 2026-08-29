# Paseo plugins and apps

Extensions for [Paseo](https://github.com/getpaseo/paseo), organized in a pnpm workspace.

| App | Description |
| --- | --- |
| [Interactive Claude Code ACP](apps/claude-tty-acp) | Run genuine interactive Claude Code sessions in Paseo's native agent view. |

| Plugin | Description |
| --- | --- |
| [Claude Code panel (deprecated)](plugins/claude-code-panel) | Legacy panel superseded by the Interactive Claude Code ACP app. |
| [Discord Rich Presence](plugins/discord-rich-presence) | Show your current Paseo activity on Discord. |
| [Catppuccin theme](plugins/catppuccin-theme) | Add all four Catppuccin flavours as app themes. |
| [Claude Code (interactive)](plugins/claude-tty) | Install, diagnose, and manage the Interactive Claude Code ACP adapter on the daemon host. |

Each app and plugin has its own README with installation, settings, and development details.

## Local development

Install dependencies and check every package from the repository root:

```sh
pnpm install
pnpm typecheck
pnpm test
```

Enable Paseo plugins, then install each plugin from its own directory:

```sh
paseo plugin install "/absolute/path/to/paseo-plugins/plugins/claude-code-panel"
paseo plugin ls
```

After making changes, run `paseo plugin reload <id>`. Paseo does not hot-reload plugins, and reloading is the compile check for the client and server bundles built from `index.ts`.

## Plugin settings

Plugin settings are stored in `~/.cache/paseo-plugins/<plugin-id>/settings.json`.
