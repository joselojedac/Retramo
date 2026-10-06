import { GitRunner } from "../git/exec";
import { isObjectId } from "../git/objectId";
import type { AwayChanges } from "./compute";

export const MAX_DIFF_CHARS = 20_000;
export const TRUNCATED_MARK = "\n[diff truncated]";

/** Nombres que sugieren secretos: se informan en la lista, sin contenido. */
const SECRET_PATTERNS = [
  /(^|\/)\.env[^/]*$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$/i,
  /credential/i,
  /secret/i,
];

export function looksSecret(path: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * El diff de los archivos trackeados que cambiaron mientras el usuario no
 * estaba, contra `ref`. Solo con `retramo.summary.includeDiffs`: esto SÍ es
 * código y se manda al proveedor.
 *
 * - Sin borrados: su contenido no aporta al resumen y sería más código.
 * - Sin archivos que parecen secretos (.env, claves, credenciales).
 * - `--no-ext-diff --no-textconv`: no ejecuta diffs ni filtros del repo.
 * - `--literal-pathspecs`: un nombre como ":(top)" es una ruta, no magia.
 * - Tope de 20.000 caracteres.
 */
export async function collectDiffs(git: GitRunner, ref: string, files: AwayChanges["files"]): Promise<string> {
  if (!isObjectId(ref)) {
    return "";
  }
  const paths = files
    .filter((file) => file.source === "git" && file.status !== "deleted" && !looksSecret(file.path))
    .map((file) => file.path);
  if (paths.length === 0) {
    return "";
  }
  let diff: string;
  try {
    diff = await git(
      ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", ref, "--", ...paths],
      { maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    return "";
  }
  return diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + TRUNCATED_MARK : diff;
}
