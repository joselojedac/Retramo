import * as vscode from "vscode";
import * as path from "node:path";
import { Session } from "../session/model";

/**
 * Captura archivos abiertos (en orden de pestañas), archivo activo y línea.
 * Nunca lee el contenido de un documento.
 */
export async function captureEditor(workspaceRoot: string): Promise<Session["editor"]> {
  const openFiles: string[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = tabUri(tab);
      const relative = uri ? toWorkspaceRelative(uri, workspaceRoot) : undefined;
      if (relative && !openFiles.includes(relative)) {
        openFiles.push(relative);
      }
    }
  }

  const result: Session["editor"] = { openFiles };

  const active = vscode.window.activeTextEditor;
  if (active) {
    const relative = toWorkspaceRelative(active.document.uri, workspaceRoot);
    if (relative) {
      result.activeFile = relative;
      result.activeLine = active.selection.active.line + 1;
    }
  }

  return result;
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  if (input instanceof vscode.TabInputNotebook) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

/**
 * Ruta relativa al workspace con separadores "/" para que el JSON sea portable.
 * Excluye archivos virtuales (untitled:, git:, etc.) y los que están fuera
 * del workspace.
 */
export function toWorkspaceRelative(uri: vscode.Uri, workspaceRoot: string): string | undefined {
  if (uri.scheme !== "file") {
    return undefined;
  }
  const relative = path.relative(workspaceRoot, uri.fsPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}
