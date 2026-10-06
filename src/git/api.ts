import * as vscode from "vscode";
import * as path from "node:path";

// Tipado mínimo de la API de la extensión Git integrada
// (https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).
interface GitExtensionExports {
  enabled: boolean;
  getAPI(version: 1): GitApi;
}

export interface GitApi {
  git: { path: string };
  repositories: GitRepository[];
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
  };
  getCommit(ref: string): Promise<{ message: string }>;
}

export interface GitChange {
  uri: vscode.Uri;
}

/** La API de la extensión de git, o `undefined` si no está o está desactivada. */
export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports?.enabled ? exports.getAPI(1) : undefined;
}

/**
 * El repositorio de referencia: el que contiene el archivo activo; si no hay,
 * el que contiene al workspace (el más específico) o, si no, el primero que
 * está dentro del workspace.
 */
export function pickRepository(
  repositories: GitRepository[],
  workspaceRoot: string,
  activeFile?: string,
): GitRepository | undefined {
  const contains = (repo: GitRepository, target: string) => isInside(target, repo.rootUri.fsPath);
  const deepestFirst = [...repositories].sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length);
  if (activeFile) {
    const forFile = deepestFirst.find((repo) => contains(repo, activeFile) && isInside(repo.rootUri.fsPath, workspaceRoot, true));
    if (forFile) {
      return forFile;
    }
  }
  return (
    deepestFirst.find((repo) => contains(repo, workspaceRoot)) ??
    repositories.find((repo) => isInside(repo.rootUri.fsPath, workspaceRoot))
  );
}

/** `target` es `root` o está dentro. Con `either`, también vale al revés. */
function isInside(target: string, root: string, either = false): boolean {
  const relative = path.relative(root, target);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return inside || (either && isInside(root, target));
}
