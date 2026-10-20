# Overnight 6: lanzamiento comercial

Rama de trabajo: `ops/overnight-6-lanzamiento` (desde `integration/elephant-source`). **Sin tocar** Railway `live`, Stripe Live, dominios ni bases persistentes, y sin envíos reales.

## Estado

| Bloque | Estado | Commits / PR |
|---|---|---|
| 1. Integrar #187, #188 y #190 | ✅ Integrados en orden. CI 4/4 verde en cada uno. Local: tipos sin errores, 22 migraciones válidas, 321 pruebas de Stripe/desistimiento/compras y 77 de MySQL en verde | `ce0af62` (#187), `519f703` (#188), `de1564d` (#190) |
| 1b. #186 (documentación legal) | ⏸️ Abierto a propósito: textos marcados **[REVISIÓN JURÍDICA]** y **[DECISIÓN]**, pendientes de tu aprobación | — |
| 2. Comunicaciones | ✅ Canal interno (`CP_ALERT_EMAIL`): incidencias, nuevos clientes, desistimientos y tickets. Tickets al solicitante. Contraseña cambiada (Core). Catálogo completo con el reparto Elephant/Stripe. Matriz generada del código | este PR |
| 3. Proveedor de correo | ✅ Postmark implementado tras el mismo puerto (`MAIL_PROVIDER`), con webhook propio (entregas, rebotes con supresión, quejas y bajas). Sin credenciales: no se envía nada. Ver `CORREO_PROVEEDOR.md` | PR del bloque 3 |
| 4. Checkout | pendiente | |
| 5. Paquete de despliegue | pendiente | |
| 6. Estabilidad | pendiente | |

## Bloqueos que requieren intervención
- Railway: despliegues pausados (incidencia del proveedor).
- Migraciones `live` (registro 0012 y 0013; CRM de la 0014 a la 0022): requieren tu autorización.
- Fiscal y legal: matriz por país, OSS, emisor de la factura legal (DF-2) y política de reembolso del desistimiento.
