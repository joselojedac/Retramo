import * as vscode from "vscode";
import * as path from "node:path";
import { AwayLog, globToRegExp } from "./log";

/**
 * Patrones de exclusión: `retramo.away.exclude` del proyecto más los de
 * `files.watcherExclude` activos. Las carpetas de AwayLog se excluyen siempre.
 */
export function awayExcludes(scope: vscode.Uri): RegExp[] {
  const own = vscode.workspace.getConfiguration("retramo", scope).get<unknown>("away.exclude", []);
  const watcher = vscode.workspace.getConfiguration("files", scope).get<Record<string, boolean>>("watcherExclude", {});
  const globs = [
    ...(Array.isArray(own) ? own.filter((g): g is string => typeof g === "string") : []),
    ...Object.entries(watcher ?? {})
      .filter(([, enabled]) => enabled === true)
      .map(([glob]) => glob),
  ];
  const result: RegExp[] = [];
  for (const glob of globs) {
    try {
      result.push(globToRegExp(glob));
    } catch {
      // un patrón inválido se ignora
    }
  }
  return result;
}

/**
 * Registra en `log` cada archivo creado, cambiado o borrado dentro de `root`,
 * con ruta relativa a `root`. Solo nombres: nunca lee el contenido.
 */
export function watchAway(root: string, log: AwayLog): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), "**/*"));
  const record = (uri: vscode.Uri) => {
    if (uri.scheme !== "file") {
      return;
    }
    const relative = path.relative(root, uri.fsPath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      log.add(relative.split(path.sep).join("/"));
    }
  };
  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(record),
    watcher.onDidChange(record),
    watcher.onDidDelete(record),
  );
}
