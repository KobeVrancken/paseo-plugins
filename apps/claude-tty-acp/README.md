# Interactive Claude Code ACP

Run the genuine interactive Claude Code CLI as a native Paseo agent.

Paseo speaks [ACP](https://agentclientprotocol.com) to this adapter, and the adapter keeps a single real `claude` process in a PTY per session.
It translates that process's transcripts and hooks into native Paseo messages, reasoning, tool calls, plans, usage, permissions, models, modes, slash commands, attachments, cancellation, and history.
There is no `claude -p` and no Claude Agent SDK anywhere in the path.

## Why?

Paseo's built-in Claude agent runs on the Claude Agent SDK.
Agent SDK integrations appear to consume usage limits faster than the Claude Code CLI or its editor extensions, [as reported for t3code and similar tools](https://github.com/pingdotgg/t3code/issues/7338#issuecomment-5426425282); whether the cause is the SDK, its integrations, or Anthropic's backend is unclear.

This adapter avoids the SDK by driving the same CLI you would otherwise run in a terminal.
You keep its binary, authentication, billing, sessions, `CLAUDE.md` hierarchy, MCP servers, plugins, skills, and permission rules, and get Paseo's native agent UI on top of them.
The price is that every native affordance has to be reconstructed from terminal output, transcript files, and hooks, which is where the [limitations](#limitations) come from.

The [Claude Code panel plugin](../../plugins/claude-code-panel) solved the same problem inside a workspace panel.
It is deprecated in favour of this app, still works for existing installations, and is not required here.

## Requirements

- Linux or macOS
- Node.js 22 or newer
- pnpm
- A current Claude Code CLI, authenticated on the same host as the Paseo daemon
- A Paseo version that supports custom ACP providers

## Installation

Setup is host-local: the adapter runs wherever the Paseo daemon runs, so repeat every step below on each host that should offer Claude.
See [Multiple hosts](#multiple-hosts) for what that means in practice.

### 1. Build the adapter

```sh
git clone https://github.com/sleeyax/paseo-plugins.git /opt/paseo-plugins
cd /opt/paseo-plugins
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/claude-tty-acp build
/opt/paseo-plugins/apps/claude-tty-acp/bin/claude-tty-acp --diagnose
```

### 2. Authenticate Claude

Run `claude` interactively as the same OS user that runs the Paseo daemon, and complete authentication before using the provider.
If the daemon runs through systemd, SSH into that account or use an equivalent login shell so Claude writes its credentials into the correct home directory.

### 3. Register the provider

Add the provider to that host's Paseo configuration:

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

Restart or reload the Paseo daemon afterwards.

A few details in that snippet are deliberate:

- `supportsMcpServers: false` refers only to MCP servers that Paseo injects over ACP, which a running interactive Claude process cannot adopt.
  Claude's own MCP servers are unaffected; it loads them from its usual configuration at startup.
- The provider ID is `traecli` because Paseo special-cases that ID when listing slash commands.
  See [slash commands need a borrowed provider ID](#slash-commands-need-a-borrowed-provider-id) before choosing another.

`label` is what the agent view displays, so it can say anything.

### Multiple hosts

Hosts share nothing: no processes, ports, locks, state, credentials, paths, or sessions.
Selecting a VPS in a client makes that VPS's daemon launch its own adapter and Claude process, read the VPS's Claude configuration and transcripts, and stream ACP back to the client.
The same provider ID is therefore safe to use everywhere.

The `command` path must be absolute and must exist on the selected host; it is never resolved against the client machine.

## Environment

The adapter inherits the Paseo daemon's environment.

| Variable | Purpose |
| --- | --- |
| `CLAUDE_BIN` | Absolute path to Claude when the daemon's `PATH` cannot find `claude`. |
| `CLAUDE_CONFIG_DIR` | Existing Claude configuration, credentials, plugins, commands, skills, and transcript root. |
| `CLAUDE_TTY_ACP_STATE_DIR` | Adapter session mappings and locks; defaults to the host's XDG state directory. |
| `XDG_STATE_HOME` | Base for adapter state when `CLAUDE_TTY_ACP_STATE_DIR` is unset. |

For a systemd service, set `CLAUDE_BIN` to the output of `command -v claude` in the daemon user's login shell rather than relying on a shell-specific `PATH`.

## Sessions

Paseo session IDs stay stable even though Claude's own session ID can rotate after `/clear`.
The mapping is persisted only after the first real prompt, so provider probes leave no saved sessions behind.
Loading a session replays its transcript and launches `claude --resume` lazily on the next prompt.

Each active session owns an isolated PTY, hook route, transcript reader, permission bridge, lock, and attachment directory.
Sessions run concurrently, work inside a single session stays serialized, and a second adapter process cannot open a session that is already active on the host.
Locks left behind by dead processes are recovered automatically.

## Models and modes

The model selector offers Claude Code's rolling aliases — `inherit`, `opus`, `fable`, `sonnet`, `haiku` — plus the full catalog that Paseo's native Claude provider exposes, including explicit releases and 1M-context variants.
Claude Code has no supported way to list models without opening an interactive session, so that catalog is versioned with the adapter while the aliases keep following Claude's.

The mode selector offers Default, Accept Edits, Plan, and Auto.

Changing either control before launch changes startup flags.
Changing one while idle restarts and resumes Claude with deterministic flags, and changing one during a turn is rejected.

## Prompt content

Images and embedded resources become mode-0600 host-local files for the duration of a turn.
Host-local file links become `@path` references.
Audio and remote resource links are rejected with an explicit error.

## Limitations

Claude keeps its own MCP servers, plugins, skills, permissions, and `CLAUDE.md` hierarchy, but MCP servers injected by Paseo over ACP are rejected, as explained in [step 3](#3-register-the-provider).

### Slash commands need a borrowed provider ID

Paseo learns this adapter's slash commands, and with them Claude's skills, from an ACP `available_commands_update` notification.
The adapter sends it as soon as `session/new` returns, because Paseo drops any session update carrying a session ID it has not received yet.

A draft agent's composer lists commands for an agent that does not exist yet: Paseo spawns a throwaway session, reads the commands back, and closes it, waiting for that first batch only when the provider ID is one it special-cases.
`traecli` is such an ID, and its client differs from the generic one only by waiting up to 10 seconds, which is why this provider borrows it.
Under any other ID the composer stays empty until the agent has taken its first turn, after which the live session has the commands cached.

The configured label is what users see, so the borrowed ID stays invisible, but a genuine Trae CLI provider cannot be registered next to it and a future Paseo release may drop the special case.

Related, a draft must carry a model ID that is not literally `default`: Paseo reads `default` as "no model selected" and returns an empty list before the adapter ever launches, which is why the pass-through entry is named `inherit` instead.

### Questions arrive as permission cards

Claude's `AskUserQuestion` tool cannot use Paseo's native question and chooser UI while an external provider is selected, because Paseo's generic ACP provider exposes only the standard ACP permission request path.
The adapter renders each question as a permission card with an action per answer: single-select answers work through those actions, and multi-select questions repeat the card until Done is selected.
Choose *Reply in next message* when an answer needs free-form text; the adapter asks Claude to restate the question conversationally and waits for the next normal message.

The native chooser is available only to Paseo's direct providers, because plugins cannot intercept or transform ACP requests, contribute permission renderers, or emit native agent question events.
Supporting it here requires Paseo's generic ACP provider to implement ACP `session/elicitation`, or a Paseo-specific equivalent, and return structured answers to the adapter.

### Auto mode can hang on the denial limit

Auto mode decides permissions with a classifier, and after 3 consecutive or 20 total classifier denials Claude Code stops deciding and asks the person at the keyboard instead.
That escalation deliberately bypasses every remote channel — the `PermissionRequest` hook, Claude's bridge, and its channel callbacks — so the adapter is never consulted and Paseo shows no permission card.
Claude then waits at a dialog inside its PTY and no `Stop` hook follows, so the turn never finishes: the first escalation in a session denies itself after 2 minutes, every later one waits indefinitely, and meanwhile a new prompt is rejected because the session still has an active turn.

Cancel the turn from Paseo to recover, which sends Escape into the PTY and dismisses the dialog.
Default mode avoids the limit entirely, because there every decision reaches the adapter through the `PermissionRequest` hook.
Claude does report the wait over its `Notification` hook, which the adapter does not register yet, so a future release can surface the dialog or end the turn with an explicit error instead of hanging.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `Could not start claude` | Set `CLAUDE_BIN` to an absolute executable path visible to the daemon. |
| SessionStart handshake timeout | Check Claude organization hook policy, inherited settings, loopback access, and the terminal snapshot in adapter stderr. |
| Claude opens a login screen | Authenticate as the Paseo daemon user and verify `HOME` or `CLAUDE_CONFIG_DIR`. |
| Persisted session not found | Select the host that created it and verify `CLAUDE_TTY_ACP_STATE_DIR`. |
| Session belongs to another cwd | Load it with its original absolute project path. |
| Session already active | Close the other native agent connection; remove a lock only after verifying its recorded PID is dead. |
| Turn never finishes in Auto mode | Claude is waiting at a keyboard-only dialog after the classifier denial limit; cancel the turn and prefer Default mode. |
| PTY exits unexpectedly | Inspect structured adapter stderr and run Claude interactively in the same cwd and environment. |
| Corrupt transcript or state | Preserve the file for diagnosis, then move only the named session JSON or transcript aside before retrying. |
| Commands or plugins missing | Verify the daemon sees the expected `CLAUDE_CONFIG_DIR`, project `.claude` files, and enabled plugin settings. |

## Development

The executable writes ACP only to stdout and sends structured diagnostics to stderr, so stderr is the place to look when something misbehaves.

Check a host without starting ACP:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp diagnose
```

Run the automated checks, none of which consume Claude usage:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp typecheck
pnpm --filter @paseo-plugins/claude-tty-acp test
pnpm --filter @paseo-plugins/claude-tty-acp build
```

Run a real end-to-end smoke test through ACP and an interactive Claude PTY:

```sh
pnpm --filter @paseo-plugins/claude-tty-acp smoke:live -- /absolute/project/path
```

The live smoke test asks Claude for a fixed tool-free response and consumes normal Claude usage.

## Upgrading and uninstalling

Upgrade each host independently, then restart the Paseo daemon:

```sh
cd /opt/paseo-plugins
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/claude-tty-acp build
```

Persistent session files are versioned and survive upgrades in the configured state directory.

To uninstall, remove the provider from the host's Paseo configuration, restart the daemon, and delete the source checkout once no other app or plugin uses it.
Remove the host's `claude-tty-acp` state directory only if the session resume mappings are no longer needed.
