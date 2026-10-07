import { Session } from "../session/model";
import type { AwayChanges } from "../changes/compute";

export interface SummaryProvider {
  name: string; // "byok:openai" | "byok:anthropic" | "local:ollama"
  summarize(payload: SummaryPayload): Promise<string>;
}

export type SummaryProviderKind = "none" | "openai" | "anthropic" | "ollama";

/**
 * Lo único que se envía al proveedor. Se arma campo por campo a propósito:
 * lo que no está acá no sale.
 *
 * Nunca viaja: la línea de base (hashes de los no trackeados, snapshot, head,
 * errores), rutas absolutas (raíz del workspace, cwd de la terminal), ids ni
 * el resumen anterior. Sin `diffs`, no hay código: solo nombres, estados y
 * asuntos de commits. `diffs` solo existe con `retramo.summary.includeDiffs`.
 */
export interface SummaryPayload {
  intent?: string;
  workspace: string;
  trigger: Session["trigger"];
  editor: { activeFile?: string; activeLine?: number; openFiles: string[] };
  git?: { branch: string; uncommittedFiles: string[]; lastCommitMessage?: string };
  recentTerminalCommands?: string[];
  whileAway?: {
    minutes: number;
    branchChanged?: { from: string; to: string };
    historyRewritten?: boolean;
    newCommits: { subject: string; author: string }[];
    changedFiles: { path: string; status: string }[];
    moreFiles: number;
  };
  diffs?: string;
}

export function buildPayload(session: Session, changes?: AwayChanges, diffs?: string): SummaryPayload {
  const payload: SummaryPayload = {
    workspace: session.workspace.name,
    trigger: session.trigger,
    editor: {
      activeFile: session.editor.activeFile,
      activeLine: session.editor.activeLine,
      openFiles: session.editor.openFiles,
    },
  };
  if (session.intent) {
    payload.intent = session.intent;
  }
  if (session.git) {
    payload.git = {
      branch: session.git.branch,
      uncommittedFiles: session.git.modifiedFiles,
      lastCommitMessage: session.git.lastCommitMessage,
    };
  }
  if (session.terminal && session.terminal.recentCommands.length > 0) {
    payload.recentTerminalCommands = session.terminal.recentCommands;
  }
  if (changes) {
    payload.whileAway = {
      minutes: changes.minutesAway,
      branchChanged: changes.branchChanged,
      historyRewritten: changes.historyRewritten,
      newCommits: changes.newCommits.map((c) => ({ subject: c.subject, author: c.author })),
      changedFiles: changes.files.map((f) => ({ path: f.path, status: f.status })),
      moreFiles: changes.overflow,
    };
  }
  if (diffs) {
    payload.diffs = diffs;
  }
  return payload;
}

export function buildPrompt(template: string, payload: SummaryPayload): string {
  // Reemplazo con función: un "$&" en los datos no se interpreta.
  return template.replace("{payload_json}", () => JSON.stringify(payload, null, 2));
}

export function cleanSummary(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export class SummaryError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = "SummaryError";
  }
}

/** Lee el cuerpo de una respuesta HTTP fallida sin explotar. */
export async function describeHttpError(response: Response): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 300);
  } catch {
    // ignorar
  }
  return `HTTP ${response.status}${body ? ` ${body}` : ""}`;
}
