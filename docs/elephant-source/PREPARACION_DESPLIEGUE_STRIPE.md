# Preparación del despliegue de Stripe Billing y del onboarding (18/10/2026)

**Objetivo inmediato:** una contratación de prueba completa en el **sandbox real** de Stripe: un pago en la web o desde el CRM termina en una empresa Elephant Core aprovisionada, con su suscripción y sus licencias correctas.

**Estado:** el código está integrado en las ramas autorizadas. **Nada está desplegado ni migrado en Railway.** En Stripe solo existen, en el sandbox, el catálogo y la configuración del Portal (§4, 18/10/2026). Todo lo de este documento está **preparado, pendiente de autorización**.

## 1. Integración realizada

| Repo | PR | Rama destino | Estado | Pruebas |
|---|---|---|---|---|
| Core | #128 Stripe, Fases A, B y C | `integration/elephant-source` | Fusionada (`3d4577d`) | Fusión conjunta con #129 en local: 1287/1290 unitarias (3 sensibles a la carga; pasan aisladas) y 310/311 MySQL (1 tiempo de espera; pasa aislada) |
| Core | #129 Prueba gratuita | `integration/elephant-source` | Fusionada (`3d4577d`) | ídem |
| Core | #130 Preparación beta (este documento) | `integration/elephant-source` | Abierta | Ver §2 |
| CRM | #21 Pasarela y webhook | `integration/elephant-source` | Fusionada (`f873446`) | CI en verde; Caddy local 16/16; el Caddyfile fusionado es idéntico al de la PR |
| CRM | #22 Pantallas comerciales | `integration/elephant-source` | Fusionada (`f873446`), con correcciones (`932b645`) | CI en verde; 93/93; tipos y compilación |
| Web | #9 Contratación y retorno | `feat/elephant-web-portfolio` | Fusionada (`79a3b71`) | CI en verde; 84/84 |

**`main` sin cambios:** Core `baeca78`, CRM `62183b1` y Web `5aa098d`.

**Ninguna fusión despliega nada:**
- Ningún servicio del proyecto «Elephant Source» está conectado a GitHub (se despliegan a mano con `railway up`).
- Náyade solo despliega desde `main` (comprobado en Railway).
- La CI del Core solo ejecuta pruebas.
- Fuera del perímetro de Elephant, #128 solo cambia la CI y añade la dependencia `stripe` 23.0.0. El servidor de Náyade no la importa.

### Revisión cruzada (contratos entre las cinco PR)

| Contrato | Resultado |
|---|---|
| Web ↔ estado público del Core | Ruta, parámetro, forma de la respuesta, estados y códigos correctos. El documento de la web se ha alineado con el código real (`invalid_session_id`) |
| CRM ↔ rutas de operador | Todas existen. **Corregido:** «Releer la sesión» exige `orders:write`. Cancelar y Rechazar aparecen como no disponibles en pedidos cobrados en Stripe |
| Pasarela del CRM ↔ webhook | Ruta, cuerpo original, 1 MB y `Stripe-Signature` correctos. La pasarela sobrescribe `X-Forwarded-For`: el `CP_TRUST_PROXY=2` que hay en Railway da la IP real |
| #128 ↔ #129 | Sin ficheros en común; sin conflicto de migraciones |
| **Corregido en #130** | Las alertas `stripe.*` no tenían regla y **nunca abrían incidencia** |

## 2. Cambios de esta jornada (Core #130, CRM #22)

| Cambio | Detalle | Pruebas |
|---|---|---|
| `TrialScheduler` conectado | Apagado salvo `CP_TRIALS_SCHEDULER_ENABLED=1`. Una réplica por tick (`GET_LOCK`); vence, avisa y anula solicitudes sin verificar. Nunca suspende, cancela ni borra. `CP_TRIAL_BLOCKED_DOMAINS` conectada | Las de #129: exclusión entre réplicas en memoria y MySQL, vencimiento a solo lectura, reintentos de avisos y conversión sin duplicados |
| Alertas de Stripe | `STRIPE_FAILURE_RULES` en el arranque; una prueba exige regla para cada tipo usado | `alerts.test.ts` |
| **B2** sesión huérfana | Una respuesta repetida e inservible de Stripe se registra cerrada y se usa la clave siguiente. Si estaba pagada, queda completada | `checkout.test.ts` |
| **B9** entornos | `CP_STRIPE_NAMESPACE`, o derivado del proyecto y el entorno de Railway: claves `es-<ns>-…` y `metadata.es_env`. Cada entorno ignora los objetos de otro | `config`, `checkout` y `lifecycle` |
| **B4** reembolsos y disputas | Se relee el cargo y se guarda en `stripe_charge_adjustments`. Un reembolso total o una disputa perdida del periodo vigente dejan el pedido **suspendido** aunque Stripe siga «active». No se reactiva solo hasta un pago nuevo, una disputa ganada o un operador con motivo. Un reembolso parcial o una disputa abierta solo avisan | `lifecycle` (6 escenarios), `store.mysql` y HTTP |
| Purga de eventos | Diaria y por lotes; solo procesados e ignorados de más de `CP_STRIPE_EVENTS_RETENTION_DAYS` (180, mínimo 35). Deja constancia en `stripe_sync_state.events_purge` | `reconcile.test.ts`, `store.mysql` |
| Importes coherentes | El neto del presupuesto debe ser el precio de Stripe, o no se abre Checkout. El primer cobro debe ser ese neto, o no confirma. Tratamiento único `test_net_no_tax` (sin IVA, sin factura fiscal), visible en Checkout y en el CRM | `checkout`, `lifecycle` y HTTP |
| Estado público | Como mucho una relectura en Stripe cada 30 s por sesión; 404 propio bajo `/public/checkout` | `status.test.ts`, HTTP |
| Punta a punta por HTTP | Con la aplicación real del plano de control y la firma real del webhook (ver §8) | `controlPlane.stripeBeta.test.ts` (5) |

### Segunda revisión de seguridad (18/10/2026, independiente, solo lectura) y correcciones

Sin hallazgos críticos. Todo lo alto y medio está corregido con prueba de regresión, y las pruebas de ALTO-1 y ALTO-2 se han validado rompiendo el código a propósito.

| Hallazgo | Corrección |
|---|---|
| **ALTO-1** La retención se perdía al crear Stripe la factura siguiente, sin cobrarla | La retención se compara con la **última factura de periodo pagada y registrada** (alta o renovación), no con `latest_invoice` |
| **ALTO-2** Una lectura antigua del cargo, procesada a la vez que otra, podía levantar la retención de una disputa perdida | El cargo se relee y se guarda **dentro** del bloqueo del pedido. Una disputa `lost` no retrocede nunca |
| **MEDIO-1** `/orders/review` o `/advance` podían activar un pedido retenido | El orquestador recibe `coverageHeld` y no da de alta ni activa nada con una retención vigente |
| **MEDIO-2** B2 no funcionaba con la idempotencia real de Stripe (otros parámetros con la misma clave dan `idempotency_error`) | Antes de crear una sesión se adoptan las huérfanas del pedido (`checkout.sessions.list` del cliente): se cierran, se registran, y una pagada queda completada. Con `idempotency_error` se pasa a la clave siguiente. El doble de pruebas imita ahora la idempotencia estricta |
| **MEDIO-3** El presupuesto se comparaba con el catálogo web, no con el Price real | Se relee el Price en Stripe antes de abrir Checkout. La factura se compara por **subtotal** (antes de impuestos y saldo a favor) |
| **MEDIO-4** Un cambio del prefijo de entorno dejaba sin aviso los pedidos existentes | El prefijo se guarda en el primer arranque; si cambia, Stripe no se monta (`reason: namespace_changed`). Un objeto de otro entorno que apunte a un pedido nuestro abre la incidencia `stripe.namespace_mismatch` |
| BAJO-1 Un prorrateo levantaba la retención | Solo la levanta una **renovación** pagada |
| BAJO-3 Ruta de resolución | Motivo de 200 caracteres como máximo; 409 si ya se resolvió; si el pedido está ocupado, `pending: true` |
| BAJO-4 Texto de la alerta | Neutro («revisar el pedido») |
| BAJO-5 Prefijo `local` compartido entre dos desarrolladores con el mismo sandbox | Aceptado: solo afecta a desarrollo, y la comprobación del cliente lo detiene. Basta con usar `CP_STRIPE_NAMESPACE` |

**Resultado en local** de la CI completa de la rama de #130, tras las correcciones de la revisión:
- Unitarias: **1307/1307**. Solo falla el fichero `tscBaseline`, que falla en Windows también en la rama base y pasa en la CI.
- MySQL: **323/323**.
- Compilación del plano de control: correcta.
- Errores de tipos: los mismos 10 de Náyade, ya contemplados en la línea base.

## 3. Bloqueos reales

| # | Bloqueo | Quién lo desbloquea |
|---|---|---|
| 1 | ~~**Independencia del sandbox.**~~ **Resuelto el 18/10/2026:** comprobación visual del propietario (sandbox `acct_1URULO5wMYhQ9O0d`; cuenta real `acct_1URULE9RzfmCBuai`, sin ninguna escritura) y MCP reconectado, con una sola cuenta accesible y `livemode=false`. Catálogo y Portal creados (§4) | — |
| 2 | Migración `0012`, claves, despliegues y destino del webhook | Tu autorización específica (§5) |
| 3 | **Autoservicio:** la web exige que un producto «Disponible» sea técnicamente «available». Essential y Business están en «partial» y «bajo solicitud» | Tu decisión de producto: declararlos técnicamente disponibles |
| 4 | Condiciones legales sin publicar (`CP_TERMS_VERSION`). Sin ellas, la contratación pública responde 503 `terms_unpublished` (probado) | Legal |
| 5 | Política fiscal (IVA) y emisor de facturas. Hasta entonces, solo el tratamiento de pruebas `test_net_no_tax` | Fiscal |
| 6 | Cambios de plan desde el Portal: chocan con la aprobación de «bajo solicitud» | Tu decisión |
| 7 | La web pide la autenticación básica al volver de Stripe (riesgo C6 de la web) | Aceptable en la prueba: tú conoces la credencial |

## 4. Operaciones en Stripe (sandbox; las ejecuta una persona o el MCP con tu confirmación)

1. **Comprobación previa (obligatoria):**
   - `get_stripe_account_info`: `livemode=false` y la cuenta esperada;
   - comprobación visual en el Dashboard de que es un sandbox;
   - la lista de Products y Prices está vacía.
2. **Catálogo:** las 6 operaciones exactas de `STRIPE_FASE_B.md` §2 (2 Products y 4 Prices, EUR, `tax_behavior: exclusive`, `lookup_key` `es:…:v<id>`).
3. **Clave restringida `rk_test_…`** para `controlplane`, con los permisos de `STRIPE_FASE_A.md` §5. **Novedad:** añadir `charge_read` (cargos y reembolsos) y `dispute_read` (disputas). Los pagos de factura ya los cubre `invoice_read`, La lista y la relectura de sesiones (`checkout_session_read`) quedan dentro del nivel «Escritura» de Checkout Sessions: hay que **comprobarlo al crear la clave** (en el paso 7, con un `GET /v1/checkout/sessions?customer=…` que debe responder 200).
4. **Destino del webhook** (Workbench del sandbox):
   - URL `https://elephant-source-crm.up.railway.app/cp/v1/stripe/webhook`;
   - carga snapshot, API `2026-09-30.endive`;
   - los 18 eventos de `HANDLED_EVENTS`: los 12 de la Fase C más `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` y `charge.dispute.funds_reinstated`.
5. **Revenue recovery:** tras el último reintento, marcar la suscripción como `unpaid`.
6. **Customer Portal** (paso 11 de §5):
   - activar `invoice_history`, `payment_method_update` y `subscription_cancel` (`mode: at_period_end`, con `cancellation_reason`);
   - **sin** `subscription_update`;
   - `business_profile` con las URL de condiciones y privacidad.

### Ejecutado en el sandbox (18/10/2026, MCP oficial)

| Paso | Estado | Resultado |
|---|---|---|
| 1. Comprobación previa | Hecho | Una sola cuenta accesible: `acct_1URULO5wMYhQ9O0d`, `livemode=false`. Products, Prices y configuraciones del Portal: 0 |
| 2. Catálogo | **Hecho** | 2 Products y 4 Prices; identificadores en `STRIPE_FASE_B.md` §2. Una segunda lectura confirma que no hay duplicados |
| 3. Clave restringida | Pendiente | La crea el propietario |
| 4. Destino del webhook | Pendiente | Tras desplegar la pasarela (§5, paso 4) |
| 5. Revenue recovery | Pendiente | Ajuste del Dashboard |
| 6. Customer Portal | **Hecho, parcial** | `bpc_1URoSX5wMYhQ9O0dlC4viuZQ`, «Elephant Source · beta (sandbox)», `is_default: true` |

**Configuración del Portal creada:**
- `invoice_history`: activado.
- `payment_method_update`: activado.
- `subscription_cancel`: activado, `mode: at_period_end`, `proration_behavior: none`, `cancellation_reason` con las 8 opciones de Stripe.
- `subscription_update`: **desactivado** (bloqueo 6).
- `customer_update`: **desactivado** (dirección, NIF, nombre y correo; bloqueo 5).
- `subscription_pause`: desactivado.
- `login_page`: desactivada. Las sesiones solo se crean en el servidor.
- `default_return_url`: sin fijar. Cada sesión lleva `CP_STRIPE_PORTAL_RETURN_URL`.
- `business_profile`: **sin URL**, pendiente de los textos legales (bloqueo 4).

**No se ha hecho:** activar Stripe Tax (sigue `pending`, sin `head_office`), crear Customers, suscripciones o cobros, ni ninguna escritura en la cuenta real.

## 5. Secuencia de despliegue verificable (NO ejecutada)

Cada paso tiene un criterio de aceptación. **Si un paso no lo cumple, se detiene la secuencia y se revierte ese paso**; nunca se encadena un arreglo. Todos los despliegues salen del commit verificado de `integration/elephant-source`, con `railway up` desde su worktree.

| # | Paso | Cómo | Aceptación | Reversión |
|---|---|---|---|---|
| 1 | **Confirmar copias** | Último registro OK de `backup-job` (cifrado y verificado) en las últimas 24 h; si no, `backup-job` a mano y esperar al OK. Restauración de ensayo con `restore-drill` si la copia tiene más de 24 h | Copia de `es_crm` correcta, fechada hoy | — |
| 2 | **Migración `0012`** en `es_crm` | Abrir un proxy TCP temporal → `MIGRATE_DATABASE_URL=… pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations` (prueba en seco) → `--apply --confirm-database es_crm --allow-remote` → `status` → borrar el proxy | El dry-run muestra solo la `0012`; `status` la da por aplicada; 7 tablas `stripe_*` | `down --steps 1 --apply --confirm-database es_crm --allow-remote`: solo borra la correspondencia local; Stripe conserva sus objetos |
| 3 | **Claves restringidas** | Tú: `CP_STRIPE_MODE=test`, `CP_STRIPE_API_KEY` (`rk_test_…`) y `CP_STRIPE_NAMESPACE=beta` en `controlplane`. El resto, en §6 | Variables presentes; ningún `*_live_*` | Quitar las variables |
| 4 | **Pasarela del CRM** | Desplegar el servicio `crm` con `STRIPE_WEBHOOK_PUBLIC=1` | `GET /__gateway/health` 200. Un `POST` sin `Stripe-Signature` a la ruta del webhook pide autenticación básica. El resto de rutas no cambia | `STRIPE_WEBHOOK_PUBLIC=0` (o volver al despliegue anterior) |
| 5 | **Webhook** | Crear el destino (§4.4); tú pones el `whsec_` en `CP_STRIPE_WEBHOOK_SECRET` | Destino activo, con 18 eventos y la versión fijada | Desactivar el destino |
| 6 | **Controlplane** | `railway up --service controlplane` con todas las banderas de Stripe **apagadas** salvo la del paso 3 | Arranque limpio; `{"ctx":"Stripe","mounted":true,...}` (si sale `false`, el `reason` dice qué falta); `{"ctx":"Trials","event":"scheduler","enabled":false}`; `/healthz` y `/readyz` 200; sin errores nuevos en el log | Volver al despliegue anterior en Railway (las tablas nuevas no molestan) |
| 7 | **Catálogo** | `GET /cp/v1/stripe/status`, `GET /stripe/catalog/plan` (vacío tras §4.2) y `POST /stripe/catalog/sync` | 4 precios enlazados; `namespace: beta`; con la clave, `GET /v1/balance` da 403 (clave restringida, `STRIPE_FASE_B.md` §7) | Nada que revertir (solo lectura en Stripe) |
| 8 | **Checkout de prueba** | `CP_STRIPE_CHECKOUT_ENABLED=1`, más las URL de vuelta y `CP_PUBLIC_CHECKOUT_ENABLED=1`. Empresa **demo** nueva en el CRM → pedido Essential mensual → aceptación → «Generar enlace de pago» → pagar con la tarjeta 4242 | El CRM muestra «Stripe cobrará 29,00 € sin IVA». En Stripe: sesión `complete`, suscripción `active`, factura `paid` de 29,00 € | `CP_STRIPE_CHECKOUT_ENABLED=0` |
| 9 | **Pedido, empresa y licencias** | Workbench → entregas del webhook; `GET /orders/:id`; registro de empresas; licencias | Webhook 200; pedido `active`; un pago `stripe_test` de 2900; empresa aprovisionada y en el registro; suscripción interna `active`; licencias de Essential `active`; la página de estado da «lista» con su dirección | Cancelar la suscripción en el Dashboard del sandbox → solo lectura (nada se borra) |
| 10 | **Conciliación** | `CP_STRIPE_WORKER_ENABLED=1` | En 15 min, `stripe_sync_state.events_cursor` con `complete: true`; sin alertas `rate.stripe.*`; prueba: reenviar un evento desde Workbench → `duplicate` | `CP_STRIPE_WORKER_ENABLED=0` |
| 11 | **Customer Portal** | Configuración (§4.6) y sesión del Portal desde el Dashboard del sandbox para el cliente de la empresa demo: cambiar la tarjeta y cancelar a fin de periodo | Cancelar → pedido `cancel_scheduled`, con las licencias activas hasta el fin; deshacer → `active`. Historial de facturas visible | Desactivar el Portal |

**Comprobaciones de salud tras cada despliegue:**
- `/healthz` y `/readyz` de `controlplane` y `core`, y `/__gateway/health` de las pasarelas;
- en los logs, el arranque sin errores nuevos;
- `GET /cp/v1/stripe/events`: sin `failed`;
- incidencias `rate.stripe.*` en el panel de alertas del CRM.

**Lo que NO se activa en esta secuencia:**
- `CP_PUBLIC_SELF_SERVICE_ENABLED` (bloqueos 3 y 4);
- `CP_TRIALS_SCHEDULER_ENABLED` (se activa en un paso aparte, tras el 6);
- `MAIL_MODE`, que sigue en `off`;
- `PUBLIC_CHECKOUT_ENABLED` de la web (solo para la prueba del paso 8, si quieres probar el retorno de la web).

## 6. Variables de Railway

| Servicio | Variable | Valor | Quién |
|---|---|---|---|
| `controlplane` | `CP_STRIPE_MODE` | `test` | Tú |
| `controlplane` | `CP_STRIPE_API_KEY` | `rk_test_…` (secreto) | **Tú** |
| `controlplane` | `CP_STRIPE_WEBHOOK_SECRET` | `whsec_…` (secreto) | **Tú** |
| `controlplane` | `CP_STRIPE_NAMESPACE` | `beta` | Tú |
| `controlplane` | `CP_TRUST_PROXY` | **ya está** (`2`, fijado al corregir la IP real del cliente). Imprescindible para montar Stripe en producción. No cambiar | — |
| `controlplane` | `CP_ORCHESTRATOR_ENABLED` | **ya está** (`1`). Stripe se monta sobre el orquestador | — |
| `controlplane` | `MAIL_MODE` | **ya está** (`off`). No cambiar | — |
| `controlplane` | `CP_STRIPE_SUCCESS_URL` | `https://elephant-source-web.up.railway.app/contratacion/estado` | Tú |
| `controlplane` | `CP_STRIPE_CANCEL_URL` | `https://elephant-source-web.up.railway.app/contratacion/cancelada` | Tú |
| `controlplane` | `CP_STRIPE_PORTAL_RETURN_URL` | URL https sin parámetros del panel (pendiente del dominio por empresa) | Tú |
| `controlplane` | `CP_STRIPE_CHECKOUT_ENABLED` | `1` en el paso 8 | Tú |
| `controlplane` | `CP_PUBLIC_CHECKOUT_ENABLED` | `1` en el paso 8 | Tú |
| `controlplane` | `CP_STRIPE_WORKER_ENABLED` | `1` en el paso 10 | Tú |
| `controlplane` | `CP_STRIPE_EVENTS_RETENTION_DAYS` | sin definir (180) | — |
| `controlplane` | `CP_TRIALS_SCHEDULER_ENABLED` | sin definir; `1` en un paso aparte | Tú |
| `controlplane` | `CP_PUBLIC_SELF_SERVICE_ENABLED`, `CP_TERMS_VERSION` | sin definir | — |
| `controlplane` | `CP_STRIPE_BILLING_MODE` | sin definir (`classic`); `flexible` solo por decisión expresa (irreversible por suscripción) | Tú |
| `controlplane` | `CP_COMMERCE_PURCHASES_ENABLED` | sin definir (compra de módulos apagada); requiere CRM 0018 y productos `available` | Tú |
| `controlplane` | `CP_COMMERCE_INTERNAL_TENANTS` | sin definir (ninguna); ids de las empresas FICTICIAS de prueba que pueden comprar productos internos (`catalog.internalOnly`). Nunca una empresa real | Tú |
| `controlplane` | `CP_NOTIFICATIONS_SINCE` | sin definir (no se despacha nada); fecha ISO desde la que avisar, nunca anterior a la activación | Tú |
| `app` (Core) | `CP_COMMERCE_URL`, `CP_COMMERCE_TOKEN` | sin definir (compra no disponible); token de servicio con solo `commerce:purchase` | Tú |
| `app` (Core) | `DATA_EXPORT_MAX_MB` | sin definir (1024) | — |
| `crm` (pasarela) | `STRIPE_WEBHOOK_PUBLIC` | `1` en el paso 4 | Tú |
| `crm` (pasarela) | `STRIPE_WEBHOOK_IPS` | opcional (la seguridad la da la firma) | — |
| `web` | `PUBLIC_CHECKOUT_ENABLED` | sin definir (apagada) | — |

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El sandbox resultara ser la cuenta real | Nada se escribe sin tu comprobación; el código rechaza cualquier `*_live_*` y los objetos `livemode=true` |
| Primer despliegue de `controlplane` con código nuevo | Banderas apagadas; reversión al despliegue anterior; las tablas nuevas no afectan a lo existente |
| Importe con IVA en el presupuesto frente a cobro neto | Tratamiento único `test_net_no_tax`; bloqueos en el Checkout y en la confirmación; aviso en Stripe y en el CRM |
| Retención por reembolso que nadie revisa | Incidencia `rate.stripe.coverage_lost`; `GET /stripe/adjustments`; resolución con motivo |
| Webhook público | Excepción solo para `POST` con JSON y firma; firma real verificada; rechazo de live; límite por IP |
| Intervención manual en Stripe (catálogo, Portal) | Operaciones exactas e idempotentes (`planCatalogWrites`); `catalog/sync` comprueba importes |
| Sin pruebas automáticas contra el sandbox | La prueba controlada de los pasos 8 a 11; Test Clocks en la Fase F con otro sandbox |

## 8. Qué está probado y cómo

- **Con dobles de Stripe y MySQL 8.4 real:** el ciclo de vida completo (28 escenarios), el almacén, la migración, la conciliación y la purga.
- **Por HTTP, con la aplicación real del plano de control:** el alta asistida hasta «lista», la conversión de una prueba, el reembolso con su resolución y la contratación pública cerrada. Stripe es un doble, pero la firma del webhook usa la **criptografía real** del SDK.
- **Contra el sandbox real de Stripe: nada todavía.** Ningún componente de Stripe está operativo en producción.
