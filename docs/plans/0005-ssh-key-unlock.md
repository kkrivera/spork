# 0005 — Asking for an SSH key's passphrase, one command at a time

Status: Implemented

## Problem

spork runs git with prompts off everywhere except a single `repo add` (see
`git/auth.ts`'s `NO_PROMPT_ENV`). That's necessary: `workspace create` and
`add-repo` clone and fetch several repos concurrently under a live
dashboard, so a passphrase prompt would be erased by the next redraw, or
several would fight over the terminal and the command would look hung.

The cost is that anyone whose SSH key has a passphrase, and who hasn't
loaded it into an ssh-agent, gets an authentication error from every
SSH-backed repo. The only fix today is running `ssh-add` by hand first.

Asking for the passphrase once and letting git prompt doesn't work either:
ssh needs it again on every connection, and one `create` makes several
(the pushed-branch check, then a clone or fetch per repo, then any
submodules).

## Decisions

- **Ask every command, never persist.** A key spork unlocks is available
  only to that one `create`/`add-repo`, then forgotten. spork never adds
  anything to the user's own ssh-agent and never writes to the macOS
  Keychain. A key the user loaded into their own agent themselves
  (`ssh-add`) is used silently, with no prompt.
- **spork never sees the passphrase.** `ssh-add` asks for it, attached to
  the user's terminal, exactly as if they'd run it by hand. spork must
  never point `SSH_ASKPASS` at itself or otherwise read a passphrase:
  that keeps every secret out of spork's process, its logs, and its error
  messages.
- **All asking happens before the dashboard starts**, one key at a time,
  then the batch runs with prompts off exactly as before. The "never
  prompt during a batch" rule in `packages/core/CLAUDE.md` still holds.

## Design

### 1. Check every repo first

Before anything is created, spork runs `git ls-remote <source>
refs/heads/<workspace branch>` for each repo, with prompts off, against
the user's own agent. This replaces the separate pushed-branch check from
0001: one call per repo answers both "can we reach it?" and "is the
workspace branch already pushed?". Each repo comes out `ok`,
`auth-failed` (stderr matched `isAuthFailure`), or `unreachable`
(anything else, left for the real clone/fetch to report).

### 2. Work out which key is missing

Only for `auth-failed` repos with an SSH source (`user@host:path` or
`ssh://`; HTTPS and local paths are skipped):

- `ssh -G [-p port] [-l user] <host>` prints the settings ssh will
  really use for that host after `~/.ssh/config`, including host aliases
  like `github-work`. Its `identityfile` lines are the key files ssh
  would try, in order.
- Keep only key files that exist and have a passphrase
  (`ssh-keygen -y -P '' -f <key>` fails on an encrypted key).
- Drop keys already in the user's agent (their `.pub` matches a line of
  `ssh-add -L`). If one of those didn't work, its passphrase isn't the
  problem.
- If `ssh -G` names an `identityagent` other than `SSH_AUTH_SOCK` (1Password,
  Secretive), there's no key file to unlock: skip the host.

### 3. A temporary agent for this command only

spork starts its own `ssh-agent -D -a <socket>` as a child process, in a
fresh temp directory only the user can open, with a default key lifetime
(`-t`) of one hour. Then, for the first missing key:

1. Print which repos need which key, and that it's held only until the
   command finishes.
2. Run `ssh-add -q <key>` against the temporary agent with the terminal
   attached, so `ssh-add` asks for the passphrase. Pressing Enter with no
   passphrase skips the key (`ssh-add` exits non-zero after one empty
   answer).
3. Re-check every still-failing repo against the temporary agent. Those
   that now pass will use it.

Repeat with the next missing key until every repo passes or no candidate
keys are left. One passphrase covers every repo that key unlocks, so four
repos behind `id_rsa_work` ask once.

Each repo then uses exactly one agent: the user's own if it passed in
step 1, the temporary one if it passed in step 3. ssh-agents can't chain,
so this per-repo choice is what lets keys from both coexist in one
command. `addRepo` gains an `sshAuthSock` option that `execGit` sets as
`SSH_AUTH_SOCK` for every git process that repo runs: clone, fetch,
fast-forward, and submodule update.

### 4. Cleanup

When the command finishes, spork stops the agent (SIGTERM; `ssh-agent`
removes its own socket) and removes the temp directory, on success and on
failure alike. Ctrl+C reaches the agent directly, since it's in the same
process group and `ssh-agent -D` cleans up on SIGINT. If spork is killed
outright (`kill -9`), the orphaned agent drops the key once the one-hour
lifetime runs out.

While the command runs, any program running as the same user could ask
the temporary agent to sign with the key (never read it). That's the
same exposure the user's own agent always has, limited to one command.

## Where it applies

- `workspace create --repo ...`, `create`'s interactive picker, and
  `workspace add-repo` (single source or picked from the registry).
- Only when stdin and stdout are both a TTY. Otherwise (CI, scripts, the
  MCP server) nothing is asked, and an auth failure gives today's error
  and guidance.
- Not on Windows: its OpenSSH agent is a system service, and
  `ssh-agent -D -a` doesn't work there. Windows users get today's error.

## Not done here

- **HTTPS remotes** still rely on a git credential helper. A follow-up
  will cover them.
- **`core.sshCommand`/`GIT_SSH_COMMAND` with `-i`**: step 2 reads only
  `ssh -G`, so a key named only on a custom ssh command line isn't found.
  The repo fails with the usual guidance.
- **`repo scan`, and the MCP server.** `repo scan` copies from local
  checkouts, and the MCP server has no terminal to ask on.
