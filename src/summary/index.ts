import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SummaryProvider, SummaryProviderKind } from "./provider";
import { AnthropicProvider, OpenAIProvider } from "./byok";
import { OllamaProvider } from "./local";
import type { Logger } from "../log";

export const SECRET_KEYS: Record<"openai" | "anthropic", string> = {
  openai: "retramo.apiKey.openai",
  anthropic: "retramo.apiKey.anthropic",
};

export function configuredProviderKind(): SummaryProviderKind {
  const value = vscode.workspace.getConfiguration("retramo").get<string>("summary.provider", "none");
  return value === "openai" || value === "anthropic" || value === "ollama" ? value : "none";
}

/**
 * Devuelve el proveedor configurado o `undefined` si no hay ninguno usable
 * (sin proveedor, o sin clave). En ese caso la opción simplemente no existe
 * para el usuario: no se muestra nada.
 */
export async function createSummaryProvider(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<SummaryProvider | undefined> {
  const kind = configuredProviderKind();
  if (kind === "none") {
    return undefined;
  }
  const template = await loadPromptTemplate(context);
  if (kind === "ollama") {
    const endpoint = vscode.workspace
      .getConfiguration("retramo")
      .get<string>("summary.ollamaEndpoint", "http://localhost:11434");
    return new OllamaProvider(endpoint, template, log);
  }
  const key = await context.secrets.get(SECRET_KEYS[kind]);
  if (!key) {
    log.warn(`summary: proveedor "${kind}" configurado pero sin clave; usá "Retramo: Configurar clave de API"`);
    return undefined;
  }
  return kind === "openai" ? new OpenAIProvider(key, template) : new AnthropicProvider(key, template);
}

async function loadPromptTemplate(context: vscode.ExtensionContext): Promise<string> {
  const file = path.join(context.extensionUri.fsPath, "prompts", "summary.txt");
  return fs.readFile(file, "utf8");
}

export { SummaryProvider } from "./provider";
