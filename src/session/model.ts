export type SessionTrigger = "manual" | "idle";

export interface Session {
  id: string; // ulid
  createdAt: string; // ISO 8601
  trigger: SessionTrigger;
  note?: string; // una línea, opcional
  workspace: {
    name: string;
    rootPath: string;
  };
  editor: {
    activeFile?: string; // ruta relativa al workspace
    activeLine?: number;
    activeSelection?: string; // máximo 200 caracteres, solo si el usuario lo activó
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
  summary?: {
    text: string;
    provider: string; // "byok:openai" | "byok:anthropic" | "local:ollama"
    generatedAt: string;
  };
}

/** Entrada del índice: lo justo para listar sin abrir cada archivo. */
export interface SessionIndexEntry {
  id: string;
  createdAt: string;
  trigger: SessionTrigger;
  note?: string;
  workspaceName: string;
  workspaceRootPath: string;
  activeFile?: string;
}

export interface SessionIndex {
  version: 1;
  sessions: SessionIndexEntry[]; // más reciente primero
}

export const MAX_SELECTION_CHARS = 200;
export const MAX_TERMINAL_COMMANDS = 10;
export const HISTORY_LIMIT = 20;

/** Recorta una selección al máximo permitido y descarta selecciones vacías. */
export function clampSelection(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > MAX_SELECTION_CHARS ? trimmed.slice(0, MAX_SELECTION_CHARS) : trimmed;
}

export function toIndexEntry(session: Session): SessionIndexEntry {
  const entry: SessionIndexEntry = {
    id: session.id,
    createdAt: session.createdAt,
    trigger: session.trigger,
    workspaceName: session.workspace.name,
    workspaceRootPath: session.workspace.rootPath,
  };
  if (session.note) {
    entry.note = session.note;
  }
  if (session.editor.activeFile) {
    entry.activeFile = session.editor.activeFile;
  }
  return entry;
}
