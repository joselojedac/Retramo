import * as vscode from "vscode";
import * as path from "node:path";
import { clampSelection, MAX_SELECTION_CHARS, Session } from "../session/model";

/**
 * Captura archivos abiertos (en orden de pestañas), archivo activo, línea y,
 * sólo si el usuario lo activó, la selección recortada a 200 caracteres.
 *
 * Nunca lee el contenido de un documento más allá de esa selección.
 */
export async function captureEditor(
  workspaceRoot: string,
  captureSelection: boolean,
): Promise<Session["editor"]> {
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
      if (captureSelection && !active.selection.isEmpty) {
        // Acotamos el rango ANTES de leer: nunca cargamos más de 200 caracteres.
        const start = active.selection.start;
        const cap = active.document.positionAt(
          active.document.offsetAt(start) + MAX_SELECTION_CHARS,
        );
        const end = active.selection.end.isBefore(cap) ? active.selection.end : cap;
        const selection = clampSelection(active.document.getText(new vscode.Range(start, end)));
        if (selection) {
          result.activeSelection = selection;
        }
      }
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
