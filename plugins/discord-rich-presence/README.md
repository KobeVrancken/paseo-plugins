# Discord Presence

Show your friends on Discord what you are working on in Paseo. Requires the Paseo daemon and the Discord app to be running on the same machine.

## Screenshots

![presence example 1](./docs/screenshots/presence2.png)

![presence example 2](./docs/screenshots/presence1.png)

![presence example 3](./docs/screenshots/presence3.png)

## Installation

```sh
paseo plugin install "/absolute/path/to/paseo-plugins/plugins/discord-rich-presence"
```

Discord will not show a presence until you own an application for it, and only you can create one.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and press **New Application**.
   Name it **Paseo**: Discord renders the application's name as the bold first line, so anything else is what your friends will read.
2. On **General Information**, copy the **Application ID**.
3. Open **Rich Presence → Art Assets** and upload the six files in `assets/`, each keeping its filename as its asset key: `paseo`, `needs_input`, `failed`, `running`, `attention`, `idle`.
   Uploaded art can take a few minutes before Discord serves it.
4. In Paseo, open **Discord Presence** in the sidebar, paste the Application ID, and press **Save**.

The header of that screen tells you where you stand: _Not set up yet_, _Discord not running — retrying…_, or _Connected to Discord_.
Nothing is sent, and no connection is attempted, until an Application ID is saved.
Discord must be running on the same machine as the Paseo daemon; the presence talks to it over a local socket, and covers native, Snap and Flatpak installs.

## Settings

Settings live in the sidebar screen, and in the Command Center as _Discord rich presence: turn off_, _turn on_, _mute this project_ and _unmute this project_.

**Detail level** decides how much of your work is named:

| Level         | First line             | Second line                      |
| ------------- | ---------------------- | -------------------------------- |
| Detailed      | `paseo-plugins — main` | `3 workspaces · 1 agent running` |
| Projects only | `paseo-plugins`        | `3 workspaces`                   |
| Anonymous     | `Using Paseo`          | —                                |

Worth knowing before you pick: a workspace's name is often a title an agent wrote for the task, so Detailed can put something like `acme-billing — Invoke the wayfinder skill` on your profile.
**Projects only** keeps the repository name and drops that.

**Muting a project** hides the names of every workspace in it.
A muted project is redacted rather than removed: the presence falls through to another project that has live work in it, and shows the Anonymous rendering when there is none.
It will not fall through to a project that merely ranks next, because a project you finished with yesterday is not what you want promoted onto your profile the moment you mute the one you are actually in.
Going dark entirely would announce that you switched something off, which is its own signal.

Mutes are keyed by the project's root path, and stay in the list after you close the project so you can lift them later.

**Turning it off** closes the socket, so Paseo disappears from your profile immediately.

The badge has one colour per state, matching the dot Paseo draws beside the same workspace in its sidebar:

| Badge | Hover text             | What it means                                                |
| ----- | ---------------------- | ------------------------------------------------------------ |
| Amber | Waiting for permission | An agent is blocked asking you to approve something.         |
| Red   | Failed                 | An agent errored.                                            |
| Blue  | Running                | An agent is working.                                         |
| Green | Finished — your turn   | An agent ended its turn and is waiting on your next message. |
| Grey  | Idle                   | Nothing is happening in that workspace.                      |

Green is the one that surprises people: Paseo raises it the moment a turn ends, and clears it once you look at the session, so it flashes up briefly every time a conversation finishes.
That is Paseo telling you it is your move, not an error.

## Troubleshooting

| Symptom                                   | Cause                                                                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Discord refused this application ID_     | The ID is not one of your applications. Copy it again from General Information and save it; a refusal is not retried, since only a new ID can change the answer.                                                  |
| _Discord not running — retrying…_         | Discord is closed, or its socket is somewhere this does not look. The connection retries on its own, backing off to a minute.                                                                                     |
| _Cannot read Paseo_                       | The plugin could not reach the daemon. It reads the address from `PASEO_HOST`, `PASEO_LISTEN`, `$PASEO_HOME/paseo.pid` and the daemon config, in that order, and cannot dial a daemon listening on a unix socket. |
| The icon shows but the images are missing | The asset keys do not match, or Discord has not finished processing the upload.                                                                                                                                   |

Run `paseo plugin logs discord-rich-presence` for anything else.

## Development

```sh
pnpm typecheck
pnpm test                                  # node --test, colocated, no test dependencies
paseo plugin reload discord-rich-presence  # after every edit; there is no hot reload
paseo plugin logs discord-rich-presence
```

The daemon compiles `index.ts` into a client and a server bundle, so `index.ts` and `paseo-plugin.json` stay at the plugin root and everything else lives under `src/`.
`*.client.tsx` runs inside the paseo app, `*.server.ts` as a Node subprocess beside the daemon, and `*.shared.ts` holds the presence model and the zod contracts both sides use.
The presence has to be live before anyone opens the settings screen, so the server keeps its own daemon connection rather than waiting for a client to call in.
The Discord IPC client is written out by hand in `src/server/ipc.server.ts` because no CommonJS dependency survives the daemon's compiler.

To re-render the art after Paseo changes its own, run `scripts/render-assets.sh /path/to/paseo`.

## License and attributions

`assets/` is rendered from Paseo's own artwork in [getpaseo/paseo](https://github.com/getpaseo/paseo) (`packages/app/assets/images`), which is AGPLv3.
The large image is Paseo's app icon; the status dots are bare circles in the colours Paseo uses beside its own workspace rows.
This repository carries no licence of its own yet, which is worth settling before publishing it anywhere.
