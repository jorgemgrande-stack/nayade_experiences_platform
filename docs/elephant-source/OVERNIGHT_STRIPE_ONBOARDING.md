# Overnight · Stripe Billing, onboarding y preparación comercial

**Sesión:** del 17/10/2026 por la noche al 18/10/2026. **Estado:** cerrada. **Nada se ha desplegado, migrado ni fusionado.**

## Objetivos

Acercar Elephant Core Essential y Business a una beta comercial segura y automatizada:
- Stripe Fase C (webhook, eventos, conciliación);
- catálogo y Customer Portal;
- onboarding automático y prueba de 15 días;
- web de contratación y pantallas del CRM;
- seguridad;
- pruebas de punta a punta.

## Estado inicial

| Repo | Rama | Commit |
|---|---|---|
| Core | `integration/elephant-source` | `a9f6766` |
| Core | `feat/stripe-fase-a` (PR #128) | `e82caf9` (Fases A y B) |
| CRM | `integration/elephant-source` | `5dae4c9` |
| Web | `feat/elephant-web-portfolio` | `b2f7fac` |

- **`main` (Náyade):** Core `baeca78`, CRM `62183b1`, Web `5aa098d`. No se toca.
- **Stripe:** sandbox `acct_1URULO5wMYhQ9O0d` vacío. Las escrituras siguen pausadas porque no se puede demostrar por API que sea independiente de la cuenta real (`STRIPE_FASE_B.md` §1).
- **Railway:** sin cambios. La migración `0012` no está aplicada y no hay claves de Stripe.

## Límites respetados

- Ni Stripe live ni cobros reales. **Ninguna escritura en Stripe.**
- No se abre el registro público, no se activa `MAIL_MODE=live` y no se cambia el DNS.
- No se migra ni se despliega en Railway.
- No se toca `main` ni Náyade.
- No se borran datos ni se exponen secretos.
- No se fusiona ni se cierra ninguna PR.

## Organización del trabajo

| Línea | Quién | Repo y rama |
|---|---|---|
| Stripe Fase C, estado público del alta, autoservicio, documentación | Agente principal | Core `feat/stripe-fase-a` (PR #128) |
| Prueba gratuita autónoma (reenvío, tareas de vencimiento, conversión) | Subagente | Core `feat/trials-autonomia` (PR #129) |
| Pantallas internas del CRM (contrataciones, operación, retirada del motor antiguo) | Subagente | CRM `feat/crm-contratacion-stripe` (PR #22) |
| Recorrido de contratación en la web (páginas de retorno tras bandera) | Subagente | Web `feat/web-contratacion-stripe` (PR #9) |
| Excepción del webhook de Stripe en la pasarela del CRM | Agente principal | CRM `feat/gateway-stripe-webhook` (PR #21) |
| Revisión de seguridad del código de Stripe | Subagente (solo lectura) | — |

## Tareas completadas

| # | Tarea | Estado | Commits / PR |
|---|---|---|---|
| 1 | **Orquestador:** `applyExternalBilling` (impago, suspensión, recuperación, cancelación programada, reactivación, fin en solo lectura), transición `reactivate` y sin recibos simulados en pedidos de Stripe | Probado con MySQL; sin desplegar | `2a60977` |
| 2 | **Stripe Fase C:** webhook firmado sobre el cuerpo original, procesamiento duradero con arrendamiento, relectura del objeto, pago verificado por factura y conciliación con arrendamiento entre réplicas | Probado con dobles y MySQL; sin desplegar | `531a1dd` |
| 3 | **Plano de control:** webhook antes del JSON global y tarea periódica opcional (`CP_STRIPE_WORKER_ENABLED`) | Probado; sin desplegar | `666cb72` |
| 4 | **Estado público del alta** (`/cp/v1/public/checkout/status`) con el contrato de la web | Probado; apagado (`CP_PUBLIC_CHECKOUT_ENABLED`) | `bea873b` |
| 5 | **Revisión de seguridad:** A1, M1–M4, B1, B3, B5–B8 corregidos con pruebas de regresión | Probado | `1a6d332` |
| 6 | **Autoservicio** (`/cp/v1/public/checkout/start`) | Probado; apagado y bloqueado por el catálogo (`on_request`) y por las condiciones | `f8b1a1f` |
| 7 | **Documentación:** `STRIPE_FASE_C.md`, con el plan de despliegue conjunto B + C, la migración, la vuelta atrás y el Portal. Se alinea el §7 de la Fase A con el código | Hecho | este commit |
| 8 | **Pasarela del CRM:** excepción del webhook de Stripe | Probado en Caddy local; CI en verde | CRM #21 |
| 9 | **Prueba gratuita autónoma:** reenvío de la verificación, `TrialScheduler` (sin conectar en `main.ts`), antiabuso, plantillas y `PRUEBA_GRATUITA_AUTONOMA.md` | CI en verde | Core #129 |
| 10 | **CRM:** pantalla de contrataciones, panel de alertas, retirada de la regla de intervalos mezclados y de la antigua `/billing` | CI en verde | CRM #22 |
| 11 | **Web:** `/contratacion/estado` y `/contratacion/cancelada` tras `PUBLIC_CHECKOUT_ENABLED` (apagada), claridad de precios y error anual → mensual corregido | CI en verde | Web #9 |

## Pruebas realizadas

| Batería | Tipo | Resultado |
|---|---|---|
| `server/stripe/*` (8 ficheros) | Unitarias, criptografía real del SDK y MySQL 8.4 con el orquestador real; Stripe simulado | **99/99** |
| `server/stripe/lifecycle.mysql.test.ts` | 20 escenarios de punta a punta (`STRIPE_FASE_C.md` §3) | 20/20 |
| Stripe, plano de control y orquestador | Unitarias y MySQL | 315/315 |
| Fusión de prueba de #128 con #129 | Sin conflictos; sin errores de tipos | 435/435 |
| CI de #128, #129, CRM #21 y #22, Web #9 | GitHub Actions | En verde |
| Pasarela del CRM (Stripe) | Caddy 2.8.4 local | 16/16 |
| **Contra el sandbox real de Stripe** | — | **Ninguna:** escrituras pausadas |

En Windows fallan en local `fileStorage`, `essential.billing`, el paso 16 de `clienteNuevo` y `tscBaseline`. Fallan igual en la rama base y pasan en la CI.

## Problemas detectados y soluciones

| Problema | Solución |
|---|---|
| Un pedido ya pagado podía abrir otra Checkout Session (Fase B) | `hasCompletedSession` lo impide (con prueba) |
| En la API actual la factura no tiene `subscription` en la raíz | Se lee de `parent.subscription_details.subscription`, con respaldo en el campo antiguo |
| La activación del contrato vuelve a llamar a la plataforma con el tenant ya existente | Es idempotente (no crea nada). La prueba distingue las llamadas de las altas nuevas |
| **A1:** cancelar en local un pedido que Stripe sigue cobrando entraba en bucle | Cancelar o rechazar un pedido de Stripe devuelve 409, y la revisión solo avisa |
| **M1:** el cursor de la conciliación podía saltarse eventos | No avanza mientras quedan páginas, y se emite una alerta |
| **M2:** un cambio de plan en Stripe concedía licencias que el pedido no recoge | Los Prices deben coincidir con los de un Checkout del pedido. Si no, se ignora con alerta |
| **M3 / M4:** impago con la cancelación programada, y fin del periodo interno | Suspensión y recuperación de las licencias. Manda el `cancel_at` de Stripe |
| Contrato con la web distinto (`status` / `state`, 400 / 404) | El Core se alinea con la web |
| `unpaid` dejaba las licencias en solo lectura en el diseño, pero las suspende en el código | Se alinea el documento con el código (suspendidas; nunca se borran datos) |

## Bloqueos

1. **Escrituras en Stripe** (catálogo y Portal): pendientes de la comprobación humana del sandbox (`STRIPE_FASE_B.md` §1).
2. **Migración `0012`, claves y despliegue:** requieren autorización (`STRIPE_FASE_C.md` §6).
3. **Cambios de plan desde el Portal:** chocan con la aprobación de los productos `on_request`. Necesitan una decisión.
4. **Autoservicio:** necesita un plan `available` y condiciones legales publicadas (`CP_TERMS_VERSION`).
5. **Dominio comodín para las altas sin pasarela por empresa:** requiere autorización de DNS.
6. **Política fiscal (IVA):** los presupuestos incluyen el 21 % y Stripe cobra el neto. Decisión pendiente.
7. **Brevo:** IP en SpamCop. El rebote hacia `soporte@` (Dinahosting) depende de Brevo.

## Riesgos abiertos (bajos)

- **B2:** una sesión huérfana bloquea su clave de idempotencia durante 24 h.
- **B4:** reembolsos y disputas no se procesan.
- **B9:** falta el prefijo de entorno en las claves de idempotencia.
- Falta la purga de `stripe_events`.

## Siguiente jornada

1. Confirmar la independencia del sandbox y crear el catálogo (6 operaciones) y el Portal con las funciones seguras.
2. Revisar y fusionar #128 y #129 en `integration/elephant-source`, y conectar `TrialScheduler` en `main.ts`.
3. Autorizar la copia de seguridad, la migración `0012` y el despliegue conjunto (incluida CRM #21) según `STRIPE_FASE_C.md` §6.
4. Hacer una alta real en el sandbox con la tarjeta 4242 y verificar el webhook, el pedido `active` y las licencias. Después, encender la conciliación.
5. Decidir sobre el IVA, `on_request` y el autoservicio, los cambios de plan en el Portal y las condiciones legales.
