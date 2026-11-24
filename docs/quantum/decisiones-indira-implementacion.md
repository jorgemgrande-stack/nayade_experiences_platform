# Quantum Soulrise: decisiones de Indira y su implementación

Estado: 24/11/2026. La respuesta de Indira (responsable de Quantum) es la referencia comercial autorizada. **No activa cobros LIVE ni cambia modalidades de venta.** Todo sigue «solo por solicitud».

## 1. Catálogo: qué se ha aplicado en datos (verificado en el tenant)

| Decisión de Indira | Estado |
|---|---|
| RECONNECT: seis modalidades y precios (111, 199, 555/333, 777/555) | Ya estaban; coinciden |
| Promociones solo en ONLINE COMPLETO (333) e INTENSIV (555) hasta el 29/11 inclusive | Ya estaban (opciones 10 y 14 caducan el 29/11) |
| LIVE (111) y + MÓDULO 1 (199) NO llevan promoción | **Corregido:** tenían caducidad 29/11 (se habrían retirado el 30/11). Caducidad quitada en las opciones 8 y 13 |
| Autoestudio solo bajo consulta | Producto 20 en consulta; sin tocar |
| Morning Impulse 49 € | Precio correcto. Fechas publicadas: 30/11–21/12/2026. **Enero 2027: faltan las fechas** |
| 26, 27, 28: 1.290 € individual / 1.190 € por persona desde 2 | Precios correctos. **Cantidades:** individual exactamente 1; «desde 2» de 2 a 5 (27 y 28 aplicado hoy; 26 ya estaba) |
| 29–32 Berchtesgaden: importes cerrados y «desde» | Precios correctos. **Cantidades:** tarifa individual máx. 1; tarifa «desde dos» mín. 2; Wildnistag conjunto exactamente 2 |

Los límites son por compra, no aforo de convocatoria. Las ofertas siguen sin ser comprables (`priced_request`).

No se mezclan alojamiento ni alimentación con el programa: no existe ningún cargo automático de alojamiento. Los suplementos de alimentación ayurvédica (120 € / 90 €) están confirmados pero **no están configurados como suplemento**; se añadirán solo si se decide un modelo de suplemento por producto.

## 2. Formación y accesos (Elephant Learning)

Ya existía: reglas producto/variante → curso y módulos, concesión idempotente tras pago confirmado, revocar/suspender/reactivar, ampliación de la matrícula entera.

Faltaba y se entrega en el PR Core #1022 (migración aditiva 0089, 157 pruebas de learning en MySQL real):

- ventana de acceso **por módulo** y desbloqueo **progresivo** (p. ej. M1 día 0, M2 día 30, M3 día 60);
- ampliación **individual por módulo** (+30 o +60 días, idempotente por pedido+módulo+días);
- el alumno no accede a módulos no incluidos, no desbloqueados o caducados; el progreso se conserva;
- una regla no puede activarse si algún módulo no tiene duración (salvo permanente explícito).

Reglas previstas (se crean **inactivas**; no hay concesión hasta autorizarlo):

| Modalidad | Módulos |
|---|---|
| LIVE | ninguno (grabaciones, materiales y Telegram fuera del LMS) |
| + MÓDULO 1 | M1, **un mes** |
| ONLINE COMPLETO / INTENSIV | M1 día 0, M2 día 30, M3 día 60; **duración inicial de cada módulo: por confirmar** |
| Autoestudio | los tres módulos, solo bajo consulta |

Las reglas de 90 días que existían inactivas eran una suposición y no se usan.

## 3. Pendiente de Indira

1. Duración inicial del acceso a cada módulo en ONLINE COMPLETO e INTENSIV.
2. Si los accesos de los retiros (Módulo 1, valor 190 €) tienen duración.
3. Fechas de Morning Impulse en enero de 2027.
4. Cómo se entrega el grupo de Telegram y quién lo gestiona.

## 4. Pendiente técnico propio

- Fusionar #1022 y aplicar 0089 (coordinado con la ventana 3).
- Mostrar «se desbloquea el …» en el aula (hace falta texto traducido) y editar el calendario en la pantalla de reglas.
- Productos de ampliación (33 € / 55 €) y su enlace con el pedido: dependen del modelo de producto elegido.
- Prueba integral en Stripe TEST (necesita la cuenta de prueba conectada).

## 5. Acciones humanas de Stripe y fiscales

Sin cambios: completar datos del titular de la cuenta Real (Indira), añadir `charge.refunded`, `charge.dispute.created` y `charge.dispute.closed` al destino de Connect, conectar la cuenta TEST, y validar IVA, cancelación y URLs legales.
