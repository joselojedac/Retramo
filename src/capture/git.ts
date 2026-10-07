import * as vscode from "vscode";
import { Session } from "../session/model";
import { toWorkspaceRelative } from "./editor";
import { getGitApi, pickRepository } from "../git/api";

/**
 * Rama actual, archivos modificados (sólo nombres) y último mensaje de commit.
 * Devuelve `undefined` si no hay extensión Git o no hay repositorio.
 */
export async function captureGit(workspaceRoot: string): Promise<Session["git"]> {
  const api = await getGitApi();
  if (!api) {
    return undefined;
  }
  const repository = pickRepository(api.repositories, workspaceRoot, vscode.window.activeTextEditor?.document.uri.fsPath);
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
