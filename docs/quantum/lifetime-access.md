# Quantum Soulrise: Lifetime Access (suplemento de RECONNECT)

Estado: 25/11/2026. **No activa cobros ni venta directa.** Todo lo de abajo está preparado y probado, pero la venta sigue por solicitud hasta autorización expresa.

## Qué es
Suplemento opcional único de 144 € que se contrata al comprar RECONNECT ONLINE COMPLETO o INTENSIV y concede acceso **permanente** a los tres módulos. No se marca por defecto, no se suma solo y el servidor recalcula el total.

## Cómo funciona (diseño)
| Pieza | Comportamiento |
|---|---|
| Suplemento | Variante con `supplementGroup = lifetime`, importe único («fixed»), 1 participante (mín. 1, máx. 1). |
| Ámbito | `supplement_variant_scope`: solo se admite con las opciones ONLINE COMPLETO / INTENSIV (las dos tarifas de cada una). Con LIVE o + MÓDULO 1 el servidor lo rechaza. |
| Pedido | `order_supplement_lines` guarda el suplemento realmente elegido (tramo, importe, estado) y la matrícula que concedió. |
| Derecho | Una regla de acceso cuya variante es el propio suplemento (casa solo con la EXACTA, nunca con reglas genéricas). Concede una matrícula **aparte** de la del programa: permanente, tres módulos, con el mismo desbloqueo progresivo (0/30/60 días) si la regla lo define. |
| Idempotencia | Clave por línea de suplemento y regla: aviso repetido, recuperación manual o llamadas simultáneas no duplican. |
| Reembolso del suplemento | `learning.admin.refundSupplement`: marca la línea como reembolsada y revoca SOLO esa matrícula. El programa y las ampliaciones siguen. No se vuelve a conceder en una recuperación. |
| Reembolso total / disputa perdida | Se revocan todas las matrículas del pedido y los suplementos pasan a «reembolsado». Disputa abierta suspende; ganada reabre lo suspendido por Stripe. |
| Ampliaciones | Un módulo permanente no caduca: no se ofrece ampliarlo. |

## Quién ve qué
La ficha pública de un producto de compra directa ofrece el suplemento (desmarcado) con la opción elegida y el carrito lo suma al total estimado. En un producto solo por solicitud, el formulario lo anota sin cobro.

## Lo que NO está hecho
- Comprarlo **después** de un acceso ya existente (mejora posterior): no existe y es decisión comercial.
- Crear la variante, su ámbito y la regla en el tenant (se hace tras publicar el código y sin activar la regla).
- Activar la regla o la venta: exige autorización expresa de Dirección.
