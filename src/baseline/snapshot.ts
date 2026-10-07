import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Baseline, MAX_UNTRACKED } from "../session/model";
import { GitRunner, splitNul } from "../git/exec";
import { isObjectId } from "../git/objectId";

export const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024;
export const MAX_UNTRACKED_TOTAL_BYTES = 20 * 1024 * 1024;
export const STASH_TIMEOUT_MS = 5_000;

/** Valor guardado en lugar del hash cuando un archivo no se lee. */
export const LARGE = "large";
export const LINK = "link";

export interface BaselineInput {
  git: GitRunner;
  repoRoot: string; // absoluta
  workspaceRoot: string; // absoluta
}

/**
 * Estado del repositorio al irse: HEAD, rama, un snapshot de los cambios sin
 * commitear y el SHA-256 de cada archivo no trackeado.
 *
 * Nunca modifica nada visible del repo. `git stash create` arma un commit
 * con el árbol de trabajo y el índice sin tocar el árbol, el índice ni la
 * lista de stashes; solo deja objetos sin referencia en .git/objects, que
 * `git gc` borra solo. Nunca se ejecuta otra variante de `git stash`.
 *
 * El contenido de los no trackeados se lee para calcular el hash y se
 * descarta en el acto: la sesión solo guarda el hash.
 */
export async function captureBaseline(input: BaselineInput): Promise<Baseline> {
  const { git, repoRoot } = input;
  const errors: string[] = [];
  const baseline: Baseline = {
    repoRoot: toPosix(path.relative(input.workspaceRoot, repoRoot)),
    head: "",
    branch: "",
    untracked: {},
    capturedAt: new Date().toISOString(),
  };

  try {
    const head = (await git(["rev-parse", "--verify", "-q", "HEAD^{commit}"])).trim();
    if (isObjectId(head)) {
      baseline.head = head;
    }
  } catch {
    errors.push("the repository has no commits yet");
  }

  try {
    baseline.branch = (await git(["symbolic-ref", "-q", "--short", "HEAD"])).trim();
  } catch {
    // HEAD desacoplado: branch queda "".
  }

  if (baseline.head) {
    try {
      const snapshot = (await git(["stash", "create"], { timeoutMs: STASH_TIMEOUT_MS })).trim();
      if (isObjectId(snapshot)) {
        baseline.snapshot = snapshot;
      }
      // Salida vacía: no había cambios; se compara contra `head`.
    } catch (error) {
      errors.push(`git stash create failed: ${describe(error)}`);
    }
  }

  try {
    baseline.untracked = await hashUntracked(git, repoRoot);
  } catch (error) {
    errors.push(`could not list untracked files: ${describe(error)}`);
  }

  if (errors.length > 0) {
    baseline.error = errors.join("; ");
  }
  return baseline;
}

/**
 * Lista los no trackeados (respetando .gitignore) y calcula su SHA-256.
 * Más de 1 MB, o pasado el presupuesto total de 20 MB: "large". Enlaces
 * simbólicos: "link", sin seguirlos. Tope de 200 entradas.
 */
export async function hashUntracked(git: GitRunner, repoRoot: string): Promise<Record<string, string>> {
  const files = splitNul(await git(["ls-files", "--others", "--exclude-standard", "-z"]));
  const result: Record<string, string> = {};
  let budget = MAX_UNTRACKED_TOTAL_BYTES;
  for (const file of files.slice(0, MAX_UNTRACKED)) {
    const absolute = path.join(repoRoot, file);
    try {
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) {
        result[file] = LINK;
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      if (stat.size > MAX_UNTRACKED_FILE_BYTES || stat.size > budget) {
        result[file] = LARGE;
        continue;
      }
      budget -= stat.size;
      result[file] = createHash("sha256").update(await fs.readFile(absolute)).digest("hex");
    } catch {
      // Borrado entre el listado y la lectura: no se registra.
    }
  }
  return result;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
