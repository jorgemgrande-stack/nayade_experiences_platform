# Elephant Academy: exigencia de licencia en servidor

Estado: **diseñada y probada, NO activada**. `LEARNING_LICENSE_ENFORCED` sigue apagada por defecto y no se enciende en ningún entorno con este cambio. Con la variable apagada el comportamiento es idéntico al anterior (hay pruebas explícitas). Encenderla en production es un paso protegido del propietario.

Nombre comercial: Elephant Academy. Los identificadores técnicos (`learning`, `learning_*`, rutas, métricas) no cambian.

## Cómo funciona la licencia

La licencia es una entrada `learning` en `tenant_entitlements` (concedida por el operador). `ModuleAccess.isModuleAvailable("learning")` la evalúa por empresa: activa, no caducada, no suspendida (y, en el futuro, la capacidad comercial si el manifiesto declara `capability`). En modo `single` (instalación de Náyade) todo lo instalado está disponible. Con la variable encendida, si la licencia no se puede verificar **se cierra** (403/503, o «sin licencia» en jobs y ganchos).

**Derecho heredado de Quantum:** Quantum ya tiene su entitlement `learning` concedido a mano (19/11). La guarda encendida lo lee tal cual: no hace falta ningún dato nuevo, ningún concepto de «grandfathering» ni migración. La prueba `derecho heredado de Quantum` demuestra que la guarda permite todo y no modifica el entitlement. Si ese entitlement se retirara o suspendiera, la empresa quedaría sin licencia: no hay excepción oculta por nombre de empresa.

## Matriz de puntos de entrada

`ON` = con `LEARNING_LICENSE_ENFORCED=1`. «Antes» = qué hacía el código antes de este cambio.

| Punto de entrada | Antes (variable ON) | Ahora (variable ON) | Con variable apagada |
|---|---|---|---|
| tRPC `learning.admin.*` (matrículas, reglas, materiales, authoring, editor, importación, barrido manual, revocaciones, prórrogas, demos, vista previa) | exigía licencia (`moduleRouteGuard`) | igual: exige licencia | sin comprobación (igual que antes) |
| tRPC `learning.my.courses/course/lesson/progress/activate` (aula del alumno) | exigía licencia | **no exige licencia** (derecho adquirido; acotado a las matrículas del propio alumno por el procedimiento) | sin comprobación |
| tRPC `learning.my.startExtension` (compra de ampliación) | exigía licencia | exige licencia (es venta) | sin comprobación |
| Express `GET /api/learning/resource/:id` (vídeo, audio, PDF del alumno) | exigía licencia | **no exige licencia**; la ruta sigue exigiendo sesión, matrícula activa y ventana | sin comprobación |
| Express `GET /api/learning/preview/resource/:id`, `GET /preview/file/:fileId`, `POST /upload/:id`, `POST /materials/:id/stage` | exigían licencia | igual: exigen licencia | sin comprobación |
| Job `learning-sweep` (cada 10 min, por empresa) | **sin comprobación** | no opera sobre empresas sin licencia (`skipped: "sin_licencia"`) | idéntico |
| Gancho pedido de tienda pagado (`shopOrdersDb.finalizePaidShopOrder` → `grantLearningFromOrder`) | **sin comprobación** | no concede sin licencia (el barrido lo recupera al volver la licencia) | idéntico |
| Gancho inscripción confirmada (`editionsDb` → `safeGrantAfterConfirm`) | **sin comprobación** | no concede sin licencia | idéntico |
| Gancho `applyExtensionsForOrder` (pedido de ampliación ya pagado) | sin comprobación | **sin cambio** (el pedido solo pudo crearse con licencia; es un cobro ya hecho) | idéntico |
| Gancho de reembolso/disputa (`shopPort` → `changeLearningAccessForOrder`) y flujo de revocación | sin comprobación | **sin cambio y siempre activo**: proteger al alumno y revocar nunca se condicionan a la licencia | idéntico |
| Rutas de Core que rechazan el producto de ampliación (`routers.ts`) | no comprueban | sin cambio (leen ajustes, no conceden nada) | idéntico |

El helper común es `learningLicensed()` (`server/learningLicense.ts`): mismo interruptor, no lanza nunca, y con la variable apagada devuelve `true` sin consultar nada. No se ha tocado `learningFlow.ts` ni `learningExtensions.ts`.

## Política de derechos adquiridos del alumno

Elección: **un alumno ya matriculado conserva el acceso de lectura a lo que tiene concedido aunque la empresa pierda la licencia; la gestión y la venta se cierran.**

- Sigue permitido: ver su aula, abrir lecciones y recursos de su matrícula (siempre dentro de su ventana de fechas), registrar su progreso y activar un derecho ya concedido.
- Se cierra: toda la administración, la vista previa, la subida de ficheros, la compra de ampliaciones y las concesiones nuevas (jobs y ganchos de comercio).
- Nunca se borran matrículas ni ficheros por perder la licencia (principio de `DISENO_COMPRA_MODULOS`). Los reembolsos y disputas siguen revocando o suspendiendo.
- La lista de procedimientos permitidos del alumno es explícita (`LEARNING_STUDENT_PROCEDURES`): un procedimiento `learning.my.*` nuevo queda cerrado hasta clasificarlo (una prueba lo vigila).
- Razón: cobrar y cerrar el acceso a quien ya pagó sería un riesgo contractual y reputacional; el coste de dejarlo abierto es solo lectura de contenido ya vendido. Es compatible con el «solo lectura 30 días» propuesto para las bajas.
- Límite: la guarda no distingue «perdió la licencia» de «nunca la tuvo»; en una empresa que nunca la tuvo no puede haber matrículas (la administración y los ganchos están cerrados), así que no se abre nada.

## `learning.manage`

Sigue declarado en el manifiesto (`builtin.ts`) y **no se comprueba en ningún sitio**: `adminProcedure` decide por el permiso `settings.manage` o el rol admin. Hay una prueba de caracterización que fija este estado. Aplicarlo de verdad es otra tarea (cambia quién puede administrar Learning) y queda fuera de este cambio.

## Pruebas

- `server/learningLicenciaServidor.test.ts` (nuevo, sin BD, dobles en memoria): matriz apagada/encendida, con/sin licencia, Quantum, aislamiento, alumno, `learning.manage`.
- `server/learningLicencia.test.ts` (actualizado a la política del alumno).
- Las pruebas `*.mysql.test.ts` de Learning no se modifican; las de MySQL real corren en CI.

## Pendiente antes de activar en production (decisión del propietario)

1. Confirmar que Quantum conserva su entitlement `learning` vigente y sin caducidad (consulta, no escritura).
2. Encender `LEARNING_LICENSE_ENFORCED=1` como paso protegido; comprobar el aula con un alumno real y la administración con admin.
3. Cobrar sin entregar: un pedido pagado de una empresa sin licencia queda sin matrícula hasta que haya licencia (el barrido lo concede entonces). Decidir si hace falta un aviso al operador.
4. Aplicar `learning.manage` y los permisos finos (otra tarea).
