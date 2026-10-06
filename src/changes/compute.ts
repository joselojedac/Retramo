import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Session } from "../session/model";
import { GitRunner, splitNul } from "../git/exec";
import { isObjectId } from "../git/objectId";
import { hashUntracked, LARGE, LINK } from "../baseline/snapshot";

export const MAX_NEW_COMMITS = 20;
export const MAX_CHANGED_FILES = 200;

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

export interface ComputeInput {
  session: Session;
  /** Runner de git en la raíz del repo; sin él, solo cuenta el watcher. */
  git?: GitRunner;
  repoRoot?: string; // absoluta
  now?: Date;
}

/**
 * Qué cambió en el proyecto mientras el usuario no estaba. Solo lee: nunca
 * modifica el repo. Todo hash que se le pasa a git viene validado de la
 * sesión (session/migrate.ts) y va seguido de "--".
 */
export async function computeAwayChanges(input: ComputeInput): Promise<AwayChanges> {
  const { session } = input;
  const now = input.now ?? new Date();
  const result: AwayChanges = { minutesAway: minutesAway(session, now), newCommits: [], files: [], overflow: 0 };
  const files = new FileCollector();
  const baseline = session.baseline;
  const git = input.git;

  if (baseline && git && input.repoRoot) {
    const repoRoot = input.repoRoot;
    const currentBranch = await tryGit(git, ["symbolic-ref", "-q", "--short", "HEAD"]);
    const currentHead = await tryGit(git, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);

    if ((currentBranch ?? "") !== baseline.branch) {
      // Cambio de rama: un diff entre ramas sería ruido. Solo los commits nuevos.
      result.branchChanged = { from: baseline.branch, to: currentBranch ?? "" };
      if (isObjectId(baseline.head) && currentHead) {
        result.newCommits = await newCommits(git, baseline.head);
      }
      result.overflow = 0;
      return result;
    }

    if (isObjectId(baseline.head)) {
      if (currentHead && currentHead !== baseline.head) {
        const ancestor = await isAncestor(git, baseline.head);
        if (ancestor) {
          result.newCommits = await newCommits(git, baseline.head);
        } else {
          result.historyRewritten = true;
        }
      }

      let ref = baseline.head;
      if (baseline.snapshot) {
        if (await objectExists(git, baseline.snapshot)) {
          ref = baseline.snapshot;
        } else {
          result.baselineLost = true;
        }
      }
      for (const change of await diffNameStatus(git, ref)) {
        // Un no trackeado que se agregó al índice sin cambios no es un cambio.
        if (change.status === "added" && change.path in baseline.untracked) {
          const hash = await hashFile(path.join(repoRoot, change.path));
          if (hash !== undefined && hash === baseline.untracked[change.path]) {
            continue;
          }
        }
        files.add(change.path, change.status, "git");
      }
    } else if (currentHead) {
      // El repo no tenía commits al irse y ahora sí.
      result.newCommits = await newCommits(git, undefined);
    }

    let current: Record<string, string> = {};
    try {
      current = await hashUntracked(git, repoRoot);
    } catch {
      // Sin listado de no trackeados: se informa lo demás.
    }
    for (const [file, hash] of Object.entries(current)) {
      const before = baseline.untracked[file];
      if (before === undefined) {
        files.add(file, "added", "untracked");
      } else if (before !== hash && !unreadable(before) && !unreadable(hash)) {
        files.add(file, "modified", "untracked");
      }
    }
    for (const file of Object.keys(baseline.untracked)) {
      if (!(file in current) && !(await exists(path.join(repoRoot, file)))) {
        files.add(file, "deleted", "untracked");
      }
    }
  }

  const root = input.repoRoot ?? session.workspace.rootPath;
  for (const file of session.away?.watchedPaths ?? []) {
    if (!files.has(file)) {
      files.add(file, (await exists(path.join(root, file))) ? "modified" : "deleted", "watcher");
    }
  }

  const all = files.list();
  result.files = all.slice(0, MAX_CHANGED_FILES);
  result.overflow = all.length - result.files.length + (session.away?.overflow ?? 0);
  return result;
}

export function minutesAway(session: Session, now: Date): number {
  const start = Date.parse(session.away?.startedAt ?? session.baseline?.capturedAt ?? session.createdAt);
  const end = session.away?.endedAt ? Date.parse(session.away.endedAt) : now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 60_000));
}

class FileCollector {
  private readonly byPath = new Map<string, AwayChanges["files"][number]>();

  has(file: string): boolean {
    return this.byPath.has(file);
  }

  /** Deduplica por ruta: la primera fuente gana (git, después no trackeados, después watcher). */
  add(file: string, status: ChangeStatus, source: ChangeSource): void {
    if (!this.byPath.has(file)) {
      this.byPath.set(file, { path: file, status, source });
    }
  }

  list(): AwayChanges["files"] {
    return [...this.byPath.values()];
  }
}

async function newCommits(git: GitRunner, since: string | undefined): Promise<AwayChanges["newCommits"]> {
  const range = since ? [`${since}..HEAD`] : ["HEAD"];
  const output = await tryGit(git, ["log", "--format=%H%x1f%s%x1f%an%x1e", "-n", String(MAX_NEW_COMMITS), ...range, "--"]);
  if (!output) {
    return [];
  }
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", subject = "", author = ""] = record.split("\x1f");
      return { hash, subject, author };
    })
    .filter((commit) => isObjectId(commit.hash));
}

async function isAncestor(git: GitRunner, commit: string): Promise<boolean> {
  try {
    // merge-base no recibe rutas: sin "--". `commit` ya viene validado.
    await git(["merge-base", "--is-ancestor", commit, "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function objectExists(git: GitRunner, commit: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** `git diff --name-status` del árbol de trabajo contra `ref`. */
async function diffNameStatus(git: GitRunner, ref: string): Promise<{ path: string; status: ChangeStatus }[]> {
  // Sin trim: en la salida -z un nombre puede empezar o terminar con espacio.
  let output: string;
  try {
    output = await git(["diff", "--name-status", "-z", "-M", "--no-ext-diff", "--no-textconv", ref, "--"]);
  } catch {
    return [];
  }
  if (!output) {
    return [];
  }
  const parts = splitNul(output);
  const changes: { path: string; status: ChangeStatus }[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++] ?? "";
    if (code.startsWith("R") || code.startsWith("C")) {
      i++; // ruta anterior
      const to = parts[i++];
      if (to) {
        changes.push({ path: to, status: code.startsWith("R") ? "renamed" : "added" });
      }
      continue;
    }
    const file = parts[i++];
    if (!file) {
      continue;
    }
    changes.push({ path: file, status: code === "A" ? "added" : code === "D" ? "deleted" : "modified" });
  }
  return changes;
}

async function tryGit(git: GitRunner, args: string[]): Promise<string | undefined> {
  try {
    return (await git(args)).trim() || undefined;
  } catch {
    return undefined;
  }
}

function unreadable(hash: string): boolean {
  return hash === LARGE || hash === LINK;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await fs.readFile(file)).digest("hex");
  } catch {
    return undefined;
  }
}
