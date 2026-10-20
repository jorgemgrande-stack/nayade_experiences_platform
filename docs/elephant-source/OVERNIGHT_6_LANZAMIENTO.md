# Overnight 6: lanzamiento comercial

Rama de trabajo: `ops/overnight-6-lanzamiento` (desde `integration/elephant-source`). **Sin tocar** Railway `live`, Stripe Live, dominios ni bases persistentes, y sin envíos reales.

## Estado

| Bloque | Estado | Commits / PR |
|---|---|---|
| 1. Integrar #187, #188 y #190 | ✅ Integrados en orden. CI 4/4 verde en cada uno. Local: tipos sin errores, 22 migraciones válidas, 321 pruebas de Stripe/desistimiento/compras y 77 de MySQL en verde | `ce0af62` (#187), `519f703` (#188), `de1564d` (#190) |
| 1b. #186 (documentación legal) | ⏸️ Abierto a propósito: textos marcados **[REVISIÓN JURÍDICA]** y **[DECISIÓN]**, pendientes de tu aprobación | — |
| 2. Comunicaciones | ✅ Canal interno (`CP_ALERT_EMAIL`): incidencias, nuevos clientes, desistimientos y tickets. Tickets al solicitante. Contraseña cambiada (Core). Catálogo completo con el reparto Elephant/Stripe. Matriz generada del código | este PR |
| 3. Proveedor de correo | ✅ Postmark implementado tras el mismo puerto (`MAIL_PROVIDER`), con webhook propio (entregas, rebotes con supresión, quejas y bajas). Sin credenciales: no se envía nada. Ver `CORREO_PROVEEDOR.md` | PR del bloque 3 |
| 4. Checkout | ✅ Autónomos con DNI y empresas con CIF: identificador fiscal fijado en el Customer (Checkout no lo pide). 5 escenarios de punta a punta en `stripeLive` (autónomo, CIF, UE con VIES caído y verificado, territorios no aprobados, particular con desistimiento). Renovación, impago y cancelación: `lifecycle.mysql` (45/45). Pendientes reales en `COMPROBACIONES_APERTURA.md` | PR del bloque 4 |
| 5. Paquete de despliegue | ✅ `DESPLIEGUE_LIVE.md`: commits exactos (Core, CRM `24bb93e` con el #26 integrado y web `42741e2`), puntos de vuelta atrás, orden, variables y reversión. Paquete de migraciones reproducible (`scripts/railway/build-migration-bundle.sh`) **validado en simulación contra `live`**: registro con 0012 y 0013, y CRM de la 0014 a la 0022 | PR del bloque 5; CRM #26 integrado |
| 6. Estabilidad | pendiente | |

## Bloqueos que requieren intervención
- Railway: despliegues pausados (incidencia del proveedor).
- Migraciones `live` (registro 0012 y 0013; CRM de la 0014 a la 0022): requieren tu autorización.
- Fiscal y legal: matriz por país, OSS, emisor de la factura legal (DF-2) y política de reembolso del desistimiento.
