# Working on this plugin

## Always reload after editing

Run `paseo plugin reload paseo-claude-code-cli-plugin` after every change, then check `paseo plugin logs paseo-claude-code-cli-plugin` for `Plugin ready`.
There is no hot reload, and the reload is also the only compile check of the two bundles the daemon builds.
Do this yourself; never leave it to the user.

## index.ts is AST-filtered, and that constrains how it may be written

The daemon compiles `index.ts` into a client and a server bundle from the same source.
For the client bundle it deletes every `plugin.handle(...)` expression statement and every import of a `*.server` module; for the server bundle it deletes the `plugin.add*` statements and the `*.client` imports.

The deletion is textual, so a stripped import leaves any surviving reference to it as an undefined global that crashes at runtime.
Only ever mention a server module inside a `plugin.handle(...)` statement, and a client module inside a `plugin.add*` statement.
No top-level `const handlers = createHandlers()`, no helper that registers handlers on your behalf: server modules keep their own module-level state instead.

The entry must default-export exactly one function taking one named parameter and having a block body, or the plugin fails to load.

`index.ts` and `paseo-plugin.json` have to sit at the plugin root, because the loader stats exactly those names and the entry filename is not configurable.
Everything else lives under `src/`; esbuild resolves from the plugin directory, and the client/server boundary is keyed on the `.client` / `.server` filename suffix rather than on the directory, so nesting is free.

RPC names must match `^[a-z][a-z0-9._-]*$`, so `sessions.list`, never `listSessions`; a capital letter fails the load with "Invalid plugin RPC method".

The client bundle treats only `react`, `react-native`, `react/jsx-runtime`, `@tanstack/react-query`, `zod` and `@getpaseo/plugin` as external, and stubs `node:*` imports to an empty object rather than failing the build, so an accidental Node import only shows up at runtime.

## Tests

`pnpm test` is `node --test "src/**/*.test.ts"`, running the real modules through Node's type stripping, with no test dependencies.
That means no TypeScript syntax that has to be emitted: no parameter properties (`constructor(private x)`), no enums, no namespaces.
It also means relative imports must carry their `.ts` or `.tsx` extension everywhere in the project, which is why `allowImportingTsExtensions` is on.
Tests must not import `contracts.shared.ts`, because `@getpaseo/plugin/server` only exists inside the daemon; keep pure logic in modules that do not reach for the SDK.
Tests sit next to the module they cover, and their fixtures next to them in `src/server/fixtures/`.
Nothing imports them from `index.ts`, so they never reach either bundle.

## What the surrounding tools actually do

`paseo terminal ls --json` returns only id, name and cwd.
Per-terminal agent-hook activity exists in the daemon protocol but no CLI or plugin API exposes it, so session status is read from the workspace bucket, which aggregates every terminal and agent in that workspace.
With `--cwd`, the `cwd` field of each row is the directory you asked for rather than the terminal's own.

`paseo terminal send-keys` needs `--` before the keys or text starting with a dash is parsed as an option.
Pass `--literal` for anything the user typed, so a prompt containing the word "Enter" is not translated into a carriage return.
Interrupt a turn with `Escape`; Ctrl+C clears the Claude CLI's input line and exits it when pressed twice.

A pending option dialog is not in the transcript at all: Claude Code writes the `AskUserQuestion` tool call only once it has been answered, and paseo's hooks report needs-input only for an idle prompt, so a live question can only be seen by capturing the terminal screen.

Every `paseo` CLI call boots Electron-as-node and costs roughly a second of CPU, so nothing may poll `terminal capture` on a fixed timer.
The panel probes once when a session is opened and then only while the transcript has gone quiet after recent activity, backing off the longer nothing appears.

Claude Code writes `~/.claude/projects/<cwd with every non-alphanumeric replaced by a dash>/<session-id>.jsonl`, and the file does not exist until the session's first prompt.
In its option dialogs a digit selects an option in a single-select and toggles it in a multi-select, which is then submitted with the right arrow followed by `1`.

## Coverage of the transcript format

Anything the Claude Code terminal puts on screen belongs in the timeline; anything it only injects into the model's context does not.
Most `attachment` lines are the latter (token and todo reminders, tool and agent listings, IDE file syncs), while a few are the former (attached files, IDE selections, diagnostics, hook messages, mode changes), so they are split by an explicit allow list either way.
A kind that matches neither list is logged once per session as `no renderer for transcript kind "..."`, which is the signal that the CLI has grown something new; sweep the local transcripts with `TimelineBuilder` after a CLI upgrade to find them in bulk.

## Payload discipline

The panel polls, and a long transcript is mostly tool output nobody reads.
Keep the timeline response small: it ships a window of recent entries with shortened tool detail and no inlined image data, and full bodies come from `timeline.entry` when a card is expanded.
Before changing what the timeline returns, measure it against a real transcript; a 23 MB session once produced a 10 MB response.

## Verifying against the live CLI

Probes cost the user's Claude usage and appear in their app as real terminals they may start typing into.
Prefer fixtures in `test/fixtures/` for anything already captured, spend a prompt only on something genuinely unverified, and kill probe terminals you created.
