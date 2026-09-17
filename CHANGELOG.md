# Changelog

## 0.1.0

Primera versión.

- `Reentry: Me fui` (`Ctrl+Alt+L`): captura archivos abiertos, archivo activo y línea, rama y archivos modificados de git, últimos comandos de terminal; pide una nota opcional; guarda la sesión como JSON local.
- `Reentry: Volví` (`Ctrl+Alt+R`): panel al lado del editor con la última sesión.
- `Reentry: Historial`: últimas 20 sesiones.
- `Reentry: Abrir carpeta de datos`.
- Sesión automática tras 20 minutos de inactividad (`reentry.idleMinutes`, mínimo 5).
- Resumen con IA opcional: OpenAI o Anthropic con clave propia (guardada en secretos de VS Code), u Ollama local. Apagado por defecto.
- Telemetría opt-in: solo la cantidad semanal de usos de Volví. Apagada por defecto.
