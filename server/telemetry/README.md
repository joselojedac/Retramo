# reentry-telemetry

Servidor de la telemetría opt-in de Reentry (AGENTS.md §10). Netlify Functions + Netlify Blobs.

- `POST /ping`: acepta exactamente `{ installId, returnCount, version }` y rechaza cualquier otro campo. Guarda `returnCount` y `version` bajo `<semana ISO>/<installId>`. No guarda IP, user agent ni nada más.
- `GET /stats` con `Authorization: Bearer <STATS_TOKEN>`: por semana, instalaciones que reportaron, total de "Volví", promedio y versiones.

`STATS_TOKEN` es una variable de entorno del proyecto `reentry-telemetry` en Netlify.

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" https://reentry-telemetry.netlify.app/stats
```

Deploy: `npx netlify deploy --prod` desde esta carpeta (o conectar el repo en Netlify con base directory `server/telemetry`).
