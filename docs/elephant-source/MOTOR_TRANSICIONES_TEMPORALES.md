# Motor de transiciones temporales

Segundo PR del roadmap de trazabilidad (`ROADMAP_TRAZABILIDAD_COMERCIAL.md`, sección 9, PR 6).

| Pieza | Dónde está |
|---|---|
| Código | `server/lifecycle/` |
| Plan de solo lectura | `GET /cp/v1/lifecycle/plan` |

Este PR no fusiona, no despliega y no cambia nada en ningún entorno por sí mismo:
- la tarea periódica está **apagada** por defecto;
- con ella encendida, el modo por defecto es **plan**: calcula y registra, sin aplicar.

## 1. Problema que resuelve

Hasta ahora nada ocurre solo con el paso del tiempo, salvo la tarea de pruebas (también apagada):
- renovaciones sin Stripe;
- recibos vencidos;
- fin de la gracia y suspensión;
- fin de una cancelación programada;
- módulos con fecha de baja.

Todo eso dependía de que un operador llamara a `POST /orders/review`. El motor programa esa revisión y la completa, con plan previo, bloqueo entre réplicas y modo de simulación.

## 2. Qué hace

`plan(now)` es de solo lectura. `run(now)` aplica, en modo `apply`, **por los caminos que ya existen** y con sus mismas garantías (versión esperada, una transición por estado, historial):

| Acción | Cuándo | Ejecuta |
|---|---|---|
| `renew` | El periodo de la suscripción interna terminó | Motor → `orchestrator.review` → `renew` |
| `end_subscription` | Terminó un periodo con cancelación programada | Motor → `review` → `renew` (cancelación efectiva y licencias canceladas) |
| `mark_past_due` | Recibo de renovación vencido sin pagar | Motor → `review` (activo → impago, gracia de 7 días) |
| `suspend` | Gracia agotada, en un pedido **no** cobrado en Stripe | Motor → `review` (suspendido; licencias suspendidas, datos intactos) |
| `licence_sync` | Partidas que empiezan o terminan por fecha | Motor → `licensing.apply`. Solo bajas, altas nuevas o cambios de fecha |
| `licence_drift` | Diferencia que reactivaría algo suspendido, en solo lectura o cancelado | **Operador**: no se aplica |
| `dunning_notice` | Días 0, 3 y 6 tras el impago (D-15 propuesto) | **Despachador de notificaciones** (PR futuro): no se envía nada |
| `stripe_dunning` | Gracia agotada en un pedido cobrado en Stripe | **Stripe**: sus reintentos deciden la suspensión, que llega por webhook |
| `trial_notice` | 7, 3 y 1 días antes del fin de la prueba (D-16 propuesto) | **Despachador** (PR futuro) |
| `trial_expire` | Prueba activa con el plazo vencido | **Tarea de pruebas** existente (`CP_TRIALS_SCHEDULER_ENABLED`) |
| `retention_review` | 30 días tras el fin de una prueba o de una suscripción (D-17 propuesto) | **Operador**. Nada se archiva ni se borra |

En los avisos, el plan solo incluye el **último** umbral alcanzado (el aviso que toca ahora), no todos.

**Garantías:**
- **Idempotencia:** repetir un tick no repite transiciones (probado: dos ticks más tras la suspensión no añaden eventos).
- **Bloqueo entre réplicas:** `GET_LOCK('elephant_lifecycle_engine')`. Si otra réplica lo tiene, el tick no hace nada.
- **Una retención por reembolso o disputa** no se toca: sus licencias quedan como las dejó el procesador de Stripe.
- **Sin conversión automática** de la prueba a pago (D-16).
- **Sin borrado** de ningún dato (D-17).

## 3. Configuración (valores provisionales, no definitivos)

| Variable | Por defecto | Efecto |
|---|---|---|
| `CP_LIFECYCLE_SCHEDULER_ENABLED` | apagada | `1` monta la tarea periódica |
| `CP_LIFECYCLE_MODE` | `plan` | `apply` aplica |
| `CP_LIFECYCLE_LIVE_APPLY` | — | En live (`CP_STRIPE_MODE=live`), `apply` exige además `1`; si falta, el modo efectivo es `plan` (`live_apply_not_authorized`) |
| `CP_LIFECYCLE_INTERVAL_MS` | 15 min | Entre 1 min y 24 h |
| `CP_LIFECYCLE_DUNNING_DAYS` | `0,3,6` | D-15 propuesto |
| `CP_LIFECYCLE_TRIAL_NOTICE_DAYS` | `7,3,1` | D-16 propuesto |
| `CP_LIFECYCLE_RETENTION_DAYS` | `30` | D-17 propuesto, pendiente de revisión legal |

La gracia tras el impago es la del orquestador (7 días, D-15 propuesto), la misma que ya aplica.

Al arrancar, el log `ctx="Lifecycle"` indica `mounted`, `enabled`, `mode`, `reason` e `intervalMs`.

## 4. Puesta en marcha propuesta (requiere autorización)

1. **Integración:** encender la tarea en modo `plan` y revisar `GET /lifecycle/plan` y los logs `Lifecycle tick` durante unos días.
2. **Integración:** pasar a `apply`.
3. **Live:** `plan` primero. `apply` solo con `CP_LIFECYCLE_LIVE_APPLY=1` y la aprobación del propietario.

## 5. Relación con los demás PR

- **Registro de eventos comerciales** (PR #163, `feat/registro-eventos-comerciales`): las transiciones que aplica el motor pasan por los almacenes, así que, con los dos fusionados, quedan registradas sin código adicional. Los dos PR son independientes entre sí.
- **Despachador de notificaciones:** consumirá `dunning_notice` y `trial_notice` (o los eventos equivalentes) para encolar en la cola de correo existente con `MAIL_MODE` controlado.
- **Planificador de pruebas:** este motor no lo sustituye. Para las pruebas solo planifica: el vencimiento lo hace la tarea de pruebas existente. Encender los dos no duplica nada.

## 6. Planificador de pruebas en production: cuándo y cómo activarlo con seguridad

`CP_TRIALS_SCHEDULER_ENABLED` está apagado en production y **sigue apagado** hasta que el propietario lo autorice.

### Datos reales (lectura del 19/10/2026, solo `SELECT`)

| Prueba | Tenant | Estado | Fin (UTC) |
|---|---|---|---|
| #5 | t5-skibox (piloto) | `active` | **03/11/2026 13:50:33** (inicio 19/10 13:50:33; 15 días; sin ampliaciones) |
| #2 | t2-empresa-demo-elephant-b (demo) | `active` | 31/10/2026 21:51:57 |
| #4 | t4-empresa-demo-elephant-02 (demo) | `active` | 31/10/2026 22:02:42 |
| #1, #3 | demo | `converted` | — |

Ninguna prueba tiene todavía avisos registrados (`notice_queued`).

### Qué haría el planificador existente con t5-skibox

Simulado en memoria con sus fechas reales y pasos de 15 minutos, sin tocar production:

| Momento (UTC, primer tick tras el umbral) | Efecto |
|---|---|
| 31/10 ~14:00 | Aviso «termina en 3 días» |
| 02/11 ~14:00 | Aviso «termina mañana» |
| 03/11 ~14:00 | Estado `expired` y aviso «tu prueba ha terminado (solo lectura)» |

- Las capacidades caducan solas el 03/11 13:50:33 (`valid_until`), con o sin planificador.
- **Activación tardía:** si se enciende con un umbral ya pasado, solo sale el aviso más cercano, nunca los atrasados en bloque. Simulado activándolo el 02/11 a las 20:00: solo sale el de 1 día y después el de fin.
- El plan de este motor (D-16 propuesto: 7, 3, 1) añadiría un aviso de 7 días el 27/10 ~14:00. Hoy solo se planifica: el planificador existente envía los de 3, 1 y 0 días.

### Con el planificador encendido antes del 31/10

- t2 y t4 (demos) pasarían a `expired` el 31/10, con sus avisos.
- Con `MAIL_MODE=sandbox`, los avisos solo llegan a direcciones de la lista de permitidos. Con `off`, solo quedan registrados.

### Configuración segura

1. `CP_TRIALS_SCHEDULER_ENABLED=1` en el plano de control de production, con `--skip-deploys`.
2. Despliegue de la **misma** versión que corre. El planificador no requiere código nuevo.
3. Sin cambiar `MAIL_MODE`:
   - En `sandbox`, los avisos a clientes reales (t5-skibox) se descartan como `sandbox_recipient_not_allowed`, salvo que su dirección esté en la lista de permitidos.
   - Para que el cliente reciba el aviso hace falta decidir aparte el correo real (modo live del correo y `MAIL_LIVE_AUTHORIZED`). Este documento no lo propone.
4. Intervalo por defecto: 15 minutos (`CP_TRIALS_SCHEDULER_INTERVAL_MS`).

### Verificaciones

- **Antes:** listar `trial_requests` activas (estado, `ends_at`) y comprobar que ninguna demo debe quedar fuera. El planificador vence todas las activas cuyo plazo pase.
- **Al arrancar:** log `ctx="Trials" event="scheduler" enabled=true intervalMs=900000`.
- **Primer tick** (al cabo de 1 minuto): `scheduler_tick` solo si hubo trabajo. Sin pruebas en umbral, no se registra nada.
- **Tras cada umbral:** `trial_events` con `notice_queued` (uno por prueba y umbral) y `mail_outbox` de plataforma con la clave `trial:{id}:expiry:{endsAt}:{días}` y el estado que corresponda al modo de correo.
- **El 03/11:** `trial_requests.state = expired` para t5-skibox. Licencias en solo lectura, datos intactos, sin cobros.
- **Reversión:** quitar la variable (`CP_TRIALS_SCHEDULER_ENABLED` ausente) y volver a desplegar la misma versión. Lo ya hecho (avisos, `expired`) no se deshace ni hace falta deshacerlo.
