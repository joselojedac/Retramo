import * as vscode from "vscode";
import type { AwayChanges } from "../changes/compute";

export const STATUS_TIMEOUT_MS = 10 * 60_000;

/**
 * La única señal del regreso: un ítem en la barra de estado. Nunca abre el
 * panel solo. Desaparece al abrir el panel o a los 10 minutos.
 */
export class ReturnStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem("retramo.return", vscode.StatusBarAlignment.Left, 100);
    this.item.name = "Retramo";
    this.item.command = "retramo.return";
  }

  show(changes: AwayChanges): void {
    this.item.text = `$(history) ${statusText(changes)}`;
    this.item.tooltip = vscode.l10n.t("Retramo: open what changed while you were away");
    this.item.show();
    this.clearTimer();
    this.timer = setTimeout(() => this.hide(), STATUS_TIMEOUT_MS);
  }

  hide(): void {
    this.clearTimer();
    this.item.hide();
  }

  dispose(): void {
    this.clearTimer();
    this.item.dispose();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

function statusText(changes: AwayChanges): string {
  const files = changes.files.length + changes.overflow;
  if (files === 1) {
    return vscode.l10n.t("Retramo: 1 change while you were away");
  }
  if (files > 1) {
    return vscode.l10n.t("Retramo: {0} changes while you were away", files);
  }
  if (changes.branchChanged) {
    return vscode.l10n.t("Retramo: branch changed while you were away");
  }
  const commits = changes.newCommits.length;
  if (commits === 1) {
    return vscode.l10n.t("Retramo: 1 new commit while you were away");
  }
  if (commits > 1) {
    return vscode.l10n.t("Retramo: {0} new commits while you were away", commits);
  }
  return vscode.l10n.t("Retramo: back after {0}", formatDuration(changes.minutesAway));
}

/** "47 min", "3 h 5 min", "2 d". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return vscode.l10n.t("{0} min", minutes);
  }
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? vscode.l10n.t("{0} h", h) : vscode.l10n.t("{0} h {1} min", h, m);
  }
  return vscode.l10n.t("{0} d", Math.floor(minutes / (24 * 60)));
}
