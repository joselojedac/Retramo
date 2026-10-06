import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { Session } from "../session/model";
import type { AwayChanges } from "../changes/compute";
import { isObjectId } from "../git/objectId";
import { formatDuration } from "../return/statusBar";
import type { Logger } from "../log";

type WebviewMessage =
  | { type: "openFile"; path?: unknown; line?: unknown }
  | { type: "openChange"; path?: unknown }
  | { type: "history" };

/** Lo necesario para mostrar y abrir "mientras no estabas". */
export interface PanelChanges {
  changes: AwayChanges;
  repoRoot: string; // absoluta
  /** Commit contra el que se muestran los diffs; ya validado. */
  ref?: string;
  toGitUri?: (uri: vscode.Uri, ref: string) => vscode.Uri;
}

/**
 * Panel de "I'm back". Un único panel reutilizable, al lado del editor.
 * El webview solo pide acciones; la extensión decide y valida.
 */
export class ReturnPanel {
  private static current: ReturnPanel | undefined;

  static async show(
    context: vscode.ExtensionContext,
    session: Session,
    log: Logger,
    summaryPending: boolean,
    changes?: PanelChanges,
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
    await ReturnPanel.current.render(session, summaryPending, changes);
    ReturnPanel.current.panel.reveal(undefined, false);
    return ReturnPanel.current;
  }

  static dispose(): void {
    ReturnPanel.current?.panel.dispose();
  }

  private sessionId: string | undefined;
  private workspaceRoot = "";
  private changes: PanelChanges | undefined;

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

  private async render(session: Session, summaryPending: boolean, changes: PanelChanges | undefined): Promise<void> {
    this.sessionId = session.id;
    this.workspaceRoot = session.workspace.rootPath;
    this.changes = changes;
    const template = await fs.readFile(
      path.join(this.context.extensionUri.fsPath, "src", "panel", "returnPanel.html"),
      "utf8",
    );
    const nonce = randomBytes(16).toString("base64");
    const strings = panelStrings();
    const body = renderBody(session, summaryPending, strings, vscode.env.language, changes?.changes);
    this.panel.title = strings.title;
    // Reemplazos con función: así un "$&" o "$'" en los datos nunca se interpreta.
    this.panel.webview.html = template
      .replaceAll("{{cspSource}}", () => this.panel.webview.cspSource)
      .replaceAll("{{nonce}}", () => nonce)
      .replaceAll("{{lang}}", () => escape(vscode.env.language))
      .replaceAll("{{title}}", () => escape(strings.title))
      .replaceAll("{{generatingJson}}", () => JSON.stringify(strings.generating).replaceAll("<", "\\u003c"))
      .replace("{{body}}", () => body);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    try {
      if (message.type === "history") {
        await vscode.commands.executeCommand("retramo.history");
        return;
      }
      if (message.type === "openFile" && isSafeRelative(message.path)) {
        const line = typeof message.line === "number" && Number.isInteger(message.line) ? message.line : 1;
        await this.open(vscode.Uri.file(path.join(this.workspaceRoot, message.path)), line);
        return;
      }
      if (message.type === "openChange" && isSafeRelative(message.path)) {
        await this.openChange(message.path);
      }
    } catch (error) {
      this.log.error("panel: no se pudo abrir el archivo pedido", error);
    }
  }

  /** Solo abre rutas que figuran en la lista que el panel está mostrando. */
  private async openChange(relative: string): Promise<void> {
    const view = this.changes;
    const change = view?.changes.files.find((file) => file.path === relative);
    if (!view || !change || change.status === "deleted") {
      return;
    }
    const uri = vscode.Uri.file(path.join(view.repoRoot, relative));
    if (change.source === "git" && change.status === "modified" && view.ref && isObjectId(view.ref) && view.toGitUri) {
      const title = vscode.l10n.t("{0} (since you left)", path.basename(relative));
      await vscode.commands.executeCommand("vscode.diff", view.toGitUri(uri, view.ref), uri, title, {
        viewColumn: vscode.ViewColumn.One,
      });
      return;
    }
    await this.open(uri, 1);
  }

  private async open(uri: vscode.Uri, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Range(position, position),
    });
  }
}

function isSafeRelative(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}

// --- Textos -------------------------------------------------------------------

/** Textos visibles del panel. Separados del render para que `renderBody` siga siendo puro. */
export interface PanelStrings {
  title: string;
  middleOf: string;
  whileAway: (minutes: number) => string;
  branchChanged: (from: string, to: string) => string;
  detached: string;
  newCommits: string;
  historyRewritten: string;
  baselineLost: string;
  nothingChanged: string;
  andMore: (count: number) => string;
  status: Record<AwayChanges["files"][number]["status"], string>;
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
    middleOf: vscode.l10n.t("You were in the middle of"),
    whileAway: (minutes) => vscode.l10n.t("While you were away ({0})", formatDuration(minutes)),
    branchChanged: (from, to) => vscode.l10n.t("Branch changed: {0} → {1}", from, to),
    detached: vscode.l10n.t("(detached)"),
    newCommits: vscode.l10n.t("New commits"),
    historyRewritten: vscode.l10n.t("The branch history was rewritten (rebase or reset), so new commits can't be listed."),
    baselineLost: vscode.l10n.t("Compared against your last commit: the snapshot of your uncommitted work is gone."),
    nothingChanged: vscode.l10n.t("Nothing changed while you were away."),
    andMore: (count) => vscode.l10n.t("and {0} more", count),
    status: {
      modified: vscode.l10n.t("modified"),
      added: vscode.l10n.t("added"),
      deleted: vscode.l10n.t("deleted"),
      renamed: vscode.l10n.t("renamed"),
    },
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

export function renderBody(
  session: Session,
  summaryPending: boolean,
  t: PanelStrings,
  locale?: string,
  changes?: AwayChanges,
): string {
  const parts: string[] = [];
  parts.push(`<h1>${escape(t.title)}</h1>`);

  // 1. Intención
  if (session.intent) {
    parts.push(section("intent", t.middleOf, `<p class="intent">${escape(session.intent)}</p>`));
  }

  // 2. Mientras no estabas: solo con línea de base o con rutas del watcher
  if (changes && (session.baseline || changes.files.length > 0)) {
    parts.push(section("away", t.whileAway(changes.minutesAway), renderChanges(changes, t)));
  }

  // 3. Resumen con IA
  if (session.summary) {
    parts.push(section("summary", t.summary, `<p class="summary">${escape(session.summary.text)}</p>`));
  } else if (summaryPending) {
    parts.push(section("summary", t.summary, `<p class="summary muted">${escape(t.generating)}</p>`));
  } else {
    parts.push(`<section id="summary" hidden><h2>${escape(t.summary)}</h2><p class="summary"></p></section>`);
  }

  // 4. Archivo activo y línea
  if (session.editor.activeFile) {
    const line = session.editor.activeLine;
    const label = line ? `${session.editor.activeFile}:${line}` : session.editor.activeFile;
    parts.push(section("active", t.youWereIn, `<p>${fileLink(session.editor.activeFile, line, label)}</p>`));
  }

  // 5. Archivos modificados sin commitear al irse
  if (session.git && session.git.modifiedFiles.length > 0) {
    parts.push(section("modified", t.uncommitted, list(session.git.modifiedFiles.map((f) => fileLink(f, undefined, f)))));
  }

  // 6. Rama
  if (session.git) {
    let html = `<p><code>${escape(session.git.branch)}</code>`;
    if (session.git.lastCommitMessage) {
      html += ` <span class="muted">· ${escape(t.lastCommit)} ${escape(session.git.lastCommitMessage)}</span>`;
    }
    html += `</p>`;
    parts.push(section("branch", t.branch, html));
  }

  // 7. Últimos comandos de terminal
  if (session.terminal && session.terminal.recentCommands.length > 0) {
    let html = list(session.terminal.recentCommands.map((c) => `<code>${escape(c)}</code>`));
    if (session.terminal.cwd) {
      html += `<p class="muted">${escape(t.inDirectory)} <code>${escape(session.terminal.cwd)}</code></p>`;
    }
    parts.push(section("terminal", t.terminal, html));
  }

  // 8. Archivos abiertos, colapsado
  if (session.editor.openFiles.length > 0) {
    parts.push(
      `<details id="open"><summary><h2>${escape(t.openFiles)} (${session.editor.openFiles.length})</h2></summary>` +
        list(session.editor.openFiles.map((f) => fileLink(f, undefined, f))) +
        `</details>`,
    );
  }

  // 9. Pie
  const when = formatDate(session.createdAt, locale);
  const how = session.trigger === "manual" ? t.manual : t.automatic;
  parts.push(
    `<footer>${escape(t.savedOn(when, how))}` +
      `<a href="#" data-action="history">${escape(t.viewHistory)}</a></footer>`,
  );

  return parts.join("\n");
}

function renderChanges(changes: AwayChanges, t: PanelStrings): string {
  const parts: string[] = [];
  if (changes.branchChanged) {
    const { from, to } = changes.branchChanged;
    parts.push(`<p>${escape(t.branchChanged(from || t.detached, to || t.detached))}</p>`);
  }
  if (changes.historyRewritten) {
    parts.push(`<p class="muted">${escape(t.historyRewritten)}</p>`);
  }
  if (changes.newCommits.length > 0) {
    parts.push(
      `<h3>${escape(t.newCommits)}</h3>` +
        list(
          changes.newCommits.map(
            (c) => `<code>${escape(c.hash.slice(0, 7))}</code> ${escape(c.subject)} <span class="muted">· ${escape(c.author)}</span>`,
          ),
        ),
    );
  }
  if (changes.files.length > 0) {
    parts.push(
      list(
        changes.files.map((file) => {
          const label = `<code>${escape(file.path)}</code>`;
          const item =
            file.status === "deleted"
              ? `<del>${label}</del>`
              : `<a href="#" data-action="change" data-path="${escape(file.path)}">${label}</a>`;
          return `${item} <span class="muted">${escape(t.status[file.status])}</span>`;
        }),
      ),
    );
  }
  if (changes.overflow > 0) {
    parts.push(`<p class="muted">${escape(t.andMore(changes.overflow))}</p>`);
  }
  if (changes.baselineLost) {
    parts.push(`<p class="muted">${escape(t.baselineLost)}</p>`);
  }
  if (!changes.branchChanged && !changes.historyRewritten && changes.newCommits.length === 0 && changes.files.length === 0 && changes.overflow === 0) {
    parts.push(`<p>${escape(t.nothingChanged)}</p>`);
  }
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
