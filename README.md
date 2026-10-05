# Retramo

Saves your working state when you step away and shows it to you when you come back.

It's made for people with ADHD (or too many meetings) who lose the thread with every interruption. Two actions, no setup to get started, and everything stays on your machine.

![Retramo: "I'm leaving" saves where you were; "I'm back" takes you right back to that line](media/demo.gif)

## Two actions

| Action | Command | Shortcut |
|---|---|---|
| **I'm leaving** | `Retramo: I'm leaving` | `Ctrl+Alt+L` (`Cmd+Alt+L` on Mac) |
| **I'm back** | `Retramo: I'm back` | `Ctrl+Alt+R` (`Cmd+Alt+R` on Mac) |

**I'm leaving** captures where you were, lets you write a one-line note (optional; press Enter with no text to skip), and saves the session.

**I'm back** opens a panel next to the editor with what you left behind, in this order:

1. Your note, in large type.
2. An AI summary, if you set one up.
3. The active file and line, as a link.
4. Uncommitted modified files.
5. The git branch.
6. Recent terminal commands.
7. Open files (collapsed).

On top of that, if you go 20 minutes without touching anything, Retramo saves a session on its own. No alerts, no popups.

Secondary commands:

- `Retramo: History` — pick from your last 20 sessions.
- `Retramo: Open data folder` — opens the folder with the JSON files, so you can see exactly what was saved.
- `Retramo: Set API key for summaries` — only if you want summaries from OpenAI or Anthropic.

The interface follows VS Code's display language: English by default, Spanish if your VS Code is in Spanish.

## What gets saved

Each session is a readable JSON file, one per session, in VS Code's global storage folder. It looks like this:

```json
{
  "id": "01J9X4M3V9K2Q4R8T7W1Z5B6C7",
  "createdAt": "2025-09-17T14:03:00.000Z",
  "trigger": "manual",
  "note": "login test fails because the token expired",
  "workspace": { "name": "my-app", "rootPath": "/home/me/my-app" },
  "editor": {
    "activeFile": "src/auth/login.ts",
    "activeLine": 42,
    "openFiles": ["src/auth/login.ts", "test/login.test.ts"]
  },
  "git": {
    "branch": "fix/login-token",
    "modifiedFiles": ["src/auth/login.ts"],
    "lastCommitMessage": "wip: refresh token"
  },
  "terminal": {
    "recentCommands": ["npm test -- login"],
    "cwd": "/home/me/my-app"
  }
}
```

**File contents and diffs are never saved.** Only names, paths relative to the workspace, and positions. The one exception is the active editor's selection, trimmed to 200 characters, and only if you turn on `retramo.captureSelection` (it's off by default).

Terminal commands are recorded as you run them (VS Code 1.93 or later), without their output. Git is read through VS Code's built-in Git extension, never by running `git` in a shell.

## Local by default

Nothing leaves your machine unless you explicitly turn it on. No telemetry, no content, no keys. There are exactly two things that can leave, and both are opt-in:

### 1. AI summary (optional)

If you set `retramo.summary.provider` to `openai`, `anthropic` or `ollama`, opening **I'm back** generates a two-or-three-sentence summary. The panel shows the raw state first and the summary arrives afterwards, without blocking anything.

**What gets sent to the provider is the session JSON** (the same one shown above, without the `summary` field) inside the prompt in [`prompts/summary.txt`](prompts/summary.txt). Since the session model holds no file contents, no code is sent.

- `openai` and `anthropic` use your own key. It's stored in VS Code's secret storage (`context.secrets`), never in `settings.json`. Set it with `Retramo: Set API key for summaries`.
- `ollama` uses the endpoint in `retramo.summary.ollamaEndpoint` (default `http://localhost:11434`) and the first model you have installed. Nothing leaves your network.

With no key configured and no local endpoint, the option doesn't exist: nothing is shown.

### 2. Telemetry (optional, off by default)

The first time it starts, Retramo asks once: *"Can we count how many times a week you use “I'm back”? Just the number, nothing else."* Closing the prompt counts as No.

If you say yes, once a week **exactly this** is sent, and nothing else:

```json
{ "installId": "<random uuid>", "returnCount": 12, "version": "0.1.0" }
```

You can change it at any time with `retramo.telemetry`. VS Code's `telemetry.telemetryLevel` is respected too: if it's set to `off`, nothing is sent even if you said yes.

It's sent via `POST` to `https://retramo-telemetry.netlify.app/ping`. The server stores only those three fields, grouped by week; it doesn't store your IP or anything else. Its code is in [`server/telemetry/`](server/telemetry/).

## Settings

This is all there is:

```json
{
  "retramo.idleMinutes": 20,
  "retramo.captureSelection": false,
  "retramo.summary.provider": "none",
  "retramo.summary.ollamaEndpoint": "http://localhost:11434",
  "retramo.telemetry": false
}
```

`retramo.idleMinutes` has a minimum of 5.

## Errors

If something can't be captured (no git, the terminal is closed), Retramo saves what it could and logs the failure to the **Retramo** output channel (`View > Output`). It doesn't show errors for things that don't block you.

## Development

```bash
npm install
npm run compile      # TypeScript → out/
npm run lint
npm run test:unit    # vitest, no VS Code needed
npm test             # @vscode/test-electron, downloads VS Code
npm run package      # builds the .vsix
```

`F5` in VS Code opens a development host with the extension loaded.

Translations live in `package.nls.*.json` (commands and settings) and `l10n/bundle.l10n.*.json` (everything else).

## Roadmap

- **v0** (this): VS Code extension, local, two actions.
- **Phase 2**: polish for the panel and the summary.
- **Phase 3**: a Go CLI that shares the session format, plus optional sync between machines.
