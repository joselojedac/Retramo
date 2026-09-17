import { Session, SessionTrigger } from "../session/model";
import { ulid } from "../session/ulid";
import type { Logger } from "../log";

/**
 * Cada capturador es una función independiente. `captureSession` los corre
 * en paralelo con Promise.allSettled: si uno lanza, la sesión igual se guarda
 * con lo que los demás pudieron capturar, y el fallo queda en el log.
 */
export interface Capturers {
  editor: () => Promise<Session["editor"]>;
  git: () => Promise<Session["git"]>;
  terminal: () => Promise<Session["terminal"]>;
}

export interface CaptureInput {
  trigger: SessionTrigger;
  note?: string;
  workspace: Session["workspace"];
}

const EMPTY_EDITOR: Session["editor"] = { openFiles: [] };

export async function captureSession(
  input: CaptureInput,
  capturers: Capturers,
  log: Logger,
): Promise<Session> {
  const [editor, git, terminal] = await Promise.allSettled([
    run("editor", capturers.editor, log),
    run("git", capturers.git, log),
    run("terminal", capturers.terminal, log),
  ]);

  const session: Session = {
    id: ulid(),
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    workspace: input.workspace,
    editor: settled(editor) ?? EMPTY_EDITOR,
  };
  const note = input.note?.trim();
  if (note) {
    session.note = note;
  }
  const gitValue = settled(git);
  if (gitValue) {
    session.git = gitValue;
  }
  const terminalValue = settled(terminal);
  if (terminalValue) {
    session.terminal = terminalValue;
  }
  return session;
}

async function run<T>(name: string, fn: () => Promise<T>, log: Logger): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`capture: falló el capturador "${name}"`, error);
    throw error;
  }
}

function settled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}
