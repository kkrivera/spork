/**
 * Environment that stops git and ssh from ever waiting on a terminal
 * prompt nobody can answer — the MCP server, CI, and any live-dashboard
 * command (whose redraws erase a prompt the moment it's printed, so it
 * just looks hung). `GIT_TERMINAL_PROMPT=0` covers git's own HTTPS
 * username/password prompt. ssh reads its passphrase/host-key prompts
 * straight from `/dev/tty`, so it's routed instead to an askpass program
 * that always fails (`false`), forced even with a terminal present
 * (`SSH_ASKPASS_REQUIRE`, OpenSSH 8.4+). This leaves a user's own
 * `core.sshCommand`/`GIT_SSH_COMMAND` untouched, unlike `-o BatchMode=yes`
 * would. An ssh-agent-loaded key and git credential helpers still work —
 * they never prompt in the first place.
 */
export const NO_PROMPT_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  SSH_ASKPASS: 'false',
  SSH_ASKPASS_REQUIRE: 'force',
}

const AUTH_FAILURE_PATTERNS: readonly RegExp[] = [
  /Permission denied \(/,
  /Host key verification failed/,
  /terminal prompts disabled/,
  /could not read (Username|Password)/,
  /Authentication failed/,
  /Invalid username or (password|token)/,
]

/** Whether git's stderr reads like an authentication (rather than any other) failure. */
export function isAuthFailure(stderr: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(stderr))
}

/**
 * What to do next after an auth failure. Phrased for whichever way git was
 * run: with prompts off, the first thing to say is *why* nothing asked for
 * a passphrase; with prompts on, the user already saw one and got it wrong
 * (or the key isn't authorized at all).
 */
export function authFailureGuidance(allowPrompts: boolean): string {
  const lead = allowPrompts
    ? 'git could not authenticate with the remote.'
    : "git could not authenticate with the remote, and spork doesn't let git stop and wait for a passphrase, password, or host-key prompt here."
  return [
    lead,
    'To fix it, then retry:',
    '  - SSH key with a passphrase: load it into your ssh-agent once, e.g.',
    '      ssh-add --apple-use-keychain ~/.ssh/id_ed25519   (macOS)',
    '      ssh-add ~/.ssh/id_ed25519                        (Linux/Windows)',
    '  - First time connecting to this host: run `ssh -T git@<host>` once and accept its host key.',
    '  - HTTPS remote: set up a git credential helper (e.g. `gh auth setup-git`), or use the SSH URL instead.',
    '  - Check that the key or account actually has access to this repo.',
    ...(allowPrompts ? [] : ['Or run a single `spork repo add <source>` in a terminal, which can prompt you directly.']),
  ].join('\n')
}
