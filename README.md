# Claude Code CLI panel for paseo

A paseo workspace panel that renders your local Claude Code CLI sessions and lets you drive them from
the paseo app — on desktop, in the browser, and on your phone.

The panel never replaces the CLI. A real interactive `claude` runs in a normal paseo terminal, so usage
accounting stays normal and the session keeps syncing to the Claude mobile and web apps. The panel
reads the transcript files Claude Code writes under `~/.claude/projects/`, and talks back to the CLI by
sending keystrokes to its terminal.

## What it does

- **Pretty view** of a session: markdown, tool cards with an Edit diff, thinking rows, todo lists,
  images and subagent groups, rendered from the transcript JSONL.
- **Session picker** listing the workspace's transcripts, newest first, with the live one flagged.
- **Prompt box** that forwards what you type (and image paths) to the terminal running `claude`.
- **Answering dialogs**: permission prompts and `AskUserQuestion` options become buttons. The terminal
  is always offered as the way out, and an answer that does not register is reported rather than
  silently dropped.

## Setup

1. Enable plugins in the daemon config (`~/.paseo/config.json`): `"pluginsEnabled": true`.
2. Install and load the plugin:

   ```sh
   pnpm install
   paseo plugin install /path/to/paseo-claude-code-cli-plugin
   ```

3. Open a workspace, then open the **Claude Code** panel (workspace panel, or the command center item
   "Open Claude Code panel").
4. The panel asks to enable **terminal agent hooks** the first time. This flips
   `enableTerminalAgentHooks` in the daemon config, which makes paseo install Claude Code hooks into
   your global `~/.claude/settings.json`. The hooks only report running / idle / needs-input for
   terminals paseo owns and no-op everywhere else. Until they are on, the panel is a read-only viewer.

`claude` must be on the PATH of the shell paseo opens; if it is not, starting a session reports it.

### Environment

- `PASEO_BIN` — path to the `paseo` CLI, if it is not on PATH and not inside the app bundle running the
  daemon.
- `CLAUDE_CONFIG_DIR` — respected when locating transcripts, same as Claude Code itself.
- Plugin state (send behavior, terminal bindings) and forwarded images live under
  `~/.cache/paseo-claude-code-cli-plugin/`. Cached images older than a week are deleted at startup.

## Send behavior

In the panel's ⋯ menu:

- **CLI default** — forward immediately. The CLI queues or steers input typed mid-turn itself.
- **Hold until idle** — wait for the session to go idle first.
- **Interrupt first** — press Esc to stop the current turn, then forward. (Never Ctrl+C: in the Claude
  CLI that clears the input line, and pressing it twice exits.)

## Development

```sh
pnpm typecheck
pnpm test                                        # node --test, no test dependencies
paseo plugin reload paseo-claude-code-cli-plugin # after every edit; there is no hot reload
paseo plugin logs paseo-claude-code-cli-plugin
```

The daemon compiles `index.ts` into two bundles. `*.client.tsx` runs inside the paseo app and may only
import `react`, `react-native`, `@tanstack/react-query`, `zod` and `@getpaseo/plugin` — markdown and the
diff are hand-rolled for that reason, and everything is pure React Native so the panel works on iOS and
Android. `*.server.ts` runs as an unsandboxed Node subprocess beside the daemon. `*.shared.ts` holds the
zod contracts both sides use. Relative imports carry their `.ts`/`.tsx` extension so the same modules
run unchanged under `node --test`.

## Known limits

- Terminal activity has no per-terminal CLI or plugin API, so status comes from the workspace bucket the
  hooks feed. A second busy terminal in the same workspace can therefore make a session look busy.
- Pure React Native has no file picker and its clipboard is text-only, so attaching an image takes a
  file path rather than opening a picker.
- Reading dialogs off the terminal screen is inherently version-sensitive. Parsing is fixture-tested
  against real captures and fails soft: an unrecognised screen becomes a card pointing at the terminal.
