# Overnight · Stripe Billing, onboarding y preparación comercial

**Inicio:** 17/10/2026, noche. **Documento vivo:** se actualiza durante la sesión.

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

## Límites que se respetan toda la noche

- Ni Stripe live ni cobros reales.
- No se abre el registro público, no se activa `MAIL_MODE=live` y no se cambia el DNS.
- No se migra ni se despliega en Railway.
- No se toca `main` ni Náyade.
- No se borran datos ni se exponen secretos.

## Organización del trabajo

| Línea | Quién | Repo y rama |
|---|---|---|
| Stripe Fase C, estado público del alta, documentación | Agente principal | Core `feat/stripe-fase-a` |
| Prueba gratuita autónoma (reenvío, tareas de vencimiento, conversión) | Subagente | Core `feat/trials-autonomia` |
| Pantallas internas del CRM (contrataciones, operación, retirada del motor antiguo) | Subagente | CRM `feat/crm-contratacion-stripe` |
| Recorrido de contratación en la web (páginas de retorno tras bandera) | Subagente | Web `feat/web-contratacion-stripe` |
| Excepción del webhook de Stripe en la pasarela del CRM | Agente principal | CRM `feat/gateway-stripe-webhook` (PR #21) |
| Revisión de seguridad del código de Stripe | Subagente (solo lectura) | — |

## Tareas completadas

| # | Tarea | Estado | Commits / PR |
|---|---|---|---|
| 1 | **Orquestador:** `applyExternalBilling` (impago, suspensión, recuperación, cancelación programada, reactivación, fin en solo lectura), transición `reactivate` y sin recibos simulados en pedidos de Stripe | Completado y probado | `2a60977` |
| 2 | **Stripe Fase C:** webhook firmado sobre el cuerpo original, procesamiento duradero con arrendamiento, relectura del objeto, pago verificado por factura y conciliación con arrendamiento entre réplicas | Completado y probado (dobles y MySQL) | `531a1dd` |
| 3 | **Plano de control:** webhook antes del JSON global y tarea periódica opcional (`CP_STRIPE_WORKER_ENABLED`) | Completado y probado | `666cb72` |
| 4 | **Pasarela del CRM:** excepción del webhook de Stripe | Completado y probado en local | CRM #21 |

## Pruebas realizadas

| Batería | Tipo | Resultado |
|---|---|---|
| `server/stripe/webhook.test.ts` | Criptografía real del SDK (sin red) | 12/12 |
| `server/stripe/lifecycle.mysql.test.ts` | MySQL 8.4 real con el orquestador real; Stripe simulado | 15/15 |
| `server/stripe/*` (total) | Unitarias y MySQL | 81/81 |
| Orquestador y plano de control (existentes) | Unitarias y MySQL | En verde (salvo el paso 16 de `clienteNuevo`, que falla igual en la rama base en Windows) |
| Pasarela del CRM (Stripe) | Caddy 2.8.4 local | 16/16 |
| **Contra el sandbox real de Stripe** | — | **Ninguna:** escrituras pausadas (ver bloqueos) |

## Problemas detectados y soluciones

| Problema | Solución |
|---|---|
| Un pedido ya pagado podía abrir otra Checkout Session (Fase B) | `hasCompletedSession` lo impide (con prueba) |
| En la API actual la factura no tiene `subscription` en la raíz | Se lee de `parent.subscription_details.subscription`, con respaldo en el campo antiguo |
| La activación del contrato vuelve a llamar a la plataforma con el tenant ya existente | Es idempotente (no crea nada). La prueba distingue las llamadas de las altas nuevas |

## Bloqueos

1. **Escrituras en Stripe** (catálogo y Portal): pendientes de la comprobación humana del sandbox (`STRIPE_FASE_B.md` §1).
2. **Migración `0012`, claves y despliegue:** requieren autorización.
3. **Dominio comodín para las altas sin pasarela por empresa:** requiere autorización de DNS.
4. **Política fiscal (IVA):** decisión pendiente.

## Próximos pasos de la sesión

- Endpoint público de estado del alta (contrato que necesita la web).
- Entrada de la solicitud de contratación provisional (autoservicio) tras una bandera apagada.
- Incorporar los resultados de los subagentes y de la revisión de seguridad.
