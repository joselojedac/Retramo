import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { Session } from "../session/model";
import type { Logger } from "../log";

type WebviewMessage =
  | { type: "openFile"; path?: string; line?: number }
  | { type: "history" };

/**
 * Panel de "Volví". Un único panel reutilizable, al lado del editor.
 * Orden fijo de bloques, de más a menos útil (AGENTS.md §8).
 */
export class ReturnPanel {
  private static current: ReturnPanel | undefined;

  static async show(
    context: vscode.ExtensionContext,
    session: Session,
    log: Logger,
    summaryPending: boolean,
  ): Promise<ReturnPanel> {
    if (!ReturnPanel.current) {
      const panel = vscode.window.createWebviewPanel(
        "retramo.return",
        panelStrings().title,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true },
      );
      ReturnPanel.current = new ReturnPanel(panel, context, log);
    }
    await ReturnPanel.current.render(session, summaryPending);
    ReturnPanel.current.panel.reveal(undefined, false);
    return ReturnPanel.current;
  }

  static dispose(): void {
    ReturnPanel.current?.panel.dispose();
  }

  private sessionId: string | undefined;
  private workspaceRoot = "";

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger,
  ) {
    panel.onDidDispose(() => {
      if (ReturnPanel.current === this) {
        ReturnPanel.current = undefined;
      }
    });
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => void this.onMessage(message));
  }

  /** Actualiza el bloque de resumen sin volver a renderizar el resto. */
  updateSummary(sessionId: string, text: string | undefined, status?: "generating"): void {
    if (this.sessionId !== sessionId) {
      return; // el panel ya muestra otra sesión
    }
    void this.panel.webview.postMessage({ type: "summary", text, status });
  }

  private async render(session: Session, summaryPending: boolean): Promise<void> {
    this.sessionId = session.id;
    this.workspaceRoot = session.workspace.rootPath;
    const template = await fs.readFile(
      path.join(this.context.extensionUri.fsPath, "src", "panel", "returnPanel.html"),
      "utf8",
    );
    const nonce = randomBytes(16).toString("base64");
    const strings = panelStrings();
    this.panel.title = strings.title;
    this.panel.webview.html = template
      .replaceAll("{{cspSource}}", this.panel.webview.cspSource)
      .replaceAll("{{nonce}}", nonce)
      .replaceAll("{{lang}}", escape(vscode.env.language))
      .replaceAll("{{title}}", escape(strings.title))
      .replaceAll("{{generatingJson}}", JSON.stringify(strings.generating).replaceAll("<", "\\u003c"))
      .replace("{{body}}", renderBody(session, summaryPending, strings, vscode.env.language));
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    try {
      if (message.type === "history") {
        await vscode.commands.executeCommand("retramo.history");
        return;
      }
      if (message.type === "openFile" && message.path) {
        const relative = message.path;
        if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
          return;
        }
        const uri = vscode.Uri.file(path.join(this.workspaceRoot, relative));
        const document = await vscode.workspace.openTextDocument(uri);
        const line = Math.max(0, (message.line ?? 1) - 1);
        const position = new vscode.Position(line, 0);
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.One,
          selection: new vscode.Range(position, position),
        });
      }
    } catch (error) {
      this.log.error("panel: no se pudo abrir el archivo pedido", error);
    }
  }
}

// --- Textos -------------------------------------------------------------------

/** Textos visibles del panel. Separados del render para que `renderBody` siga siendo puro. */
export interface PanelStrings {
  title: string;
  summary: string;
  generating: string;
  youWereIn: string;
  uncommitted: string;
  branch: string;
  lastCommit: string;
  terminal: string;
  inDirectory: string;
  openFiles: string;
  manual: string;
  automatic: string;
  savedOn: (when: string, how: string) => string;
  viewHistory: string;
}

function panelStrings(): PanelStrings {
  return {
    title: vscode.l10n.t("I'm back"),
    summary: vscode.l10n.t("Summary"),
    generating: vscode.l10n.t("generating..."),
    youWereIn: vscode.l10n.t("You were in"),
    uncommitted: vscode.l10n.t("Uncommitted"),
    branch: vscode.l10n.t("Branch"),
    lastCommit: vscode.l10n.t("last commit:"),
    terminal: vscode.l10n.t("Terminal"),
    inDirectory: vscode.l10n.t("in"),
    openFiles: vscode.l10n.t("Open files"),
    manual: vscode.l10n.t("manual"),
    automatic: vscode.l10n.t("automatic"),
    savedOn: (when, how) => vscode.l10n.t("Saved on {0} ({1})", when, how),
    viewHistory: vscode.l10n.t("View history"),
  };
}

// --- Render (HTML plano, sin framework) -------------------------------------

export function renderBody(session: Session, summaryPending: boolean, t: PanelStrings, locale?: string): string {
  const parts: string[] = [];
  parts.push(`<h1>${escape(t.title)}</h1>`);

  // 1. Nota
  if (session.intent) {
    parts.push(`<p class="note">${escape(session.intent)}</p>`);
  }

  // 2. Resumen con IA
  if (session.summary) {
    parts.push(section("summary", t.summary, `<p class="summary">${escape(session.summary.text)}</p>`));
  } else if (summaryPending) {
    parts.push(section("summary", t.summary, `<p class="summary muted">${escape(t.generating)}</p>`));
  } else {
    parts.push(`<section id="summary" hidden><h2>${escape(t.summary)}</h2><p class="summary"></p></section>`);
  }

  // 3. Archivo activo y línea
  if (session.editor.activeFile) {
    const line = session.editor.activeLine;
    const label = line ? `${session.editor.activeFile}:${line}` : session.editor.activeFile;
    parts.push(section("active", t.youWereIn, `<p>${fileLink(session.editor.activeFile, line, label)}</p>`));
  }

  // 4. Archivos modificados sin commitear
  if (session.git && session.git.modifiedFiles.length > 0) {
    parts.push(section("modified", t.uncommitted, list(session.git.modifiedFiles.map((f) => fileLink(f, undefined, f)))));
  }

  // 5. Rama de git
  if (session.git) {
    let html = `<p><code>${escape(session.git.branch)}</code>`;
    if (session.git.lastCommitMessage) {
      html += ` <span class="muted">· ${escape(t.lastCommit)} ${escape(session.git.lastCommitMessage)}</span>`;
    }
    html += `</p>`;
    parts.push(section("branch", t.branch, html));
  }

  // 6. Últimos comandos de terminal
  if (session.terminal && session.terminal.recentCommands.length > 0) {
    let html = list(session.terminal.recentCommands.map((c) => `<code>${escape(c)}</code>`));
    if (session.terminal.cwd) {
      html += `<p class="muted">${escape(t.inDirectory)} <code>${escape(session.terminal.cwd)}</code></p>`;
    }
    parts.push(section("terminal", t.terminal, html));
  }

  // 7. Archivos abiertos, colapsado
  if (session.editor.openFiles.length > 0) {
    parts.push(
      `<details id="open"><summary><h2>${escape(t.openFiles)} (${session.editor.openFiles.length})</h2></summary>` +
        list(session.editor.openFiles.map((f) => fileLink(f, undefined, f))) +
        `</details>`,
    );
  }

  // 8. Pie
  const when = formatDate(session.createdAt, locale);
  const how = session.trigger === "manual" ? t.manual : t.automatic;
  parts.push(
    `<footer>${escape(t.savedOn(when, how))}` +
      `<a href="#" data-action="history">${escape(t.viewHistory)}</a></footer>`,
  );

  return parts.join("\n");
}

function section(id: string, title: string, inner: string): string {
  return `<section id="${id}"><h2>${escape(title)}</h2>${inner}</section>`;
}

function list(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function fileLink(relativePath: string, line: number | undefined, label: string): string {
  const lineAttr = line ? ` data-line="${line}"` : "";
  return `<a href="#" data-action="open" data-path="${escape(relativePath)}"${lineAttr}><code>${escape(label)}</code></a>`;
}

export function formatDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
