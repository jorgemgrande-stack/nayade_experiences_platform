# Overnight 6: lanzamiento comercial (20 y 21/10/2026)

**Resultado:** la **fase 2** del roadmap (cierre comercial, legal, fiscal y comunicaciones) está terminada en todo lo que no depende de decisiones tuyas. La **fase 3** (Railway `live`) está preparada y validada en simulación: queda a la espera de que Railway reanude los despliegues y de tu autorización.

**Sin tocar:** Railway `live` (solo lecturas y simulaciones), Stripe Live, dominios, bases persistentes, envíos reales y `main`.

## Integrado en `integration/elephant-source`

| PR | Contenido | Commit |
|---|---|---|
| #187 | Elegibilidad por tipo de cliente, país y territorio (CRM 0020) | `ce0af62` |
| #188 | VIES (CRM 0021) | `519f703` |
| #190 | Desistimiento de consumidores (CRM 0022) | `de1564d` |
| #191 | Comunicaciones: avisos al equipo, tickets, contraseña cambiada y catálogo completo | `9b88053` |
| #192 | Postmark como proveedor alternativo | `5c224cf` |
| #194 | NIF fijado en Stripe, cierre del Checkout y paquete de despliegue | **`57bc654`** (commit a desplegar) |
| CRM #26 | Stripe live en el CRM y sincronización del catálogo | CRM `24bb93e` |

**Cerrados sin fusionar:** #189 y #193, sustituidos por #190 y #194. Una clave de prueba disparaba gitleaks en el historial y se rehízo la rama sin reescribir la historia publicada.

**Abierto a propósito:** #186 (documentación y borradores legales), pendiente de aprobación jurídica y tuya.

## Pruebas

| Ámbito | Resultado |
|---|---|
| CI de Linux (4 comprobaciones) | En verde en todos los PR integrados |
| Batería del servidor (local) | **2.375 en verde**. 3 archivos fallan solo en Windows al importar scripts `.mjs`; la CI de Linux los pasa |
| Suites MySQL (local) | **374 en verde**. 5 fallan solo en local: la URL de pruebas apunta a la base del sistema, donde MySQL no permite triggers, y `fileStorage` falla igual en el commit anterior a la noche. En la CI están en verde |
| Escenarios del lanzamiento | Autónomo, CIF, UE con VIES caído y verificado, territorios no aprobados, particular con desistimiento, renovación, impago, cancelación, webhooks y aislamiento (ver `COMPROBACIONES_APERTURA.md`) |
| Migraciones | Simulación contra `live` con `57bc654`: registro 0012 y 0013; CRM de la 0014 a la 0022 |

## Entregables

- `COMUNICACIONES_LANZAMIENTO.md`: matriz generada del catálogo (Elephant o Stripe, disparador, destinatario, estado).
- `CORREO_PROVEEDOR.md`: Postmark (variables, DNS y webhook).
- `COMPROBACIONES_APERTURA.md`: simulado frente a pendiente con servicios reales.
- `DESPLIEGUE_LIVE.md`: paquete de despliegue (commits, orden, variables, reversión).
- `DESISTIMIENTO.md` y `MATRIZ_FISCAL_INTERNACIONAL.md`.

## Bloqueos que requieren tu intervención

1. **Railway:** despliegues pausados (incidencia del proveedor).
2. **Autorizaciones:** migraciones de `live` y despliegue (`DESPLIEGUE_LIVE.md`, §3 a §5).
3. **Fiscal:** filas de la matriz por país, OSS, emisor de la factura legal (DF-2), registro de España en Stripe Tax.
4. **Legal:** PR #186, textos B2C, política de reembolso del desistimiento y web con páginas legales (`5ea5be6`).
5. **Correo:** cuenta de Postmark (o incidencia de Brevo), DNS y autorización de envíos.
6. **Stripe:** clave `rk_test_` del sandbox para las comprobaciones reales; eventos del webhook de Live; métodos de pago.
7. **Dominios:** traslado de `production` a `live`.
