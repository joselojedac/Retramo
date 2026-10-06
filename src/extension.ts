import * as vscode from "vscode";
import * as path from "node:path";
import { createLogger, Logger } from "./log";
import { Session, SessionStore, HISTORY_LIMIT } from "./session";
import { MAX_INTENT_CHARS } from "./session/model";
import { captureSession } from "./capture";
import { captureEditor } from "./capture/editor";
import { captureGit } from "./capture/git";
import { TerminalTracker } from "./capture/terminal";
import { normalizeIdleMinutes } from "./idle/detector";
import { PresenceFilter, SelectionKind } from "./idle/presence";
import { AwayController, AwayRecording, SaveInput } from "./away/controller";
import { AwayLog } from "./away/log";
import { awayExcludes, watchAway } from "./away/watcher";
import { captureBaseline } from "./baseline/snapshot";
import { computeAwayChanges } from "./changes/compute";
import { createGitRunner } from "./git/exec";
import { getGitApi, pickRepository } from "./git/api";
import { isObjectId } from "./git/objectId";
import { ReturnStatusBar } from "./return/statusBar";
import { PanelChanges, ReturnPanel } from "./panel/returnPanel";
import { createSummaryProvider, configuredProviderKind, SECRET_KEYS } from "./summary";
import { Telemetry } from "./telemetry/optin";

let log: Logger;
let controller: AwayController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Retramo");
  context.subscriptions.push(channel);
  log = createLogger(channel);

  const store = new SessionStore(context.globalStorageUri.fsPath, log);
  const terminal = new TerminalTracker(log);
  const statusBar = new ReturnStatusBar();
  context.subscriptions.push(terminal, statusBar);
  const telemetry = new Telemetry(context, log);

  const config = () => vscode.workspace.getConfiguration("retramo");
  const workspaceFolder = () => vscode.workspace.workspaceFolders?.[0];
  const currentRoot = () => workspaceFolder()?.uri.fsPath;

  // --- Ausencia: línea de base, watcher y regreso --------------------------

  async function startRecording(): Promise<AwayRecording | undefined> {
    const folder = workspaceFolder();
    if (!folder) {
      return undefined;
    }
    const workspaceRoot = folder.uri.fsPath;
    let baseline: AwayRecording["baseline"];
    let watchRoot = workspaceRoot;
    try {
      const api = await getGitApi();
      const repo = api && pickRepository(api.repositories, workspaceRoot, vscode.window.activeTextEditor?.document.uri.fsPath);
      if (api && repo) {
        const repoRoot = repo.rootUri.fsPath;
        baseline = await captureBaseline({ git: createGitRunner(api.git.path, repoRoot), repoRoot, workspaceRoot });
        watchRoot = repoRoot; // con línea de base, las rutas son relativas al repo
        if (baseline.error) {
          log.warn(`baseline: ${baseline.error}`);
        }
      }
    } catch (error) {
      log.error("baseline: no se pudo capturar", error);
    }
    const awayLog = new AwayLog(awayExcludes(folder.uri));
    const watcher = watchAway(watchRoot, awayLog);
    return { baseline, log: awayLog, stop: () => watcher.dispose() };
  }

  async function saveSession(input: SaveInput): Promise<Session | undefined> {
    const folder = workspaceFolder();
    if (!folder) {
      log.warn("leave: no hay carpeta abierta, no se guarda sesión");
      return undefined;
    }
    const root = folder.uri.fsPath;
    const session = await captureSession(
      { trigger: input.trigger, intent: input.intent, workspace: { name: folder.name, rootPath: root } },
      {
        editor: () => captureEditor(root),
        git: () => captureGit(root),
        terminal: () => terminal.capture(),
      },
      log,
    );
    if (input.baseline) {
      session.baseline = input.baseline;
    }
    session.away = input.away;
    await store.save(session);
    log.info(`leave: sesión ${session.id} guardada (${input.trigger})`);
    return session;
  }

  /** "Mientras no estabas" para una sesión, listo para el panel. */
  async function changesFor(session: Session): Promise<PanelChanges | undefined> {
    if (!session.baseline && !session.away) {
      return undefined; // sesión v1: la sección no se muestra
    }
    const baseline = session.baseline;
    const repoRoot = baseline ? path.resolve(session.workspace.rootPath, baseline.repoRoot) : session.workspace.rootPath;
    const api = await getGitApi().catch(() => undefined);
    const git = api && baseline ? createGitRunner(api.git.path, repoRoot) : undefined;
    const changes = await computeAwayChanges({ session, git, repoRoot });
    const ref = baseline && (changes.baselineLost ? baseline.head : (baseline.snapshot ?? baseline.head));
    return {
      changes,
      repoRoot,
      ref: isObjectId(ref) ? ref : undefined,
      toGitUri: api ? (uri, commit) => api.toGitUri(uri, commit) : undefined,
    };
  }

  const away = new AwayController({
    idleMs: () => normalizeIdleMinutes(config().get("idleMinutes")) * 60_000,
    startRecording,
    saveSession,
    persist: (session) => store.save(session),
    onReturn: async (session) => {
      try {
        const view = await changesFor(session);
        if (view) {
          statusBar.show(view.changes);
        }
      } catch (error) {
        log.error("return: no se pudieron calcular los cambios", error);
      }
    },
    log,
  });
  controller = away;

  // Solo la actividad humana cuenta como presencia (ver idle/presence.ts).
  // onDidChangeTextDocument NO cuenta: lo disparan agentes y formateadores.
  const presence = new PresenceFilter({ onPresence: () => away.presence() });
  context.subscriptions.push({ dispose: () => presence.dispose() });
  const focused = () => vscode.window.state.focused;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => presence.selection(selectionKind(e.kind), focused())),
    vscode.window.onDidChangeTextEditorVisibleRanges(() => presence.visibleRanges(focused())),
    vscode.window.onDidChangeActiveTextEditor(() => presence.nonHuman()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Solo para descartar el scroll que acompaña a una edición. Los canales
      // de salida (incluido el log de Retramo) también son documentos: se ignoran.
      const scheme = e.document.uri.scheme;
      if (e.contentChanges.length > 0 && (scheme === "file" || scheme === "untitled")) {
        presence.nonHuman();
      }
    }),
    // Perder el foco NO dispara nada: el temporizador sigue corriendo.
    vscode.window.onDidChangeWindowState((state) => presence.windowFocus(state.focused)),
    vscode.window.onDidStartTerminalShellExecution((e) =>
      presence.shellExecution(e.terminal === vscode.window.activeTerminal, focused()),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("retramo.idleMinutes")) {
        away.restartIdle();
      }
    }),
  );

  away.start();
  // Una sesión guardada sin regreso (VS Code se cerró durante la ausencia)
  // sigue abierta: la próxima presencia es el regreso.
  const pending = await store.latest(currentRoot()).catch(() => undefined);
  if (pending && currentRoot()) {
    away.restore(pending);
  }

  // --- Panel de "I'm back" -------------------------------------------------

  /**
   * `allowSummary` en false muestra la sesión sin mandarla a ningún proveedor.
   * Se usa cuando la sesión no la eligió el usuario y es de otro proyecto.
   */
  async function showSession(session: Session, allowSummary: boolean): Promise<void> {
    statusBar.hide();
    let view: PanelChanges | undefined;
    try {
      view = await changesFor(session);
    } catch (error) {
      log.error("panel: no se pudieron calcular los cambios", error);
    }
    const provider = session.summary || !allowSummary ? undefined : await createSummaryProvider(context, log);
    const panel = await ReturnPanel.show(context, session, log, provider !== undefined, view);
    await telemetry.recordReturn();
    if (!provider) {
      return;
    }
    // Primero se muestra el estado crudo; el resumen llega después sin bloquear.
    void (async () => {
      try {
        const text = await provider.summarize(session);
        session.summary = { text, provider: provider.name, includedDiffs: false, generatedAt: new Date().toISOString() };
        await store.save(session);
        panel.updateSummary(session.id, text);
      } catch (error) {
        log.error(`summary: falló ${provider.name}`, error);
        panel.updateSummary(session.id, undefined);
      }
    })();
  }

  // --- Comandos ------------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand("retramo.leave", async () => {
      if (!workspaceFolder()) {
        vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: open a folder to save a session"), 4000);
        return;
      }
      const intent = await vscode.window.showInputBox({
        placeHolder: vscode.l10n.t("What were you in the middle of? (optional)"),
        prompt: vscode.l10n.t("Press Enter with no text to skip"),
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim().length > MAX_INTENT_CHARS
            ? vscode.l10n.t("Keep it under {0} characters", MAX_INTENT_CHARS)
            : undefined,
      });
      if (intent === undefined) {
        return; // Escape: cancelado
      }
      try {
        const session = await away.leaveManual(intent);
        if (session) {
          vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: session saved"), 3000);
        }
      } catch (error) {
        log.error("leave: no se pudo guardar la sesión", error);
        vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: could not save (see log)"), 4000);
      }
    }),

    vscode.commands.registerCommand("retramo.return", async () => {
      // Pedirlo a mano también cierra la ausencia abierta, si hay.
      const ended = await away.returnNow();
      const own = ended ?? (await store.latest(currentRoot()));
      // Sin sesión de este proyecto se muestra la última de cualquiera, pero
      // sin resumen: no se manda a un proveedor algo que el usuario no eligió.
      const session = own ?? (await store.latest());
      if (!session) {
        vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: no saved sessions yet"), 4000);
        return;
      }
      await showSession(session, own !== undefined);
    }),

    vscode.commands.registerCommand("retramo.history", async () => {
      const entries = await store.list(HISTORY_LIMIT);
      if (entries.length === 0) {
        vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: no saved sessions yet"), 4000);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
          label: entry.intent ?? entry.activeFile ?? vscode.l10n.t("(no note)"),
          description: `${entry.workspaceName} · ${entry.trigger === "manual" ? vscode.l10n.t("manual") : vscode.l10n.t("automatic")}`,
          detail: new Date(entry.createdAt).toLocaleString(vscode.env.language),
          id: entry.id,
        })),
        { placeHolder: vscode.l10n.t("Pick a session"), matchOnDescription: true, matchOnDetail: true },
      );
      if (!picked) {
        return;
      }
      const session = await store.get(picked.id);
      if (session) {
        await showSession(session, true); // elegida a mano por el usuario
      }
    }),

    vscode.commands.registerCommand("retramo.openData", async () => {
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const target = vscode.Uri.joinPath(context.globalStorageUri, "index.json");
      try {
        await vscode.workspace.fs.stat(target);
        await vscode.commands.executeCommand("revealFileInOS", target);
      } catch {
        await vscode.env.openExternal(context.globalStorageUri);
      }
    }),

    vscode.commands.registerCommand("retramo.setApiKey", async () => {
      const kind = configuredProviderKind();
      const provider =
        kind === "openai" || kind === "anthropic"
          ? kind
          : await vscode.window.showQuickPick(["openai", "anthropic"], {
              placeHolder: vscode.l10n.t("Which provider?"),
            });
      if (provider !== "openai" && provider !== "anthropic") {
        return;
      }
      const key = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("{0} API key. Stored in VS Code's secret storage, never in settings.json.", provider),
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) {
        return;
      }
      if (key.trim() === "") {
        await context.secrets.delete(SECRET_KEYS[provider]);
        vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: {0} key removed", provider), 3000);
        return;
      }
      await context.secrets.store(SECRET_KEYS[provider], key.trim());
      if (kind === "none") {
        await config().update("summary.provider", provider, vscode.ConfigurationTarget.Global);
      }
      vscode.window.setStatusBarMessage(vscode.l10n.t("Retramo: {0} key saved", provider), 3000);
    }),
  );

  // --- Telemetría opt-in ---------------------------------------------------

  void telemetry.askOnce().then(() => telemetry.flushIfDue());

  log.info("Retramo activa");
}

function selectionKind(kind: vscode.TextEditorSelectionChangeKind | undefined): SelectionKind {
  switch (kind) {
    case vscode.TextEditorSelectionChangeKind.Keyboard:
      return "keyboard";
    case vscode.TextEditorSelectionChangeKind.Mouse:
      return "mouse";
    case vscode.TextEditorSelectionChangeKind.Command:
      return "command";
    default:
      return "unknown";
  }
}

export async function deactivate(): Promise<void> {
  ReturnPanel.dispose();
  await controller?.dispose();
  controller = undefined;
}
