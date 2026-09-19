import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Reentry", () => {
  test("la extensión se activa y registra sus comandos", async () => {
    const extension = vscode.extensions.getExtension("joselojedac.reentry");
    assert.ok(extension, "extensión no encontrada");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["reentry.leave", "reentry.return", "reentry.history", "reentry.openData", "reentry.setApiKey"]) {
      assert.ok(commands.includes(id), `falta el comando ${id}`);
    }
  });

  test("la configuración tiene los defaults de la v0", () => {
    const config = vscode.workspace.getConfiguration("reentry");
    assert.strictEqual(config.get("idleMinutes"), 20);
    assert.strictEqual(config.get("captureSelection"), false);
    assert.strictEqual(config.get("summary.provider"), "none");
    assert.strictEqual(config.get("summary.ollamaEndpoint"), "http://localhost:11434");
    assert.strictEqual(config.get("telemetry"), false);
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
      await vscode.commands.executeCommand("reentry.leave");
    } finally {
      window.showInputBox = original;
    }

    await vscode.commands.executeCommand("reentry.return");
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    const panel = tabs.find((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === "Volví");
    assert.ok(panel, "no se abrió el panel de Volví");
    assert.notStrictEqual(panel.group.viewColumn, vscode.ViewColumn.One, "el panel reemplazó al editor activo");
  });
});
