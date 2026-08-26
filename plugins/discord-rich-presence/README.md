# Discord Presence

Shows what you are doing in Paseo on your Discord profile, for as long as Paseo is open.

```
[icon]  Paseo
        paseo-plugins — main
        3 workspaces · 1 agent running
        02:14 elapsed
```

The first line is the project and workspace Paseo saw activity in most recently, the second counts every open workspace and what its agents are doing, and the badge on the icon says which state that workspace is in.
Half an hour after the last thing happens the first line drops back to *Using Paseo*, so your profile stops advertising a workspace you have long since walked away from.

The badge has one colour per state, matching the dot Paseo draws beside the same workspace in its sidebar:

| Badge | Hover text | What it means |
| --- | --- | --- |
| Amber | Waiting for permission | An agent is blocked asking you to approve something. |
| Red | Failed | An agent errored. |
| Blue | Running | An agent is working. |
| Green | Finished — your turn | An agent ended its turn and is waiting on your next message. |
| Grey | Idle | Nothing is happening in that workspace. |

Green is the one that surprises people: Paseo raises it the moment a turn ends, and clears it once you look at the session, so it flashes up briefly every time a conversation finishes.
That is Paseo telling you it is your move, not an error.

## Setup

Discord will not show a presence until you own an application for it, and only you can create one.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and press **New Application**.
   Name it **Paseo**: Discord renders the application's name as the bold first line, so anything else is what your friends will read.
2. On **General Information**, copy the **Application ID**.
3. Open **Rich Presence → Art Assets** and upload the six files in `assets/`, each keeping its filename as its asset key: `paseo`, `needs_input`, `failed`, `running`, `attention`, `idle`.
   Uploaded art can take a few minutes before Discord serves it.
4. In Paseo, open **Discord Presence** in the sidebar, paste the Application ID, and press **Save**.

The header of that screen tells you where you stand: *Not set up yet*, *Discord not running — retrying…*, or *Connected to Discord*.
Nothing is sent, and no connection is attempted, until an Application ID is saved.
Discord must be running on the same machine as the Paseo daemon; the presence talks to it over a local socket, and covers native, Snap and Flatpak installs.

To re-render the art after Paseo changes its own, run `scripts/render-assets.sh /path/to/paseo`.

## Controlling what is shown

**Detail level** decides how much of your work is named:

| Level | First line | Second line |
| --- | --- | --- |
| Detailed | `paseo-plugins — main` | `3 workspaces · 1 agent running` |
| Projects only | `paseo-plugins` | `3 workspaces` |
| Anonymous | `Using Paseo` | — |

Worth knowing before you pick: a workspace's name is often a title an agent wrote for the task, so Detailed can put something like `acme-billing — Invoke the wayfinder skill` on your profile.
**Projects only** keeps the repository name and drops that.

**Muting a project** hides the names of every workspace in it.
A muted project is redacted rather than removed: the presence falls through to another project that has live work in it, and shows the Anonymous rendering when there is none.
It will not fall through to a project that merely ranks next, because a project you finished with yesterday is not what you want promoted onto your profile the moment you mute the one you are actually in.
Going dark entirely would announce that you switched something off, which is its own signal.

Mutes are keyed by the project's root path, and stay in the list after you close the project so you can lift them later.

**Turning it off** closes the socket, so Paseo disappears from your profile immediately.

Both live in the sidebar screen, and in the Command Center as *Discord presence: turn off*, *turn on*, *mute this project* and *unmute this project*.

## Where the settings live

`~/.cache/paseo-plugins/discord-rich-presence/settings.json`, because the daemon config drops keys it does not know.
The file is yours to edit; the plugin re-reads it when it starts.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| *Discord refused this application ID* | The ID is not one of your applications. Copy it again from General Information and save it; a refusal is not retried, since only a new ID can change the answer. |
| *Discord not running — retrying…* | Discord is closed, or its socket is somewhere this does not look. The connection retries on its own, backing off to a minute. |
| *Cannot read Paseo* | The plugin could not reach the daemon. It reads the address from `PASEO_HOST`, `PASEO_LISTEN`, `$PASEO_HOME/paseo.pid` and the daemon config, in that order, and cannot dial a daemon listening on a unix socket. |
| The icon shows but the images are missing | The asset keys do not match, or Discord has not finished processing the upload. |

Run `paseo plugin logs discord-rich-presence` for anything else.

## Artwork

`assets/` is rendered from Paseo's own artwork in [getpaseo/paseo](https://github.com/getpaseo/paseo) (`packages/app/assets/images`), which is AGPLv3.
The large image is Paseo's app icon; the status dots are bare circles in the colours Paseo uses beside its own workspace rows.
This repository carries no licence of its own yet, which is worth settling before publishing it anywhere.
