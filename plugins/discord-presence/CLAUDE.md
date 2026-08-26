# Working on this plugin

## The backend runs without anyone opening the UI, and that shapes everything

The presence must be live whenever Paseo is open, but the plugin host hands the server side only `{ handle }`, and the `paseo` API arrives as an RPC handler's second argument.
Nothing calls an RPC until a client opens the settings surface, so the service keeps its own daemon connection instead (`src/server/daemon.server.ts`) and starts from module scope in `src/server/service.server.ts`.

That connection resolves its address the way the CLI does: `PASEO_HOST`, then `PASEO_LISTEN`, then `listen` in `$PASEO_HOME/paseo.pid`, then `daemon.listen` in the config, then `127.0.0.1:6767`, dialled as `ws://<host>/ws`.
The plugin subprocess inherits the daemon's environment, so `PASEO_PASSWORD` is there when the daemon was started with one.
A daemon on a unix socket is out of reach, because the SDK dials through `globalThis.WebSocket`.

A client id beginning with `plugin:` is routed to the daemon's own plugin session handling and its handshake never completes — the socket just hangs, with no error.
Do not name the connection after the plugin id.

## No CommonJS dependencies survive the daemon's compiler

`makeHermesInteropEager` rewrites every `get: () => from[key]` into `value: from[key]` across the whole bundle, so esbuild's lazy CommonJS interop is evaluated before the module it reads from has run.
Any dependency built by tsup or esbuild — which is most of them — then exports `undefined`, and the failure looks like `class extends value undefined is not a constructor`.
Pre-bundling the dependency does not help; its own interop helpers carry the same pattern.
This is why the Discord IPC client is written out in `src/server/ipc.server.ts` rather than taken from `@xhayper/discord-rpc`.

## What the daemon actually reports

`workspace.activityAt` is null on every workspace in practice, so the `activity_at` sort is not a ranking and the model ranks workspaces itself, treating a live status as activity now and falling back to `statusEnteredAt`.
A workspace's `name` is frequently a title an agent generated for the task, not a branch — the reason the detail levels exist.
`agents.list({ scope: "active" })` still returns closed sessions, so the tally filters them.

The daemon knows which workspace has focus — the app heartbeats `focusedAgentId` and `appVisible` — but keeps it private to the session that sent it, so no plugin can read it.
Ranking by recency is the substitute, not a placeholder for an API that exists.

## Verifying without restarting the daemon

`paseo plugin install` is a silent no-op against this daemon, for any directory, including known-good ones.
The plugin is registered by hand in `~/.paseo/config.json`, and the daemon only reads that at startup, so a restart is what picks it up.

Until then, compile and run the real bundle:

```
node --input-type=module -e "
import fs from 'node:fs';
const { compilePlugin } = await import('<paseo>/packages/server/dist/server/server/plugins/compiler.js');
const out = await compilePlugin('<plugin>/index.ts');
fs.writeFileSync('/tmp/dp-server-bundle.cjs', out.serverBundle);
"
```

Then evaluate it the way `plugin-process.js` does — `factory(runtimeRequire)`, with `@getpaseo/plugin` stubbed to `{ defineRpc }` — call `exports.default({ handle })`, and drive the registered handlers.
This catches everything the typechecker cannot: the AST filter, the interop rewrite, the daemon handshake, and the Discord socket.

## Reload after editing

Run `paseo plugin reload discord-presence` after every change, then `paseo plugin logs discord-presence`.
The reload is also the only compile check of the two bundles the daemon builds.
Do this yourself; never leave it to the user.

## index.ts is AST-filtered

The daemon builds a client and a server bundle from the same entry, deleting every `plugin.handle(...)` statement and `*.server` import for the client, and every `plugin.add*` statement and `*.client` import for the server.
The deletion is textual, so only ever mention a server module inside `plugin.handle(...)` and a client module inside `plugin.add*`.
The entry must default-export one function taking one named parameter with a block body, and `index.ts` and `paseo-plugin.json` must sit at the plugin root.

RPC names must match `^[a-z][a-z0-9._-]*$`.

## Tests

`pnpm test` is `node --test "src/**/*.test.ts"`, running the modules through Node's type stripping with no test dependencies.
No TypeScript that has to be emitted: no parameter properties, no enums, no namespaces.
Relative imports carry their `.ts` extension.

Tests must not import `contracts.shared.ts`, because `@getpaseo/plugin/server` only exists inside the daemon.
Keep the decisions in modules the tests can reach: the presence model, the settings coercion, the write throttle, the daemon URL, the IPC framing.
`src/fixtures/` holds real daemon payloads with the paths scrubbed; re-capture them from a live daemon rather than inventing the shape.
