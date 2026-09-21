# Retramo

Guarda tu estado de trabajo cuando te vas y te lo muestra cuando volvés.

Está hecha para gente con ADHD (o con demasiadas reuniones) que pierde el hilo con cada interrupción. Dos acciones, nada de configuración para empezar, y todo se queda en tu máquina.

## Dos acciones

| Acción | Comando | Atajo |
|---|---|---|
| **Me fui** | `Retramo: Me fui` | `Ctrl+Alt+L` (`Cmd+Alt+L` en Mac) |
| **Volví** | `Retramo: Volví` | `Ctrl+Alt+R` (`Cmd+Alt+R` en Mac) |

**Me fui** captura dónde estabas, te deja escribir una nota de una línea (opcional, Enter vacío para saltear) y guarda la sesión.

**Volví** abre un panel al lado del editor con lo que dejaste, en este orden:

1. Tu nota, en grande.
2. Resumen con IA, si lo configuraste.
3. Archivo activo y línea, como link.
4. Archivos modificados sin commitear.
5. Rama de git.
6. Últimos comandos de terminal.
7. Archivos abiertos (colapsado).

Además, si pasás 20 minutos sin tocar nada, Retramo guarda una sesión sola. Sin avisos, sin popups.

Comandos secundarios:

- `Retramo: Historial` — elegí entre las últimas 20 sesiones.
- `Retramo: Abrir carpeta de datos` — abre la carpeta con los JSON, para que veas exactamente qué se guardó.
- `Retramo: Configurar clave de API para resúmenes` — solo si querés resúmenes con OpenAI o Anthropic.

## Qué se guarda

Cada sesión es un archivo JSON legible, uno por sesión, en la carpeta de almacenamiento global de VS Code. Se ve así:

```json
{
  "id": "01J9X4M3V9K2Q4R8T7W1Z5B6C7",
  "createdAt": "2025-09-17T14:03:00.000Z",
  "trigger": "manual",
  "note": "el test de login falla por el token vencido",
  "workspace": { "name": "mi-app", "rootPath": "/home/yo/mi-app" },
  "editor": {
    "activeFile": "src/auth/login.ts",
    "activeLine": 42,
    "openFiles": ["src/auth/login.ts", "test/login.test.ts"]
  },
  "git": {
    "branch": "fix/login-token",
    "modifiedFiles": ["src/auth/login.ts"],
    "lastCommitMessage": "wip: refresh token"
  },
  "terminal": {
    "recentCommands": ["npm test -- login"],
    "cwd": "/home/yo/mi-app"
  }
}
```

**Nunca se guarda contenido de archivos ni diffs.** Solo nombres, rutas relativas al workspace y posiciones. La única excepción es la selección del editor activo, recortada a 200 caracteres, y solo si activás `retramo.captureSelection` (viene apagado).

Los comandos de terminal se registran a medida que los ejecutás (VS Code 1.93 o superior), sin su salida. Git se lee a través de la extensión Git integrada, nunca ejecutando `git` por shell.

## Local por defecto

Nada sale de tu máquina salvo que lo actives explícitamente. Ni telemetría, ni contenido, ni claves. Hay exactamente dos cosas que pueden salir, y las dos son opt-in:

### 1. Resumen con IA (opcional)

Si configurás `retramo.summary.provider` en `openai`, `anthropic` u `ollama`, al abrir **Volví** se genera un resumen de dos o tres oraciones. El panel muestra primero el estado crudo y el resumen llega después, sin bloquear nada.

**Lo que se envía al proveedor es el JSON de la sesión** (el mismo de arriba, sin el campo `summary`) dentro del prompt que está en [`prompts/summary.txt`](prompts/summary.txt). Como el modelo de sesión no contiene contenido de archivos, no se envía código.

- `openai` y `anthropic` usan tu propia clave. Se guarda en el almacén de secretos de VS Code (`context.secrets`), nunca en `settings.json`. Configurala con `Retramo: Configurar clave de API para resúmenes`.
- `ollama` usa el endpoint de `retramo.summary.ollamaEndpoint` (default `http://localhost:11434`) y el primer modelo que tengas instalado. No sale nada de tu red.

Sin clave configurada y sin endpoint local, la opción no existe: no se muestra nada.

### 2. Telemetría (opcional, apagada por defecto)

La primera vez que arranca, Retramo pregunta una sola vez: *"¿Podemos contar cuántas veces por semana usás Volví? Solo el número, nada más."* Cerrar el aviso equivale a No.

Si decís que sí, una vez por semana se envía **exactamente esto** y nada más:

```json
{ "installId": "<uuid aleatorio>", "returnCount": 12, "version": "0.1.0" }
```

Podés cambiarlo cuando quieras con `retramo.telemetry`. Se respeta también `telemetry.telemetryLevel` de VS Code: si lo tenés en `off`, no se envía nada aunque hayas dicho que sí.

Se envía por `POST` a `https://retramo-telemetry.netlify.app/ping`. El servidor guarda solo esos tres campos, agrupados por semana; no guarda tu IP ni ningún otro dato. Su código está en [`server/telemetry/`](server/telemetry/).

## Configuración

Todo lo que hay:

```json
{
  "retramo.idleMinutes": 20,
  "retramo.captureSelection": false,
  "retramo.summary.provider": "none",
  "retramo.summary.ollamaEndpoint": "http://localhost:11434",
  "retramo.telemetry": false
}
```

`retramo.idleMinutes` tiene un mínimo de 5.

## Errores

Si algo no se puede capturar (no hay git, la terminal está cerrada), Retramo guarda lo que pudo y anota el fallo en el canal de salida **Retramo** (`Ver > Salida`). No muestra errores por cosas que no bloquean.

## Desarrollo

```bash
npm install
npm run compile      # TypeScript → out/
npm run lint
npm run test:unit    # vitest, sin VS Code
npm test             # @vscode/test-electron, descarga VS Code
npm run package      # genera el .vsix
```

`F5` en VS Code abre un host de desarrollo con la extensión cargada.

La especificación completa del proyecto está en [`AGENTS.md`](AGENTS.md).

## Roadmap

- **v0** (esto): extensión de VS Code, local, dos acciones.
- **Fase 2**: pulido del panel y del resumen.
- **Fase 3**: CLI en Go que comparte el formato de sesión, y sincronización opcional entre máquinas.
