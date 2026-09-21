import * as vscode from "vscode";
import { createLogger, Logger } from "./log";
import { Session, SessionStore, HISTORY_LIMIT } from "./session";
import { captureSession } from "./capture";
import { captureEditor } from "./capture/editor";
import { captureGit } from "./capture/git";
import { TerminalTracker } from "./capture/terminal";
import { IdleDetector, normalizeIdleMinutes } from "./idle/detector";
import { ReturnPanel } from "./panel/returnPanel";
import { createSummaryProvider, configuredProviderKind, SECRET_KEYS } from "./summary";
import { Telemetry } from "./telemetry/optin";

let log: Logger;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel("Retramo");
  context.subscriptions.push(channel);
  log = createLogger(channel);

  const store = new SessionStore(context.globalStorageUri.fsPath, log);
  const terminal = new TerminalTracker(log);
  context.subscriptions.push(terminal);
  const telemetry = new Telemetry(context, log);

  const config = () => vscode.workspace.getConfiguration("retramo");

  // --- Captura -------------------------------------------------------------

  async function leave(trigger: "manual" | "idle", note?: string): Promise<Session | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      log.warn("leave: no hay carpeta abierta, no se guarda sesión");
      if (trigger === "manual") {
        vscode.window.setStatusBarMessage("Retramo: abrí una carpeta para guardar una sesión", 4000);
      }
      return undefined;
    }
    const root = folder.uri.fsPath;
    const captureSelection = config().get<boolean>("captureSelection", false);
    const session = await captureSession(
      { trigger, note, workspace: { name: folder.name, rootPath: root } },
      {
        editor: () => captureEditor(root, captureSelection),
        git: () => captureGit(root),
        terminal: () => terminal.capture(),
      },
      log,
    );
    await store.save(session);
    log.info(`leave: sesión ${session.id} guardada (${trigger})`);
    return session;
  }

  // --- Inactividad ---------------------------------------------------------

  const idle = new IdleDetector({
    getIdleMs: () => normalizeIdleMinutes(config().get("idleMinutes")) * 60_000,
    onIdle: async () => {
      const session = await leave("idle");
      if (session) {
        log.info("idle: sesión automática guardada");
      }
    },
    onError: (error) => log.error("idle: falló la captura automática", error),
  });
  context.subscriptions.push({ dispose: () => idle.dispose() });
  const activity = () => idle.activity();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(activity),
    vscode.window.onDidChangeActiveTextEditor(activity),
    vscode.window.onDidChangeTextEditorSelection(activity),
    // Perder el foco NO dispara nada: el temporizador sigue corriendo.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        activity();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("retramo.idleMinutes")) {
        idle.restart();
      }
    }),
  );
  idle.start();

  // --- Panel de "volví" ----------------------------------------------------

  async function showSession(session: Session): Promise<void> {
    const provider = session.summary ? undefined : await createSummaryProvider(context, log);
    const panel = await ReturnPanel.show(context, session, log, provider !== undefined);
    await telemetry.recordReturn();
    if (!provider) {
      return;
    }
    // Primero se muestra el estado crudo; el resumen llega después sin bloquear.
    void (async () => {
      try {
        const text = await provider.summarize(session);
        session.summary = { text, provider: provider.name, generatedAt: new Date().toISOString() };
        await store.save(session);
        panel.updateSummary(session.id, text);
      } catch (error) {
        log.error(`summary: falló ${provider.name}`, error);
        panel.updateSummary(session.id, undefined);
      }
    })();
  }

  function currentRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  // --- Comandos ------------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand("retramo.leave", async () => {
      const note = await vscode.window.showInputBox({
        placeHolder: "¿Qué estabas haciendo? (opcional)",
        prompt: "Enter vacío para saltear",
        ignoreFocusOut: true,
      });
      if (note === undefined) {
        return; // Escape: cancelado
      }
      try {
        const session = await leave("manual", note);
        if (session) {
          vscode.window.setStatusBarMessage("Retramo: sesión guardada", 3000);
        }
      } catch (error) {
        log.error("leave: no se pudo guardar la sesión", error);
        vscode.window.setStatusBarMessage("Retramo: no se pudo guardar (ver log)", 4000);
      }
    }),

    vscode.commands.registerCommand("retramo.return", async () => {
      const session = (await store.latest(currentRoot())) ?? (await store.latest());
      if (!session) {
        vscode.window.setStatusBarMessage("Retramo: todavía no hay sesiones guardadas", 4000);
        return;
      }
      await showSession(session);
    }),

    vscode.commands.registerCommand("retramo.history", async () => {
      const entries = await store.list(HISTORY_LIMIT);
      if (entries.length === 0) {
        vscode.window.setStatusBarMessage("Retramo: todavía no hay sesiones guardadas", 4000);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
          label: entry.note ?? entry.activeFile ?? "(sin nota)",
          description: `${entry.workspaceName} · ${entry.trigger === "manual" ? "manual" : "automático"}`,
          detail: new Date(entry.createdAt).toLocaleString(),
          id: entry.id,
        })),
        { placeHolder: "Elegí una sesión", matchOnDescription: true, matchOnDetail: true },
      );
      if (!picked) {
        return;
      }
      const session = await store.get(picked.id);
      if (session) {
        await showSession(session);
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
              placeHolder: "¿Para qué proveedor?",
            });
      if (provider !== "openai" && provider !== "anthropic") {
        return;
      }
      const key = await vscode.window.showInputBox({
        prompt: `Clave de API de ${provider}. Se guarda en el almacén de secretos de VS Code, nunca en settings.json.`,
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) {
        return;
      }
      if (key.trim() === "") {
        await context.secrets.delete(SECRET_KEYS[provider]);
        vscode.window.setStatusBarMessage(`Retramo: clave de ${provider} eliminada`, 3000);
        return;
      }
      await context.secrets.store(SECRET_KEYS[provider], key.trim());
      if (kind === "none") {
        await config().update("summary.provider", provider, vscode.ConfigurationTarget.Global);
      }
      vscode.window.setStatusBarMessage(`Retramo: clave de ${provider} guardada`, 3000);
    }),
  );

  // --- Telemetría opt-in ---------------------------------------------------

  void telemetry.askOnce().then(() => telemetry.flushIfDue());

  log.info("Retramo activa");
}

export function deactivate(): void {
  ReturnPanel.dispose();
}
