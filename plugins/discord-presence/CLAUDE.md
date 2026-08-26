# Working on this plugin

Run `paseo plugin reload discord-presence` after every change, then `paseo plugin logs discord-presence`.
The reload is the only compile check of the two bundles the daemon builds.
Do this yourself; never leave it to the user.

## Constraints that are not obvious

The server side is handed only `{ handle }`, and `paseo` arrives as an RPC handler's second argument, so nothing exists until a client calls in.
A presence that must be live before anyone opens the UI therefore keeps its own daemon connection (`src/server/daemon.server.ts`), started from module scope in `service.server.ts`.
A client id beginning with `plugin:` is routed to the daemon's internal plugin session and hangs forever with no error, so the connection is not named after the plugin id.

No CommonJS dependency survives the daemon's compiler: `makeHermesInteropEager` rewrites esbuild's lazy interop getters into eager reads, so anything built by tsup or esbuild exports `undefined` and fails as `class extends value undefined`.
Pre-bundling does not help. That is why the Discord IPC client is written out in `src/server/ipc.server.ts`.

`workspace.activityAt` is null in practice, so the daemon's `activity_at` sort is not a ranking and the model ranks workspaces itself.
A workspace's `name` is often a title an agent generated, which is what the detail levels are for.
`agents.list({ scope: "active" })` still returns closed sessions.
The focused workspace is unreadable: the app heartbeats it, but the daemon keeps it private to the session that sent it.

## index.ts is AST-filtered

The daemon builds both bundles from the entry, deleting `plugin.handle(...)` and `*.server` imports for the client, and `plugin.add*` and `*.client` imports for the server.
The deletion is textual, so only mention a server module inside `plugin.handle(...)` and a client module inside `plugin.add*`.
The entry must default-export one function taking one named parameter with a block body, and RPC names must match `^[a-z][a-z0-9._-]*$`.

## Tests

`pnpm test` is `node --test "src/**/*.test.ts"` through Node's type stripping, so no TypeScript that has to be emitted and relative imports keep their `.ts` extension.
Tests must not import `contracts.shared.ts`, because `@getpaseo/plugin/server` only exists inside the daemon — keep the decisions in modules the tests can reach.
`src/fixtures/` holds real daemon payloads with the paths scrubbed.

`paseo plugin install` is a silent no-op against this daemon for any directory, so the plugin is registered by hand in `~/.paseo/config.json` and picked up on the next daemon start.
To exercise a change without restarting the daemon, compile `index.ts` with the daemon's own `compilePlugin` and evaluate the bundle the way `plugin-process.js` does, with `@getpaseo/plugin` stubbed to `{ defineRpc }`.
Point `XDG_CACHE_HOME` somewhere disposable when you do: the settings file is the real one otherwise.
