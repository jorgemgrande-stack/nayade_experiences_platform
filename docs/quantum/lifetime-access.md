# Quantum Soulrise: Lifetime Access — DESCARTADO

Estado: 26/11/2026. Indira decidió expresamente **no ofrecer Lifetime Access** por ahora. No hay opción de 144 €, ni en fichas, ni en el carrito, ni en el pago, ni reglas de acceso activas asociadas.

## Qué se hizo para desactivarlo
- La variante 43 de RECONNECT (Lifetime Access, 144 €) quedó **caducada** (`validUntil` 24/11/2026): no sale en la ficha pública, no se lista como suplemento y el servidor la rechaza. No se ha borrado nada (queda el rastro).
- La regla de acceso 6 (permanente, tres módulos) sigue **inactiva** y no concede nada. No se activa.
- El producto no ofrece ningún suplemento de pago digital.

## Qué código se conserva (sirve a cualquier suplemento, no solo a Lifetime)
- `order_supplement_lines`: el suplemento realmente pagado de una línea del pedido (qué, tramo, importe, estado, matrícula que concedió). Útil, por ejemplo, para la alimentación ayurvédica de los retiros cuando se venda directamente.
- `supplement_variant_scope`: opciones del programa con las que se admite un suplemento.
- Concesión por regla exacta de la variante-suplemento y `learning.admin.refundSupplement` (reembolso de un suplemento sin tocar el resto de derechos). Sin reglas de suplemento activas, no concede nada.
- Carrito: la ficha de un producto de compra directa ofrece sus suplementos opcionales (desmarcados). Hoy ningún producto de Quantum es de compra directa y los suplementos de alimentación están en retiros solo por solicitud: no cambia nada visible.

## Qué no existe
No hay desarrollo adicional de Lifetime. Si Indira lo retomara, habría que crear de nuevo la variante, su ámbito y una regla (la infraestructura ya está).
