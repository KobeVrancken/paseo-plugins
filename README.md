# Claude Code CLI panel for paseo

A paseo workspace panel that renders your local Claude Code CLI sessions and lets you drive them from the paseo app, on desktop, in the browser, and on your phone.

The panel never replaces the CLI. A real interactive `claude` runs in a normal paseo terminal, so usage accounting stays normal and the session keeps syncing to the Claude mobile and web apps. The panel reads the transcript files that Claude Code writes under `~/.claude/projects/`, and it talks back to the CLI by sending keystrokes to that terminal.

## What it does

- **Pretty view of a session.** The transcript JSONL is rendered as markdown, tool cards with an Edit diff, thinking rows, todo lists, images and subagent groups.
- **Session picker.** Every transcript belonging to the workspace is listed newest first, and the live one is flagged.
- **Prompt box.** What you type is forwarded to the terminal running `claude`, along with the paths of any images you attach. Enter sends the prompt and Shift+Enter starts a new line, except on a phone, where Enter still breaks the line and the send button sends.
- **Answering dialogs.** Permission prompts and `AskUserQuestion` options become buttons in the panel. The terminal is always offered as the way out, and an answer that does not register is reported rather than silently dropped.

## Setup

1. Enable plugins in the daemon config (`~/.paseo/config.json`) by setting `"pluginsEnabled": true`.
2. Install and load the plugin:

   ```sh
   pnpm install
   paseo plugin install /path/to/paseo-claude-code-cli-plugin
   ```

3. Open a workspace, then open the **Claude Code** panel, either as a workspace panel or through the command center item "Open Claude Code panel".
4. The first time you open it, the panel asks to enable **terminal agent hooks**. Enabling them flips `enableTerminalAgentHooks` in the daemon config, which makes paseo install Claude Code hooks into your global `~/.claude/settings.json`. Those hooks only report running, idle and needs-input for terminals that paseo owns, and they no-op everywhere else. Until they are on, the panel is a read-only viewer. If you turn the setting on somewhere else, the panel notices within a few seconds; you do not need to reload the plugin.

`claude` has to be on the PATH of the shell that paseo opens. If it is not, starting a session says so instead of leaving you with an empty panel.

### Environment

- `PASEO_BIN` points at the `paseo` CLI. Set it if the CLI is neither on PATH nor inside the app bundle that runs the daemon.
- `CLAUDE_CONFIG_DIR` is respected when locating transcripts, exactly as Claude Code itself does.
- Plugin state, meaning the send behavior and the terminal bindings, lives in `~/.cache/paseo-claude-code-cli-plugin/`, and so do the images you attach. Cached images older than a week are deleted at startup.

## Send behavior

The ⋯ menu offers three ways to deliver a prompt.

- **CLI default** forwards it immediately, and the CLI itself queues or steers input typed mid-turn.
- **Hold until idle** waits for the session to go idle before forwarding.
- **Interrupt first** presses Esc to stop the current turn and then forwards. It is never Ctrl+C: in the Claude CLI that clears the input line, and pressing it twice exits the CLI.

## Development

```sh
pnpm typecheck
pnpm test                                        # node --test, no test dependencies
paseo plugin reload paseo-claude-code-cli-plugin # after every edit; there is no hot reload
paseo plugin logs paseo-claude-code-cli-plugin
```

The daemon compiles `index.ts` into two bundles.

`*.client.tsx` runs inside the paseo app and may only import `react`, `react-native`, `@tanstack/react-query`, `zod` and `@getpaseo/plugin`. That is why the markdown renderer and the diff are hand-rolled, and why everything is pure React Native, which is what lets the panel work on iOS and Android. `*.server.ts` runs as an unsandboxed Node subprocess beside the daemon. `*.shared.ts` holds the zod contracts that both sides use. Relative imports carry their `.ts` or `.tsx` extension so the same modules run unchanged under `node --test`.

## Known limits

- Terminal activity has no per-terminal CLI or plugin API, so the status shown in the header comes from the workspace bucket that the hooks feed. A second busy terminal in the same workspace can therefore make a session look busy.
- Pure React Native has no file picker and its clipboard is text-only, so attaching an image means giving it a file path rather than picking the file from a dialog.
- Reading dialogs off the terminal screen is inherently sensitive to the CLI version. The parsing is fixture-tested against real captures and fails soft: a screen it does not recognise becomes a card that points you at the terminal.
