# Changelog

## 0.2.0

Retramo now tells you what changed while you were away, whoever changed it: an AI agent, a teammate or a `git pull`.

- **While you were away.** "I'm leaving" snapshots your repository (`HEAD`, branch, `git stash create`, hashes of untracked files). "I'm back" lists new commits with their authors and every changed file; clicking a file opens a diff of only what changed since you left.
- **Return detection.** When you come back, a status-bar item says what changed (`4 changes while you were away`) and opens the panel on click. The panel never opens by itself.
- **Only you count as you.** Agent edits, formatters and changes from disk no longer reset the inactivity timer. Typing, clicking, scrolling, window focus and terminal commands do.
- **The automatic capture keeps the agent's work.** Its snapshot is taken a couple of minutes after you stop, so what an agent does before the capture still shows up as a change.
- **Intent.** "I'm leaving" asks *"What were you in the middle of?"* (up to 200 characters). Sessions from 0.1 are migrated on read: the note becomes the intent.
- **AI summary, two levels.** By default it gets names, statuses and commit subjects, no code. `retramo.summary.includeDiffs` adds the diff (up to 20,000 characters, never `.env`, keys or credentials) after a one-time confirmation. Anthropic requests retry declined requests on a recommended fallback model.
- **New setting:** `retramo.away.exclude`. **Removed:** `retramo.captureSelection` (sessions no longer store editor text).
- **Security:** trusted workspaces only; git runs without a shell, with `core.fsmonitor` off, without external diff tools or filters, and without taking the index lock. Settings that decide where data goes only work in user settings.
- English and Spanish interface, following VS Code's display language.
- Publisher is now `zoomieslabs`. License: MIT.

## 0.1.0

First release.

- `Retramo: I'm leaving` (`Ctrl+Alt+L`): captures open files, active file and line, git branch and modified files, recent terminal commands; asks for an optional note; saves the session as local JSON.
- `Retramo: I'm back` (`Ctrl+Alt+R`): panel next to the editor with the latest session.
- `Retramo: History`: last 20 sessions.
- `Retramo: Open data folder`.
- Automatic session after 20 minutes of inactivity (`retramo.idleMinutes`, minimum 5).
- Optional AI summary: OpenAI or Anthropic with your own key (stored in VS Code's secret storage), or local Ollama. Off by default.
- Opt-in telemetry: only the weekly count of "I'm back" uses. Off by default.
