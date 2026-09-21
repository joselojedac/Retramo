import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { Logger } from "../log";

/**
 * Telemetría opt-in. Lo ÚNICO que se envía, y sólo si el usuario dijo que sí:
 *
 *   POST <TELEMETRY_ENDPOINT>
 *   { "installId": "<uuid>", "returnCount": <n>, "version": "<x.y.z>" }
 *
 * Una vez por semana. Nada más, nunca. Se respeta además
 * `telemetry.telemetryLevel` de VS Code: si está en "off", no se envía nada
 * aunque el usuario haya dicho que sí.
 *
 * El endpoint es una constante para no sumar opciones de configuración
 * (AGENTS.md §11). El servidor está en `server/telemetry/`.
 */
export const TELEMETRY_ENDPOINT = "https://retramo-telemetry.netlify.app/ping";

const KEY_ASKED = "retramo.telemetry.asked";
const KEY_INSTALL_ID = "retramo.telemetry.installId";
const KEY_RETURN_COUNT = "retramo.telemetry.returnCount";
const KEY_LAST_SENT = "retramo.telemetry.lastSentAt";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class Telemetry {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Única excepción a "nunca interrumpe": un aviso, una sola vez, al instalar. */
  async askOnce(): Promise<void> {
    if (this.context.globalState.get<boolean>(KEY_ASKED)) {
      return;
    }
    await this.context.globalState.update(KEY_ASKED, true);
    const answer = await vscode.window.showInformationMessage(
      "¿Podemos contar cuántas veces por semana usás Volví? Solo el número, nada más.",
      "Sí",
      "No",
    );
    const enabled = answer === "Sí"; // cerrar el aviso equivale a No
    await vscode.workspace
      .getConfiguration("retramo")
      .update("telemetry", enabled, vscode.ConfigurationTarget.Global);
    this.log.info(`telemetry: el usuario ${enabled ? "aceptó" : "rechazó"} el conteo semanal`);
  }

  async recordReturn(): Promise<void> {
    const count = this.context.globalState.get<number>(KEY_RETURN_COUNT, 0);
    await this.context.globalState.update(KEY_RETURN_COUNT, count + 1);
  }

  private enabled(): boolean {
    const optedIn = vscode.workspace.getConfiguration("retramo").get<boolean>("telemetry", false);
    return optedIn && vscode.env.isTelemetryEnabled;
  }

  /** Envía el conteo si pasó una semana desde el último envío. */
  async flushIfDue(): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    const lastSent = this.context.globalState.get<number>(KEY_LAST_SENT, 0);
    if (Date.now() - lastSent < WEEK_MS) {
      return;
    }
    if (!TELEMETRY_ENDPOINT) {
      this.log.info("telemetry: sin endpoint configurado, no se envía nada");
      return;
    }
    const payload = {
      installId: await this.installId(),
      returnCount: this.context.globalState.get<number>(KEY_RETURN_COUNT, 0),
      version: String(this.context.extension.packageJSON.version ?? "0.0.0"),
    };
    try {
      const response = await this.fetchImpl(TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.log.warn(`telemetry: el servidor respondió ${response.status}`);
        return;
      }
      await this.context.globalState.update(KEY_LAST_SENT, Date.now());
      await this.context.globalState.update(KEY_RETURN_COUNT, 0);
      this.log.info(`telemetry: enviado ${JSON.stringify(payload)}`);
    } catch (error) {
      this.log.warn(`telemetry: no se pudo enviar (${String(error)})`);
    }
  }

  private async installId(): Promise<string> {
    let id = this.context.globalState.get<string>(KEY_INSTALL_ID);
    if (!id) {
      id = randomUUID();
      await this.context.globalState.update(KEY_INSTALL_ID, id);
    }
    return id;
  }
}
