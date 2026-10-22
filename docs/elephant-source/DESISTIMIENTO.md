# Desistimiento de consumidores (función de desistimiento)

**Estado (20/10/2026):** implementado en `server/withdrawals/`, con la página **Suscripción** del Core y la migración CRM 0022. **No ejecuta reembolsos ni bajas automáticas:** a falta de una política jurídica aprobada, registra, evalúa, avisa y guarda la resolución, y la ejecución la hace el equipo a mano.

## 1. Desistimiento frente a cancelación

| | Cancelación ordinaria | Desistimiento |
|---|---|---|
| Quién | Cualquier cliente | **Solo particulares** con un contrato de pago |
| Cuándo | En cualquier momento | **14 días naturales** desde la celebración del contrato (ampliado 12 meses si no consta la información precontractual) |
| Efecto | La suscripción termina **al final del periodo pagado**, sin reembolso | Deja sin efecto el contrato. Se reembolsa lo pagado **menos la parte prestada** si el particular pidió la ejecución inmediata |
| Dónde | Customer Portal de Stripe | Cuenta → **Suscripción** → «Desistir del contrato aquí» |
| Resolución | Automática (Stripe) | **Una persona** revisa y resuelve |

## 2. Flujo

1. **Cuenta del cliente** (Core, `/admin/suscripcion`, rol administrador). La sección «Desistimiento del contrato» aparece **solo** si el contrato es de un particular. El botón «Desistir del contrato aquí» se muestra durante el plazo.
2. **Confirmación** «Confirmar desistimiento», con un comentario opcional. No hace falta motivo.
3. **Justificante inmediato** en pantalla: referencia `DS-AAAAMMDD-XXXXXX`, fecha y hora (Madrid) y texto. Si el correo está activo, va también un **acuse por correo** como soporte duradero. Con el correo apagado, el justificante no consta como enviado y queda en la cuenta.
4. **Registro auditable** (CRM 0022):
   - la solicitud, con canal, quién la presenta, fecha y hora, y evaluación;
   - el **historial** de cada paso;
   - el evento comercial `order.withdrawal_requested`, con origen «cliente».
5. **Gestión** (operadores):
   - estados `received` → `under_review` → `accepted` / `rejected` (con motivo) → `completed`;
   - **completar** exige una nota y admite la referencia del reembolso y de la baja ejecutados a mano;
   - cada decisión se comunica al consumidor por correo y queda en el historial y en `order.withdrawal_resolved`.
6. **Otros canales** (correo, teléfono, papel): soporte la registra con `POST /cp/v1/withdrawals`, con canal `support`.

## 3. Evaluación automática (propuesta, no decisión)

- **Aplicabilidad:**
  - empresa o profesional → no aplica (cancelación ordinaria);
  - prueba gratuita sin contrato de pago → no aplica.
- **Contrato:**
  - es el pedido de alta o de conversión que lo celebró; un cambio de plan **no** abre un plazo nuevo;
  - la fecha es la de su confirmación.
- **Plazo:** hasta el final del día 14 en hora de Madrid, teniendo en cuenta el cambio de horario. **Ampliado 12 meses** (art. 105) si el consentimiento no tiene la versión de la información precontractual.
- **Fuera de plazo:** no se ofrece el botón, pero una solicitud **se registra igualmente** y la resuelve una persona.
- **Efectos económicos (propuesta):**
  - con ejecución inmediata reconocida: lo pagado menos la parte proporcional del periodo prestado;
  - sin ella: todo lo pagado.
  - Se marca la excepción del art. 103.a si el servicio constara completamente prestado.

## 4. Rutas

| Ruta | Ámbito | Uso |
|---|---|---|
| `GET /cp/v1/commerce/tenants/:t/withdrawal` | `commerce:withdrawal` | El Core consulta si se puede desistir ahora |
| `POST /cp/v1/commerce/tenants/:t/withdrawal` | `commerce:withdrawal` | El Core presenta la solicitud (idempotente) → justificante |
| `GET /cp/v1/withdrawals?status=` | `orders:read` | Operadores: lista |
| `GET /cp/v1/withdrawals/:id` | `orders:read` | Detalle e historial |
| `POST /cp/v1/withdrawals` | `orders:write` | Registrar una solicitud recibida por otro canal |
| `POST /cp/v1/withdrawals/:id/decision` | `orders:write` | `review` / `accept` / `reject` / `complete` con versión |

## 5. Puesta en marcha

1. Migración **CRM 0022**, con autorización. Sin ella la función no se monta (`ctx: Withdrawals, reason: migration_0022_missing`).
2. **Token del Core:** añadir el ámbito `commerce:withdrawal` al token de servicio del Core en `CP_TOKENS`. Es un ámbito propio y mínimo, separado de `commerce:purchase`. En el Core, `CP_COMMERCE_URL` y `CP_COMMERCE_TOKEN` ya existen para la compra.
3. **Correo** (`MAIL_MODE=live`) para el acuse duradero. Sin él, el justificante queda en la cuenta.
4. **Aprobación jurídica** (§6) antes de vender a particulares.

## 6. Requiere aprobación jurídica

- **Política de ejecución:**
  - quién reembolsa, en qué plazo (14 días desde la comunicación, art. 107) y por qué medio;
  - cuándo se da de baja la suscripción. Hasta entonces, el equipo lo ejecuta a mano y lo anota al completar.
- **Cálculo de la parte proporcional:** por días del periodo pagado.
- **Ampliación de 12 meses:** cuando no consta la información precontractual.
- **Textos:** el del acuse, el de la resolución y el de la sección de la cuenta (`server/mail/templates.ts`, `WithdrawalSection.tsx`).
- **Ubicación y etiquetas** de la función de desistimiento según la transposición española de la Directiva (UE) 2023/2673.
