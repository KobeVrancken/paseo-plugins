# Claude Code CLI panel for paseo

A paseo workspace panel that renders your local Claude Code CLI sessions and lets you drive them from the paseo app, on desktop, in the browser, and on your phone.

The panel never replaces the CLI. A real interactive `claude` runs in a normal paseo terminal, so usage accounting stays normal and the session keeps syncing to the Claude mobile and web apps. The panel reads the transcript files that Claude Code writes under `~/.claude/projects/`, and it talks back to the CLI by sending keystrokes to that terminal.

## What it does

- **Pretty view of a session.** The transcript JSONL is rendered as markdown, tool cards with an Edit diff, thinking rows, todo lists, images and subagent groups. A card ships shortened detail and loads its full body when you expand it, so a long session stays cheap to poll.
- **Session picker.** Every transcript belonging to the workspace is listed newest first, and the live one is flagged.
- **Prompt box.** What you type is forwarded to the terminal running `claude`, along with the paths and URLs of anything you attach. Enter sends the prompt and Shift+Enter starts a new line, except on a phone, where Enter still breaks the line and the send button sends.
- **`@` and `/` menus.** An `@` completes a file or directory in the workspace and a `/` completes an installed skill or command, both ranked the way paseo's own composer ranks them.
- **Attachments.** Paste or pick an image, upload any other file, name a GitHub issue or pull request through your own `gh`, or attach a file by path. The picker reaches the machine showing the panel; a typed path reaches the machine paseo runs on, and a file named that way is attached where it already is rather than copied.
- **Composer controls.** The model and its effort level, thinking, and the permission mode are shown and changed by opening the CLI's own menus and reading them back, so the panel never has its own idea of what the CLI supports.
- **Answering dialogs.** Permission prompts and `AskUserQuestion` options become buttons in the panel. The terminal is always offered as the way out, and an answer that does not register is reported rather than silently dropped.
- **No double notification.** While the panel is the thing you are looking at, it tells paseo so, which stops paseo notifying you about the terminal you are already reading.

## Setup

1. Enable plugins in the daemon config (`~/.paseo/config.json`) by setting `"pluginsEnabled": true`.
2. Install and load the plugin:

   ```sh
   pnpm install
   paseo plugin install /path/to/paseo-plugins/plugins/claude-code-panel
   ```

3. Open a workspace, then open the **Claude Code** panel, either as a workspace panel or through the command center item "Open Claude Code panel".
4. The first time you open it, the panel asks to enable **terminal agent hooks**. Enabling them flips `enableTerminalAgentHooks` in the daemon config, which makes paseo install Claude Code hooks into your global `~/.claude/settings.json`. Those hooks only report running, idle and needs-input for terminals that paseo owns, and they no-op everywhere else. Until they are on, the panel is a read-only viewer. If you turn the setting on somewhere else, the panel notices within a few seconds; you do not need to reload the plugin.

`claude` has to be on the PATH of the shell that paseo opens. If it is not, starting a session says so instead of leaving you with an empty panel.

### Environment

- `PASEO_BIN` points at the `paseo` CLI. Set it if the CLI is neither on PATH nor inside the app bundle that runs the daemon.
- `CLAUDE_CONFIG_DIR` is respected when locating transcripts, exactly as Claude Code itself does.
- `gh` is what the issue and pull request search runs; a workspace it cannot answer for gets a warning rather than an error.
- Plugin state, meaning the send behavior and the terminal bindings, lives in `~/.cache/paseo-plugins/claude-code-panel/`, and so do the images and files you paste or upload. Anything cached there older than a week is deleted at startup.

## Send behavior

The ⋯ menu offers three ways to deliver a prompt.

- **CLI default** forwards it immediately, and the CLI itself queues or steers input typed mid-turn.
- **Hold until idle** waits for the session to go idle before forwarding.
- **Interrupt first** presses Esc to stop the current turn and then forwards. It is never Ctrl+C: in the Claude CLI that clears the input line, and pressing it twice exits the CLI.

## Development

```sh
pnpm typecheck
pnpm test                             # node --test, colocated, no test dependencies
paseo plugin reload claude-code-panel # after every edit; there is no hot reload
paseo plugin logs claude-code-panel
```

The commands above run in this package. From the workspace root, `pnpm typecheck` and `pnpm test` run every package's.

The daemon compiles `index.ts` into two bundles. `index.ts` and `paseo-plugin.json` have to stay at the plugin root; the rest of the code lives under `src/`, split into `src/server`, `src/client` and the shared contracts.

`*.client.tsx` runs inside the paseo app and may only import `react`, `react-native`, `@tanstack/react-query`, `zod` and `@getpaseo/plugin`. That is why the markdown renderer, the diff and the autocomplete menus are hand-rolled, and why everything is pure React Native, which is what lets the panel work on iOS and Android. `*.server.ts` runs as an unsandboxed Node subprocess beside the daemon. `*.shared.ts` holds the zod contracts that both sides use. Relative imports carry their `.ts` or `.tsx` extension so the same modules run unchanged under `node --test`.

## Known limits

- Terminal activity has no per-terminal CLI or plugin API, so the status shown in the header comes from the workspace bucket that the hooks feed. A second busy terminal in the same workspace can therefore make a session look busy.
- The host hands a plugin no file dialog, so the picker is the browser's own and only exists on web. On a phone, attaching a file means naming it by path.
- Reading dialogs off the terminal screen is inherently sensitive to the CLI version. The parsing is fixture-tested against real captures and fails soft: a screen it does not recognise becomes a card that points you at the terminal.
