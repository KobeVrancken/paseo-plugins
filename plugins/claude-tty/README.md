# Claude TTY

Install, diagnose, and manage the [Claude TTY ACP adapter](../../apps/claude-tty-acp) on the host running the Paseo daemon.

The adapter's own setup is a checklist a person follows on each host: build it, check it, add a provider entry, reload the daemon. This plugin does that from Paseo's sidebar instead, on whichever host is selected.

## Screenshots

_None yet._

## Installation

```sh
paseo plugin install "/absolute/path/to/paseo-plugins/plugins/claude-tty"
```

The plugin manages the checkout it was itself installed from, so install it from the same clone that holds `apps/claude-tty-acp`. Build the adapter there first:

```sh
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/claude-tty-acp build
```

Then open **Claude TTY** in the Paseo sidebar and press **Install**.

That checks the adapter is built, runs its host checks, registers the `traecli` provider, and asks Paseo to re-probe its providers. No daemon restart is needed. The adapter README explains [why the provider ID is borrowed](../../apps/claude-tty-acp/README.md#slash-commands-need-a-borrowed-provider-id).

Two things stay yours to arrange, because the plugin cannot do them for you:

- **A built adapter.** The plugin never builds one: it reports whether `apps/claude-tty-acp/dist/cli.js` exists and refuses to register a provider pointing at an executable that would not start. Rebuild it by hand after pulling, then press **Install** again.
- **An authenticated Claude.** Run `claude` interactively as the user the daemon runs as. The plugin never touches Claude's configuration, credentials, or transcripts.

Everything is host-local: selecting another host in Paseo shows that host's own answer, and each host is installed separately.

## Settings

The plugin has no settings of its own. What it manages is the `agents.providers.traecli` entry in that host's Paseo configuration, which it only ever writes when nothing else holds the ID.

An entry pointing at a different checkout is reported as a mismatch and left alone until you press **Point it at this checkout**, and an entry the plugin does not recognise is never written over at all.

## Troubleshooting

**Diagnostics** runs the host checks of the executable the daemon would actually launch — not the one this checkout builds — and shows Paseo's own provider diagnostic beneath them. A stale entry pointing somewhere else is exactly what that distinction catches.

**Sessions** lists the adapter's saved sessions and the locks over them. A lock names the process holding a session; the adapter clears its own on exit and recovers one left by a dead process, so releasing by hand is only for a lock that outlived its process and is still in the way. Releasing is refused while the recorded process is alive. A session file that cannot be read can be moved aside rather than deleted, so the failure is still there to diagnose.

The adapter's [troubleshooting table](../../apps/claude-tty-acp/README.md#troubleshooting) covers everything that goes wrong once a session is running.

The **Danger zone** removes the provider entry and nothing else. Deleting the state directory is a separate opt-in, refused while a session is open, and the source checkout is never touched.

## Development

```sh
paseo plugin reload claude-tty
paseo plugin logs claude-tty
```

```sh
pnpm --filter @paseo-plugins/claude-tty typecheck
pnpm --filter @paseo-plugins/claude-tty test
```

See [CLAUDE.md](./CLAUDE.md) for the constraints that are not obvious from the code.
