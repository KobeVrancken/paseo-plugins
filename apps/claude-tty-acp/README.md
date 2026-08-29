# Interactive Claude Code ACP

Use a genuine interactive Claude Code process from Paseo's native agent view.

The adapter speaks ACP over stdio, owns one real PTY per active session, and turns Claude's transcripts and supported hooks into native Paseo messages, reasoning, tools, plans, usage, permissions, question fallbacks, models, modes, commands, attachments, cancellation, and history.
It never invokes `claude -p` and never uses the Claude Agent SDK.
The deprecated [Claude Code panel plugin](../../plugins/claude-code-panel) remains available for existing installations and is not required by this app.

## Requirements

- Linux or macOS
- Node.js 22 or newer
- pnpm
- A current Claude Code CLI authenticated on the same host as the Paseo daemon
- A Paseo version that supports custom ACP providers

## Install on a Paseo host

Clone and build this repository on every host where the provider should be available:

```sh
git clone https://github.com/sleeyax/paseo-plugins.git /opt/paseo-plugins
cd /opt/paseo-plugins
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/claude-tty-acp build
/opt/paseo-plugins/apps/claude-tty-acp/bin/claude-tty-acp --diagnose
```

Run `claude` interactively as the same OS user that runs the Paseo daemon and complete authentication before using the provider.
If the daemon runs through systemd, SSH into that account or use an equivalent login shell so Claude writes credentials into the correct home directory.

Add this provider to that host's Paseo configuration:

```json
{
  "agents": {
    "providers": {
      "traecli": {
        "extends": "acp",
        "label": "Claude Code (interactive)",
        "command": [
          "/opt/paseo-plugins/apps/claude-tty-acp/bin/claude-tty-acp"
        ],
        "params": {
          "supportsMcpServers": false
        }
      }
    }
  }
}
```

> `supportsMcpServers` refers only to MCP servers that Paseo injects over ACP, which this adapter rejects because a running interactive Claude process cannot adopt them.
> Claude's own MCP servers keep working; it loads them from its usual configuration at startup.

> The borrowed `traecli` provider ID is what makes slash commands and skills reachable from a draft agent's composer.
> See [Slash command discovery](#slash-command-discovery) before choosing a different ID.

Restart or reload the Paseo daemon after changing its provider configuration.
The executable writes ACP only to stdout and sends structured diagnostics to stderr.

## Multiple Paseo hosts

Provider setup is host-local.
When a client selects a VPS, the VPS daemon launches its own adapter and interactive Claude process, reads the VPS Claude configuration and transcripts, and streams ACP back to the client.
The local machine and VPS may use the same provider ID because they do not share processes, ports, locks, state, credentials, paths, or sessions.

Install, build, authenticate Claude, and add the provider configuration independently on each host.
The provider command must be an absolute path that exists on the selected host; it does not refer back to the client machine.

## Environment

The adapter inherits the Paseo daemon's environment.

| Variable | Purpose |
| --- | --- |
| `CLAUDE_BIN` | Absolute path to Claude when the daemon's `PATH` cannot find `claude`. |
| `CLAUDE_CONFIG_DIR` | Existing Claude configuration, credentials, plugins, commands, skills, and transcript root. |
| `CLAUDE_TTY_ACP_STATE_DIR` | Adapter session mappings and locks; defaults to the host's XDG state directory. |
| `XDG_STATE_HOME` | Base for adapter state when `CLAUDE_TTY_ACP_STATE_DIR` is unset. |

For a systemd service, set `CLAUDE_BIN` to the result of `command -v claude` from the daemon user's login shell instead of relying on a shell-specific `PATH`.

## Sessions and controls

Paseo session IDs remain stable while Claude's underlying session ID can rotate after `/clear`.
The host persists this mapping only after the first real prompt, so provider probes create no saved sessions.
Loading a session replays its transcript and launches `claude --resume` lazily on the next prompt.

Each active session has an isolated PTY, hook route, transcript reader, permission bridge, lock, and attachment directory.
Multiple sessions run concurrently; work within one session remains serialized.
A second adapter process cannot open the same active session on one host, while stale locks from dead processes are recovered.

The native model selector offers Claude Code's rolling aliases plus the full model catalog also exposed by Paseo's native Claude provider, including explicit releases and 1M-context variants.
Claude Code has no supported command for listing models without opening an interactive session, so this catalog is versioned with the adapter while `default`, `opus`, `fable`, `sonnet`, and `haiku` continue to follow Claude's rolling aliases.
The native mode selector offers Default, Accept Edits, Plan, and Auto.
Changing either control before launch changes startup flags; changing one while idle restarts and resumes Claude with deterministic flags; changing one during a turn is rejected.

## Slash command discovery

Paseo learns this adapter's slash commands, and with them Claude's skills, from an ACP `available_commands_update` notification.
The adapter sends that notification as soon as `session/new` returns, because Paseo drops any session update that carries a session ID it has not received yet.

Listing commands for an agent that does not exist yet, which is what a draft agent's composer does, spawns a throwaway session, reads the commands back, and closes it without waiting for that notification.
Paseo only waits for the first batch when the provider ID is one it special-cases, which is why this provider is registered as `traecli`: that client differs from the generic one only in waiting up to ten seconds.
The agent view shows the configured label, so the borrowed ID stays invisible, but a genuine Trae CLI provider cannot be registered next to it, and a future Paseo release may drop the special case.
Under any other provider ID the composer stays empty until the agent has taken its first turn, after which the live session has the commands cached.

## Question UI limitation

Claude's `AskUserQuestion` tool does not currently use Paseo's native question and chooser UI when this external provider is selected.
Paseo's generic ACP provider only exposes the standard ACP permission request path, so the adapter presents each question as a permission card with one action per answer.
Single-select answers work through those actions, and multi-select questions repeat the card until Done is selected.
Choose Reply in next message when the answer requires free-form text; the adapter asks Claude to restate the question conversationally and waits for the next normal message.

The native chooser is currently available only to Paseo's direct providers because plugins cannot intercept or transform ACP requests, contribute permission renderers, or emit native agent question events.
Supporting it here requires Paseo's generic ACP provider to implement ACP `session/elicitation`, or a Paseo-specific equivalent, and return structured answers to the adapter.

Images and embedded resources become mode-0600 host-local files for the duration of a turn.
Host-local file links become `@path` references.
Audio and remote resource links are rejected with an explicit error.
Claude keeps its own configured MCP servers, plugins, skills, permissions, and `CLAUDE.md` hierarchy; ACP-injected MCP servers are not supported.

## Diagnostics and development

Check the host without starting ACP:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp diagnose
```

Run automated checks without consuming Claude usage:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp typecheck
pnpm --filter @paseo-plugins/claude-tty-acp test
pnpm --filter @paseo-plugins/claude-tty-acp build
```

Run a real end-to-end smoke test through ACP and an interactive Claude PTY:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp smoke:live -- /absolute/project/path
```

The live smoke test consumes normal Claude usage and asks Claude for a fixed tool-free response.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `Could not start claude` | Set `CLAUDE_BIN` to an absolute executable path visible to the daemon. |
| SessionStart handshake timeout | Check Claude organization hook policy, inherited settings, loopback access, and the terminal snapshot in adapter stderr. |
| Claude opens a login screen | Authenticate as the Paseo daemon user and verify `HOME` or `CLAUDE_CONFIG_DIR`. |
| Persisted session not found | Sessions are host-local; select the host that created it and verify `CLAUDE_TTY_ACP_STATE_DIR`. |
| Session belongs to another cwd | Load it with its original absolute project path. |
| Session already active | Close the other native agent connection; remove a lock only after verifying its recorded PID is dead. |
| PTY exits unexpectedly | Inspect structured adapter stderr and run Claude interactively in the same cwd and environment. |
| Corrupt transcript or state | Preserve the file for diagnosis, then move only the named session JSON or transcript aside before retrying. |
| Commands or plugins missing | Verify the daemon sees the expected `CLAUDE_CONFIG_DIR`, project `.claude` files, and enabled plugin settings. |

## Upgrade and uninstall

Upgrade each host independently:

```sh
cd /opt/paseo-plugins
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/claude-tty-acp build
```

Restart the Paseo daemon after the build.
Persistent session files are versioned and remain in the configured state directory.

To uninstall, remove the `traecli` provider from that host's Paseo configuration, restart the daemon, and remove the source checkout when no other app or plugin uses it.
Delete the host's `claude-tty-acp` state directory only if session resume mappings are no longer needed.
