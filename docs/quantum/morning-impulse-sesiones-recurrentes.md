# MORNING IMPULSE · sesiones recurrentes de compra permanente

Oferta permanente de compra directa: **todos los lunes 07:30, 30 min, en directo por Zoom, 49 € por paquete de 4 sesiones**
(PVP con IVA incluido; el IVA provisional del 21 % lo calcula el flujo de pedido existente: 49 € → base 40,50 € + cuota 8,50 €).
Incorporación semanal en cualquier momento, sin convocatorias ni plazos cerrados. **Los cobros reales siguen desactivados:**
esta función solo prepara el circuito; no toca Stripe ni cambia ningún modo de venta.

## Cómo funciona
1. **Oferta** (Administración › Catálogo y comercio › Sesiones recurrentes › Ofertas; entrada opt-in que aparece cuando existe alguna):
   producto (y variante opcional; 0 = todas), día ISO, hora local, **zona horaria explícita**, duración, nº de sesiones, antelación mínima
   y enlace de Zoom **opcional**. Nace **inactiva**. Valores de fábrica de Morning Impulse: `shared/recurringSessions.ts` (`MORNING_IMPULSE_DEFAULTS`).
2. **Compra pagada** → `finalizePaidShopOrder` llama a `grantRecurringFromOrder` (idempotente, nunca lanza): una fila por línea de pedido
   (`recurring_session_entitlements`, única por `reservation_id`) con las **próximas N sesiones calculadas al pagar** (`upcomingSessions`):
   la hora local se conserva al cruzar el cambio de hora y una compra con menos de la antelación mínima empieza la semana siguiente.
3. **Aviso al comprador** (categoría «operational», clave de idempotencia `recurring:<id>:notice`, de/es/en/fr):
   - con enlace de Zoom real configurado: fechas + botón de Zoom;
   - **sin enlace: no se inventa ninguno**; el aviso dice que los datos de acceso llegarán después y la participación queda como **«Zoom pendiente»**, visible en la pantalla de administración.
4. **Zoom después**: al configurar el enlace, «Enviar Zoom» (una participación) o «Enviar Zoom a las pendientes» (clave `recurring:<id>:zoom`; solo participaciones vigentes).
5. **Telegram**: sin enlaces ni invitaciones automáticas (la titular invita a mano).

## Garantías
- Reintentos del cobro / avisos repetidos / pasadas simultáneas: un derecho y un correo (clave única en BD + reserva `pending → sending` + clave de idempotencia del correo).
- Un aviso caído (`sending` más de 10 min) se puede retomar; un correo fallido queda `failed` con el motivo y se reintenta a mano sin duplicar.
- Aislamiento por tenant (tablas en la base de la empresa); migración **0097** aditiva, reversible sin perder datos (RENAME).
- Reembolsos: este circuito **no** retira una participación ya concedida (un enlace de Zoom enviado no se puede revocar); un reembolso lo gestiona la titular.

## Decisiones pendientes de Indira (no se automatizan hasta tenerlas)
1. **Zona horaria** de las 07:30 (por defecto Europe/Madrid, «sin confirmar» en la pantalla).
2. **Enlace de Zoom**: ¿uno fijo para todas las sesiones? (hoy no hay ninguno configurado).
3. **Cómo se cuentan las 4 sesiones**: se implementa «las 4 próximas desde la compra»; confirmar que es lo que ella entiende por paquete.
4. **Antelación mínima** (60 min por defecto): ¿hasta cuándo se puede entrar el mismo lunes?
