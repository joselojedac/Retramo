import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Retramo", () => {
  test("la extensión se activa y registra sus comandos", async () => {
    const extension = vscode.extensions.getExtension("joselojedac.retramo");
    assert.ok(extension, "extensión no encontrada");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["retramo.leave", "retramo.return", "retramo.history", "retramo.openData", "retramo.setApiKey"]) {
      assert.ok(commands.includes(id), `falta el comando ${id}`);
    }
  });

  test("la configuración tiene los defaults de la v0", () => {
    const config = vscode.workspace.getConfiguration("retramo");
    assert.strictEqual(config.get("idleMinutes"), 20);
    assert.strictEqual(config.get("captureSelection"), false);
    assert.strictEqual(config.get("summary.provider"), "none");
    assert.strictEqual(config.get("summary.ollamaEndpoint"), "http://localhost:11434");
    assert.strictEqual(config.get("telemetry"), false);
  });

  test("un repo no puede redirigir las sesiones con su .vscode/settings.json", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "el test necesita un workspace abierto");
    const settingsFile = vscode.Uri.joinPath(folder.uri, ".vscode", "settings.json");
    const malicious = {
      "retramo.idleMinutes": 7, // control: este sí se puede fijar por workspace
      "retramo.summary.provider": "ollama",
      "retramo.summary.ollamaEndpoint": "https://attacker.example",
      "retramo.telemetry": true,
      "retramo.captureSelection": true,
    };
    await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(JSON.stringify(malicious)));
    const config = () => vscode.workspace.getConfiguration("retramo");
    try {
      await waitFor(() => config().get("idleMinutes") === 7, "VS Code no leyó el settings.json del workspace");
      assert.strictEqual(config().get("summary.provider"), "none");
      assert.strictEqual(config().get("summary.ollamaEndpoint"), "http://localhost:11434");
      assert.strictEqual(config().get("telemetry"), false);
      assert.strictEqual(config().get("captureSelection"), false);
    } finally {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder.uri, ".vscode"), { recursive: true });
      await waitFor(() => config().get("idleMinutes") === 20, "no se restauró la configuración");
    }
  });

  test("me fui y volví: guarda la sesión y abre el panel al lado", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "el test necesita un workspace abierto");
    const file = vscode.Uri.joinPath(folder.uri, "src", "main.ts");
    const editor = await vscode.window.showTextDocument(file);
    editor.selection = new vscode.Selection(2, 0, 2, 0);

    // Simula que el usuario escribe la nota en el input box.
    const window = vscode.window as { showInputBox: typeof vscode.window.showInputBox };
    const original = window.showInputBox;
    window.showInputBox = async () => "probando el test de integración";
    try {
      await vscode.commands.executeCommand("retramo.leave");
    } finally {
      window.showInputBox = original;
    }

    await vscode.commands.executeCommand("retramo.return");
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    // Por tipo de vista y no por título: el título depende del idioma de VS Code.
    const panel = tabs.find(
      (tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("retramo.return"),
    );
    assert.ok(panel, "no se abrió el panel de Volví");
    assert.notStrictEqual(panel.group.viewColumn, vscode.ViewColumn.One, "el panel reemplazó al editor activo");
  });
});

async function waitFor(condition: () => boolean, message: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
