# Changelog

## 0.1.0

Primera versión.

- `Retramo: Me fui` (`Ctrl+Alt+L`): captura archivos abiertos, archivo activo y línea, rama y archivos modificados de git, últimos comandos de terminal; pide una nota opcional; guarda la sesión como JSON local.
- `Retramo: Volví` (`Ctrl+Alt+R`): panel al lado del editor con la última sesión.
- `Retramo: Historial`: últimas 20 sesiones.
- `Retramo: Abrir carpeta de datos`.
- Sesión automática tras 20 minutos de inactividad (`retramo.idleMinutes`, mínimo 5).
- Resumen con IA opcional: OpenAI o Anthropic con clave propia (guardada en secretos de VS Code), u Ollama local. Apagado por defecto.
- Telemetría opt-in: solo la cantidad semanal de usos de Volví. Apagada por defecto.
