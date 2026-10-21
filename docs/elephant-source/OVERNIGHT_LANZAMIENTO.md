# Overnight integral de lanzamiento: seguimiento

Para reanudar: la última fila terminada y la «Próxima acción». Sin secretos.

| Fecha y hora (UTC) | Fase | Tarea | Estado | Commit / PR | Pruebas | Bloqueo | Próxima acción |
|---|---|---|---|---|---|---|---|
| 20/10 22:52 | 3 | ¿Railway acepta despliegues? | ✅ Sí: `restore-drill list` en `production` desplegado | — | — | — | — |
| 20/10 22:53 | 1 | `586bcb3` frente a `57bc654` | ✅ `586bcb3` = `57bc654` + 2 documentos (mismo código) | — | — | — | Desplegar la cabeza de integración |
| 20/10 22:55 | 4 | Webhook de Live | ✅ 21 eventos, incluidos los 3 añadidos; no se toca | — | Stripe (lectura) | — | — |
| 20/10 22:58 | 1 | PR antiguos | ✅ Cerrados por obsoletos: #94, #95, #96, #97 (contenido ya en integración), #144 (activación ya hecha en live) y #127 (auditoría superada). Integrado #145 (runbook de dominios). Abiertos a propósito: #98 (hacia `main`), #151 y #186 (decisiones fiscales y legales) | `97b59d2` (#145) | — | — | — |
| 20/10 22:57 | 3 | Copia nueva de `live` | ✅ Registro, CRM y recuperación: `ok` | — | — | — | — |
| 20/10 22:59 | 3 | Restauraciones en bases desechables | ✅ Registro: 23 tablas y 641 filas. CRM: 37 tablas y 730 filas. `verification.ok` | — | — | — | — |
| 20/10 23:02 | 3 | **Ensayo de migraciones sobre las copias** | ✅ Registro 0011 → 0013. CRM: 9 aplicadas, 22/22. Bases reales intactas | rama `ops/overnight-7-live` (lanzador con `--database`) | Inventario de solo lectura antes y después | — | **[TÚ]** «autorizo migraciones live» |
| 20/10 23:05 | 4 | Stripe en `live` (solo lectura) | ✅ Clave restringida live, secreto `whsec`, modo live, orquestador y conciliación encendidos; Checkout, autoservicio y política fiscal sin definir | — | — | Registro de España en Stripe Tax | Decisión 2 |
| 20/10 23:09 | 5 | CRM: vista de desistimientos | ✅ | CRM PR #28 | tsc, vitest 99/99, build | — | Integrar #28 con su CI en verde |
| 20/10 23:15 | 2, 4 y 5 | Hoja de decisiones, apertura y supervisión | ✅ `DECISIONES_PROPIETARIO.md`, `APERTURA_COMERCIAL.md`, `DESPLIEGUE_LIVE.md` actualizado | PR de la noche 7 | — | — | — |
| 21/10 01:15 | 3 | Copia, restauración y huellas antes de migrar | ✅ Copia `ok`. Restauraciones verificadas. Paquete idéntico al ensayado | — | Ensayo final sobre las copias | — | — |
| 21/10 01:20 | 3 | **Migraciones en `live`** (autorizadas) | ✅ Registro 0013. Permiso `tenant_usage` del Core. CRM 22/22 | — | Inventario antes y después | — | — |
| 21/10 01:46 | 3 | **Despliegue en `live`** (autorizado): `c6182d4`, `7351b3c` y `42741e2` | ✅ 7 servicios en verde, en el orden validado | — | Salud, 401 sin credencial, firma del webhook, sitio público, catálogo y copia posterior | Conciliación de Stripe (más de 20 tipos) | Integrar #197 y desplegarlo con tu autorización |

## Estado de las fases

| Fase | Estado |
|---|---|
| 1. Plataforma | ✅ Consolidada: plataforma, CRM y web identificados; sin cambios locales sin guardar; PR antiguos resueltos |
| 2. Cierre comercial, fiscal, legal y comunicaciones | ✅ Implementada y probada con simuladores. ⏸️ Decisiones fiscales y legales (`DECISIONES_PROPIETARIO.md`) |
| 3. Railway `live` | ✅ **Migrado y desplegado** (`DESPLIEGUE_LIVE.md` §8). ⏸️ PR #197 y variables del Core y de los desistimientos |
| 4. Apertura controlada | ✅ Preparada (`APERTURA_COMERCIAL.md`). ⏸️ Stripe Tax, textos, correo y dominios |
| 5. Lanzamiento público | ✅ Checklist y supervisión preparados. ⏸️ Depende de la 4 |
