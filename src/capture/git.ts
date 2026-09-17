import * as vscode from "vscode";
import { Session } from "../session/model";
import { toWorkspaceRelative } from "./editor";

// Tipado mínimo de la API de la extensión Git integrada
// (https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts).
// Sólo lo que usamos; nunca ejecutamos `git` por shell.
interface GitExtensionExports {
  enabled: boolean;
  getAPI(version: 1): GitApi;
}
interface GitApi {
  repositories: GitRepository[];
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
  };
  getCommit(ref: string): Promise<{ message: string }>;
}
interface GitChange {
  uri: vscode.Uri;
}

/**
 * Rama actual, archivos modificados (sólo nombres) y último mensaje de commit.
 * Devuelve `undefined` si no hay extensión Git o no hay repositorio.
 */
export async function captureGit(workspaceRoot: string): Promise<Session["git"]> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (!exports?.enabled) {
    return undefined;
  }
  const api = exports.getAPI(1);
  const repository = pickRepository(api.repositories, workspaceRoot);
  if (!repository) {
    return undefined;
  }

  const head = repository.state.HEAD;
  const branch = head?.name ?? (head?.commit ? head.commit.slice(0, 8) : "(sin rama)");

  const modified = new Set<string>();
  for (const change of [
    ...repository.state.indexChanges,
    ...repository.state.workingTreeChanges,
    ...repository.state.mergeChanges,
  ]) {
    const relative = toWorkspaceRelative(change.uri, workspaceRoot);
    if (relative) {
      modified.add(relative);
    }
  }

  const result: NonNullable<Session["git"]> = {
    branch,
    modifiedFiles: [...modified].sort(),
  };

  if (head?.commit) {
    try {
      const commit = await repository.getCommit(head.commit);
      const firstLine = commit.message.split(/\r?\n/, 1)[0]?.trim();
      if (firstLine) {
        result.lastCommitMessage = firstLine;
      }
    } catch {
      // No bloquea: sin mensaje de commit la sesión sigue siendo útil.
    }
  }

  return result;
}

function pickRepository(repositories: GitRepository[], workspaceRoot: string): GitRepository | undefined {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  // Preferir el repo cuya raíz coincide o contiene al workspace; si hay varios,
  // el de raíz más larga (más específico).
  const candidates = repositories.filter((repo) => {
    const repoRoot = repo.rootUri.fsPath.replace(/[\\/]+$/, "");
    return root === repoRoot || root.startsWith(repoRoot + "/") || root.startsWith(repoRoot + "\\");
  });
  candidates.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length);
  return candidates[0] ?? repositories.find((repo) => repo.rootUri.fsPath.startsWith(root));
}
