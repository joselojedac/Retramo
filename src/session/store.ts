import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  HISTORY_LIMIT,
  Session,
  SessionIndex,
  SessionIndexEntry,
  toIndexEntry,
} from "./model";
import { isUlid } from "./ulid";
import { Logger, silentLogger } from "../log";

/**
 * Almacenamiento local de sesiones: un JSON por sesión más un índice.
 *
 * Layout:
 *   <dir>/index.json
 *   <dir>/sessions/<id>.json
 *
 * Toda escritura es atómica (archivo temporal + rename) para que un fallo a
 * mitad de camino nunca deje un JSON corrupto. Si el índice se pierde o se
 * corrompe, se reconstruye a partir de los archivos de sesión.
 */
export class SessionStore {
  readonly sessionsDir: string;
  readonly indexPath: string;

  constructor(
    readonly dir: string,
    private readonly log: Logger = silentLogger,
  ) {
    this.sessionsDir = path.join(dir, "sessions");
    this.indexPath = path.join(dir, "index.json");
  }

  sessionPath(id: string): string {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  async save(session: Session): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    // 1. La sesión primero. Si esto falla, el índice queda intacto.
    await writeAtomic(this.sessionPath(session.id), JSON.stringify(session, null, 2));
    // 2. El índice después. Si esto falla, la sesión ya está en disco y el
    //    índice se reconstruye en la próxima lectura.
    const index = await this.readIndex();
    const others = index.sessions.filter((entry) => entry.id !== session.id);
    const sessions = [toIndexEntry(session), ...others].sort(byCreatedAtDesc);
    await this.writeIndex({ version: 1, sessions });
  }

  async get(id: string): Promise<Session | undefined> {
    if (!isUlid(id)) {
      return undefined;
    }
    try {
      const raw = await fs.readFile(this.sessionPath(id), "utf8");
      return JSON.parse(raw) as Session;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      this.log.error(`store: no se pudo leer la sesión ${id}`, error);
      return undefined;
    }
  }

  /** Últimas `limit` sesiones, más reciente primero. */
  async list(limit: number = HISTORY_LIMIT, workspaceRootPath?: string): Promise<SessionIndexEntry[]> {
    const index = await this.readIndex();
    const filtered =
      workspaceRootPath === undefined
        ? index.sessions
        : index.sessions.filter((entry) => entry.workspaceRootPath === workspaceRootPath);
    return filtered.slice(0, limit);
  }

  async latest(workspaceRootPath?: string): Promise<Session | undefined> {
    const [entry] = await this.list(1, workspaceRootPath);
    return entry ? this.get(entry.id) : undefined;
  }

  /** Lee el índice; si falta o está roto, lo reconstruye desde los archivos. */
  async readIndex(): Promise<SessionIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionIndex>;
      if (parsed.version === 1 && Array.isArray(parsed.sessions)) {
        return { version: 1, sessions: parsed.sessions };
      }
      this.log.warn("store: índice con formato desconocido, reconstruyendo");
    } catch (error) {
      if (!isNotFound(error)) {
        this.log.warn(`store: índice ilegible, reconstruyendo (${String(error)})`);
      }
    }
    return this.rebuildIndex();
  }

  async rebuildIndex(): Promise<SessionIndex> {
    const sessions: SessionIndexEntry[] = [];
    let files: string[] = [];
    try {
      files = await fs.readdir(this.sessionsDir);
    } catch (error) {
      if (!isNotFound(error)) {
        this.log.error("store: no se pudo listar la carpeta de sesiones", error);
      }
    }
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const session = await this.get(file.slice(0, -".json".length));
      if (session) {
        sessions.push(toIndexEntry(session));
      }
    }
    sessions.sort(byCreatedAtDesc);
    const index: SessionIndex = { version: 1, sessions };
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await this.writeIndex(index);
    } catch (error) {
      this.log.error("store: no se pudo escribir el índice reconstruido", error);
    }
    return index;
  }

  private async writeIndex(index: SessionIndex): Promise<void> {
    await writeAtomic(this.indexPath, JSON.stringify(index, null, 2));
  }
}

function byCreatedAtDesc(a: SessionIndexEntry, b: SessionIndexEntry): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
