import { execFile } from "node:child_process";

/**
 * Única puerta de salida hacia el binario de git para lo que la API de la
 * extensión vscode.git no expone.
 *
 * - `execFile` con argumentos separados: nunca hay shell de por medio.
 * - El binario es el que usa la extensión de git (`api.git.path`), no el
 *   primero que aparezca en el PATH.
 * - `core.fsmonitor=false`: la configuración de un repo puede definir un
 *   hook de fsmonitor que ejecuta comandos; Retramo no lo dispara.
 * - `GIT_OPTIONAL_LOCKS=0`: no toma el lock del índice, para no chocar con
 *   un agente que esté usando git al mismo tiempo.
 * - Todo hash que venga de una sesión se valida antes (git/objectId.ts) y va
 *   seguido de `--`, así nunca se interpreta como opción.
 */
export type GitRunner = (args: string[], options?: GitRunOptions) => Promise<string>;

export interface GitRunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | undefined,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export function createGitRunner(gitPath: string, cwd: string): GitRunner {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        gitPath,
        ["-c", "core.fsmonitor=false", ...args],
        {
          cwd,
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        },
        (error, stdout, stderr) => {
          if (error) {
            const code = typeof error.code === "number" ? error.code : undefined;
            const reason = error.killed ? "timeout" : stderr.trim().slice(0, 300) || error.message;
            reject(new GitError(`git ${args[0] ?? ""}: ${reason}`, code, stderr));
            return;
          }
          resolve(stdout);
        },
      );
    });
}

/** Divide una salida `-z` de git en registros, sin el vacío final. */
export function splitNul(output: string): string[] {
  const parts = output.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}
