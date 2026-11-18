# 0006 — Open a workspace in the terminal

Status: Implemented

## Goal

`workspace create`'s "open it now?" offer and `workspace open` gain a
third target next to VS Code and Claude: **Terminal**, which puts you in
the workspace's folder.

## The constraint

A program can't change the folder of the shell that started it. `spork`
runs as a child process, so whatever it does with its own working
directory is gone when it exits. A real `cd` has to happen in the shell
itself, which means a shell function.

## Design

Terminal does one of two things.

1. **With shell integration** (a `spork` shell function, see below), it
   writes the workspace folder to a file the function created and named
   in `SPORK_CD_FILE`. After `spork` exits, the function `cd`s there. The
   result is a real `cd` in your current shell.
2. **Without it**, it starts a new copy of `$SHELL` in the folder,
   through the same foreground `CommandExecutor` that `exec` and the
   Claude target already use. `exit` brings you back to where you were.
   This was checked against a real pty for zsh and bash: Ctrl+C at the
   nested prompt doesn't close the nested shell, even though spork passes
   signals on to its child. The shell takes over the terminal's
   foreground process group, so spork never sees the keypress.

### Shell integration

`spork shell-init <zsh|bash|fish>` prints the function. It makes a temp
file with `mktemp`, runs `command spork "$@"` with `SPORK_CD_FILE`
pointing at it, `cd`s to what spork wrote (if anything), and removes the
file. It keeps spork's exit status. Every other subcommand behaves
exactly as before, because only the Terminal target writes the file.

It's installed by one line in the shell's startup file:

```sh
command -v spork >/dev/null 2>&1 && eval "$(spork shell-init zsh 2>/dev/null)"
```

The guard and `2>/dev/null` keep a new shell quiet when `spork` is
missing or older than this command.

### The one-time offer

Homebrew can't edit a user's dotfiles, and for zsh and bash nothing it
installs is picked up when the shell starts. So the first time Terminal
has to fall back to a new shell, spork asks once whether to add that line
to the startup file (`$ZDOTDIR/.zshrc` or `~/.zshrc`, `~/.bashrc`, or
`$XDG_CONFIG_HOME/fish/config.fish`). It records in
`~/.spork/preferences.json` that it asked, whatever the answer, and never
asks again. It doesn't ask when:

- the line is already in the startup file (that shell simply hasn't
  reloaded it yet);
- `$SHELL` isn't zsh, bash or fish;
- there's no terminal to ask on.

### fish via Homebrew

fish loads functions from Homebrew's `share/fish/vendor_functions.d`
when they're first called, so the formula writes `spork shell-init fish`
there at install time. fish users who install with brew get the real
`cd` with no setup and never see the offer.

## Not doing

- Editing a startup file without asking.
- Detecting a nested shell inside another nested shell. Each `exit`
  steps back one level, which matches how any subshell behaves.
