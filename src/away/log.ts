import { MAX_WATCHED_PATHS } from "../session/model";

/** Carpetas que nunca se registran: generadas, de dependencias o de git. */
export const DEFAULT_EXCLUDED_DIRS = [".git", "node_modules", "dist", "build", "out", ".next", "target"];

/**
 * Rutas tocadas durante la ausencia, en orden de aparición, sin repetir.
 * Tope de 200: lo que excede solo suma a `overflow`.
 */
export class AwayLog {
  private readonly paths: string[] = [];
  private readonly seen = new Set<string>();
  private overflowCount = 0;
  private version = 0;

  constructor(private readonly excludes: RegExp[] = []) {}

  /** `relative` con "/" como separador. Devuelve si se registró algo nuevo. */
  add(relative: string): boolean {
    if (!relative || relative.startsWith("../") || this.excluded(relative) || this.seen.has(relative)) {
      return false;
    }
    this.seen.add(relative);
    if (this.paths.length < MAX_WATCHED_PATHS) {
      this.paths.push(relative);
    } else {
      this.overflowCount++;
    }
    this.version++;
    return true;
  }

  /** Cambia cada vez que se registra algo: sirve para persistir solo si hubo cambios. */
  get revision(): number {
    return this.version;
  }

  snapshot(): { watchedPaths: string[]; overflow: number } {
    return { watchedPaths: [...this.paths], overflow: this.overflowCount };
  }

  private excluded(relative: string): boolean {
    const segments = relative.split("/");
    if (segments.some((segment) => DEFAULT_EXCLUDED_DIRS.includes(segment))) {
      return true;
    }
    return this.excludes.some((pattern) => pattern.test(relative));
  }
}

/**
 * Glob mínimo para `retramo.away.exclude` y `files.watcherExclude`:
 * `**` cualquier cantidad de carpetas, `*` cualquier cosa dentro de un
 * segmento, `?` un carácter. Un patrón sin "/" aplica en cualquier nivel.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!pattern.includes("/")) {
    pattern = `**/${pattern}`;
  }
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // También excluye todo lo que está debajo de una carpeta excluida.
  return new RegExp(`^${source}(?:/.*)?$`);
}
