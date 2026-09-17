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
});
