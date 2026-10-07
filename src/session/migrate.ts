import { AwayChanges, Baseline, clampIntent, MAX_UNTRACKED, MAX_WATCHED_PATHS, Session, SCHEMA_VERSION } from "./model";
import { isObjectId } from "../git/objectId";

/**
 * Convierte lo que haya en disco a una sesión v2 válida. Nunca reescribe el
 * archivo: la conversión ocurre solo al leer.
 *
 * - Sin `schemaVersion`: es v1. `note` pasa a `intent` y `activeSelection` se
 *   descarta.
 * - Los hashes de la línea de base se validan: uno inválido se descarta como
 *   si no existiera, para que nunca llegue a git.
 * - Devuelve `undefined` si el JSON no tiene la forma mínima de una sesión.
 */
export function migrateSession(raw: unknown): Session | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { id, createdAt, trigger, workspace, editor } = raw;
  if (typeof id !== "string" || typeof createdAt !== "string") {
    return undefined;
  }
  if (!isRecord(workspace) || typeof workspace.name !== "string" || typeof workspace.rootPath !== "string") {
    return undefined;
  }

  const session: Session = {
    schemaVersion: SCHEMA_VERSION,
    id,
    createdAt,
    trigger: trigger === "idle" ? "idle" : "manual",
    workspace: { name: workspace.name, rootPath: workspace.rootPath },
    editor: migrateEditor(editor),
  };

  const intent = clampIntent(typeof raw.intent === "string" ? raw.intent : typeof raw.note === "string" ? raw.note : undefined);
  if (intent) {
    session.intent = intent;
  }
  if (isRecord(raw.git) && typeof raw.git.branch === "string") {
    session.git = {
      branch: raw.git.branch,
      modifiedFiles: strings(raw.git.modifiedFiles),
    };
    if (typeof raw.git.lastCommitMessage === "string") {
      session.git.lastCommitMessage = raw.git.lastCommitMessage;
    }
  }
  if (isRecord(raw.terminal)) {
    session.terminal = { recentCommands: strings(raw.terminal.recentCommands) };
    if (typeof raw.terminal.cwd === "string") {
      session.terminal.cwd = raw.terminal.cwd;
    }
  }
  const baseline = migrateBaseline(raw.baseline);
  if (baseline) {
    session.baseline = baseline;
  }
  if (isRecord(raw.away) && typeof raw.away.startedAt === "string") {
    session.away = {
      startedAt: raw.away.startedAt,
      watchedPaths: strings(raw.away.watchedPaths).slice(0, MAX_WATCHED_PATHS),
      overflow: typeof raw.away.overflow === "number" && raw.away.overflow > 0 ? Math.floor(raw.away.overflow) : 0,
    };
    if (typeof raw.away.endedAt === "string") {
      session.away.endedAt = raw.away.endedAt;
    }
    const changes = migrateChanges(raw.away.changes);
    if (changes) {
      session.away.changes = changes;
    }
  }
  if (isRecord(raw.summary) && typeof raw.summary.text === "string" && typeof raw.summary.provider === "string") {
    session.summary = {
      text: raw.summary.text,
      provider: raw.summary.provider,
      includedDiffs: raw.summary.includedDiffs === true,
      generatedAt: typeof raw.summary.generatedAt === "string" ? raw.summary.generatedAt : createdAt,
    };
  }
  return session;
}

function migrateEditor(editor: unknown): Session["editor"] {
  if (!isRecord(editor)) {
    return { openFiles: [] };
  }
  const result: Session["editor"] = { openFiles: strings(editor.openFiles) };
  if (typeof editor.activeFile === "string") {
    result.activeFile = editor.activeFile;
  }
  if (typeof editor.activeLine === "number" && Number.isInteger(editor.activeLine) && editor.activeLine > 0) {
    result.activeLine = editor.activeLine;
  }
  // `activeSelection` de la v1 se descarta a propósito.
  return result;
}

function migrateBaseline(value: unknown): Baseline | undefined {
  if (!isRecord(value) || typeof value.repoRoot !== "string" || typeof value.capturedAt !== "string") {
    return undefined;
  }
  const baseline: Baseline = {
    repoRoot: value.repoRoot,
    head: isObjectId(value.head) ? value.head : "",
    branch: typeof value.branch === "string" ? value.branch : "",
    untracked: {},
    capturedAt: value.capturedAt,
  };
  if (isObjectId(value.snapshot)) {
    baseline.snapshot = value.snapshot;
  }
  if (isRecord(value.untracked)) {
    for (const [file, hash] of Object.entries(value.untracked).slice(0, MAX_UNTRACKED)) {
      if (typeof hash === "string") {
        baseline.untracked[file] = hash;
      }
    }
  }
  if (typeof value.error === "string") {
    baseline.error = value.error;
  }
  return baseline;
}

const STATUSES = new Set(["modified", "added", "deleted", "renamed"]);
const SOURCES = new Set(["git", "untracked", "watcher"]);
const MAX_STORED_FILES = 200;
const MAX_STORED_COMMITS = 20;

function migrateChanges(value: unknown): AwayChanges | undefined {
  if (!isRecord(value) || typeof value.minutesAway !== "number" || !Array.isArray(value.files) || !Array.isArray(value.newCommits)) {
    return undefined;
  }
  const changes: AwayChanges = {
    minutesAway: Math.max(0, Math.floor(value.minutesAway)),
    newCommits: value.newCommits
      .filter(isRecord)
      .filter((c) => isObjectId(c.hash) && typeof c.subject === "string" && typeof c.author === "string")
      .slice(0, MAX_STORED_COMMITS)
      .map((c) => ({ hash: c.hash as string, subject: c.subject as string, author: c.author as string })),
    files: value.files
      .filter(isRecord)
      .filter((f) => typeof f.path === "string" && STATUSES.has(f.status as string) && SOURCES.has(f.source as string))
      .slice(0, MAX_STORED_FILES)
      .map((f) => ({ path: f.path as string, status: f.status as AwayChanges["files"][number]["status"], source: f.source as AwayChanges["files"][number]["source"] })),
    overflow: typeof value.overflow === "number" && value.overflow > 0 ? Math.floor(value.overflow) : 0,
  };
  if (isRecord(value.branchChanged) && typeof value.branchChanged.from === "string" && typeof value.branchChanged.to === "string") {
    changes.branchChanged = { from: value.branchChanged.from, to: value.branchChanged.to };
  }
  if (value.baselineLost === true) {
    changes.baselineLost = true;
  }
  if (value.historyRewritten === true) {
    changes.historyRewritten = true;
  }
  return changes;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
