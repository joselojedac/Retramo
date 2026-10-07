export type SessionTrigger = "manual" | "idle";

export const SCHEMA_VERSION = 2;

export interface Session {
  schemaVersion: 2;
  id: string; // ulid
  createdAt: string; // ISO 8601
  trigger: SessionTrigger;
  intent?: string; // máximo 200 caracteres. Reemplaza a `note` de la v1.
  workspace: {
    name: string;
    rootPath: string;
  };
  editor: {
    activeFile?: string; // ruta relativa al workspace
    activeLine?: number;
    openFiles: string[]; // rutas relativas, orden de pestañas
  };
  git?: {
    branch: string;
    modifiedFiles: string[]; // solo nombres, nunca contenido del diff
    lastCommitMessage?: string;
  };
  terminal?: {
    recentCommands: string[]; // máximo 10, sin salida
    cwd?: string;
  };
  baseline?: Baseline;
  away?: {
    startedAt: string; // cuándo empezó la ausencia: al irse, o la última presencia si fue automática
    watchedPaths: string[]; // rutas tocadas durante la ausencia, en orden, máximo 200
    overflow: number; // rutas descartadas por el tope
    endedAt?: string; // cuándo se detectó el regreso
    /**
     * "Mientras no estabas", congelado al volver. Así, abrir la sesión desde
     * el historial muestra lo que cambió durante ESA ausencia, no contra hoy.
     * Solo nombres, estados y asuntos de commits: lo mismo que muestra el panel.
     */
    changes?: AwayChanges;
  };
  summary?: {
    text: string;
    provider: string; // "byok:openai" | "byok:anthropic" | "local:ollama"
    includedDiffs: boolean; // si se mandó código al proveedor
    generatedAt: string;
  };
}

/**
 * Estado del repositorio al irse. Nunca contiene contenido de archivos:
 * hashes de commits y SHA-256 de los no trackeados.
 */
export interface Baseline {
  repoRoot: string; // relativa al workspace con "/", "" si es la raíz
  head: string; // commit al irse; "" si el repo no tiene commits
  branch: string; // "" con HEAD desacoplado
  snapshot?: string; // commit de `git stash create`, si había cambios
  untracked: Record<string, string>; // ruta relativa al repo -> sha256 o "large"
  capturedAt: string;
  error?: string;
}

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed";
export type ChangeSource = "git" | "untracked" | "watcher";

export interface AwayChanges {
  minutesAway: number;
  branchChanged?: { from: string; to: string };
  newCommits: { hash: string; subject: string; author: string }[];
  /** Rutas relativas a la raíz del repo (o al workspace si no hay línea de base). */
  files: { path: string; status: ChangeStatus; source: ChangeSource }[];
  overflow: number;
  /** El snapshot ya no existe (git gc): se comparó contra el último commit. */
  baselineLost?: boolean;
  /** El commit de la línea de base ya no es ancestro de HEAD (rebase, reset). */
  historyRewritten?: boolean;
}

/** Entrada del índice: lo justo para listar sin abrir cada archivo. */
export interface SessionIndexEntry {
  id: string;
  createdAt: string;
  trigger: SessionTrigger;
  intent?: string;
  workspaceName: string;
  workspaceRootPath: string;
  activeFile?: string;
}

export interface SessionIndex {
  version: 2;
  sessions: SessionIndexEntry[]; // más reciente primero
}

export const MAX_INTENT_CHARS = 200;
export const MAX_TERMINAL_COMMANDS = 10;
export const HISTORY_LIMIT = 20;
export const MAX_UNTRACKED = 200;
export const MAX_WATCHED_PATHS = 200;

/** Recorta la intención al máximo y descarta la vacía. */
export function clampIntent(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > MAX_INTENT_CHARS ? trimmed.slice(0, MAX_INTENT_CHARS) : trimmed;
}

export function toIndexEntry(session: Session): SessionIndexEntry {
  const entry: SessionIndexEntry = {
    id: session.id,
    createdAt: session.createdAt,
    trigger: session.trigger,
    workspaceName: session.workspace.name,
    workspaceRootPath: session.workspace.rootPath,
  };
  if (session.intent) {
    entry.intent = session.intent;
  }
  if (session.editor.activeFile) {
    entry.activeFile = session.editor.activeFile;
  }
  return entry;
}
