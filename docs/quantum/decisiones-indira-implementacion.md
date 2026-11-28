# Quantum Soulrise: decisiones de Indira y su implementación

Estado: 24/11/2026 (sección 6 añadida el 27/11). La respuesta de Indira (responsable de Quantum) es la referencia comercial autorizada. **No activa cobros LIVE ni cambia modalidades de venta.** Todo sigue «solo por solicitud».

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

## 6. 27/11: escalonado 0/30/60 · 30 días, ampliaciones 33/55, M1 retiros

Decisión de Indira (27/11/2026) para RECONNECT (producto 1; variantes 13 «+MODUL 1», 9 «ONLINE KOMPLETT», 11 «INTENSIV»; la 8 LIVE no da acceso al LMS). Cierra los puntos 1 y 2 de la sección 3.

### Decisiones tomadas (código, pruebas y documentación; nada creado en ningún tenant)

| Punto | Decisión | Dónde |
|---|---|---|
| Escalonado | M1 día 0, M2 día 30, M3 día 60; cada módulo con **30 días exactos** desde su desbloqueo. +MODUL 1: solo M1, 30 días | `reconnectStaggeredSettings()` en `shared/learning.ts`; botón «Escalonado 0/30/60 · 30 días» en Reglas (solo rellena el formulario) |
| «30 días» | **30 × 24 h (30 × `DAY_MS`), no días naturales ni cambios de hora.** Ventanas contiguas `[T0, T0+30d)`, `[T0+30d, T0+60d)`, `[T0+60d, T0+90d)`; la frontera final queda excluida y el siguiente módulo abre en ese mismo instante | `server/learningEscalonado.test.ts` y `server/learningEscalonado.mysql.test.ts` (c) |
| Estados visibles | Por módulo: activo / se desbloquea el … / caducado / pendiente de activar, para el alumno (aula) y para la administración (tabla de matrículas). El estado global de la matrícula sigue siendo `effectiveEnrollmentStatus` | `listEnrollments` devuelve `modules[]` con estado y fechas; `LearningAdmin.tsx` |
| Ampliaciones | +30 días = **33 €**, +60 días = **55 €**. El precio sale SIEMPRE de las variantes del producto de ampliación; el código no fija importes | `learning.admin.setExtensionCatalog` / `getExtensionCatalog` (valida producto, variantes del producto, vigencia y precio > 0) y formulario en Reglas |
| M1 en retiros ≥ 6 días | Activación voluntaria por la persona; **una sola concesión por participante y curso**: una segunda regla de activación voluntaria (otro retiro, otro presupuesto u otra versión de la regla) no concede otra matrícula mientras exista una activa, pendiente de activar o programada; queda `skipped: already_granted` y un evento `grant_skipped` en la matrícula existente. Caducada o revocada, vuelve a conceder | `grantFromPayment` en `server/learningDb.ts`; prueba (b) |
| Sin mezclas | La activación voluntaria se rechaza con fecha fija, desbloqueo progresivo o **duración propia por módulo**, también cuando `activation_required` viene guardado o heredado por una versión nueva (no solo cuando la llamada lo envía) | `saveRule`; prueba (a) |
| Lo ambiguo | No se automatiza: ningún procedimiento crea ni activa reglas; el preset solo rellena el formulario y la administración guarda y activa a mano | — |

### Pendiente humano / operativo (no se hace desde el código)

1. **Reglas en el tenant de Quantum** (crear y activar a mano, previa confirmación): variante 9 y 11 → curso RECONNECT, M1/M2/M3 con el preset 0/30/60 · 30 días; variante 13 → solo M1, 30 días; retiros de ≥ 6 días → M1, 30 días, activación voluntaria y mínimo contratado 6 días. La variante 8 (LIVE) sigue sin regla.
2. **Producto de ampliación:** en el tenant ya existe el producto **33 «RECONNECT · Modulverlängerung»** con dos variantes de 33 € (30 días) y 55 € (60 días), **no activo**. Falta: activarlo y registrar el catálogo con `learning.admin.setExtensionCatalog` (experienceId 33 + los ids de sus dos variantes, que se consultan en el panel). Sin ese registro no se ofrece ninguna ampliación en el aula.
3. **Curso RECONNECT publicado** con los tres módulos (hoy sigue en borrador / validación técnica).
4. **Cobros:** siguen apagados; la venta real exige la ventana de Stripe/cobros y la aprobación del propietario.
5. Preguntas abiertas a Indira: duración del grupo de Telegram y fechas de Morning Impulse de enero 2027 (sección 3, puntos 3 y 4).
