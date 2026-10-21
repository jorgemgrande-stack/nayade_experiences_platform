# Ciclo de vida de una empresa (tenant): PROPUESTA

**Propuesta pendiente de aprobación del propietario y de validación jurídica.** No implementa borrados automáticos ni cambia textos legales. Distingue lo que **ya funciona** (✅) de lo **propuesto** (🟡).

## 1. Línea temporal

Los días se cuentan desde el fin de la prueba sin contratar o desde el fin del contrato (cancelación efectiva o impago agotado).

| Momento | Estado de la empresa | Uso del panel | Web pública | Exportación de datos | Estado |
|---|---|---|---|---|---|
| Prueba (15 días; avisos a 7, 3, 1 y 0 días) | `trial` | Completo | Sí | Sí | ✅ |
| Impago: gracia de 7 días (avisos a 0, 3 y 6) | `grace` | Completo | Sí | Sí | ✅ |
| Día 0 → 30: solo lectura | `suspended` | Consulta | No | Sí | ✅ |
| Día 30: fin de solo lectura (licencias canceladas; correo «Ha terminado el periodo de solo lectura») | `suspended` | Solo Suscripción y exportación | No | Sí, hasta el archivado | ✅ |
| Avisos de archivado: días 60, 83 y 89 («tu entorno se archivará el día X; exporta tus datos») | `suspended` | Igual | No | Sí | 🟡 correos nuevos (hoy no existen) |
| **Día 90: archivado** (operador, tras la revisión que ya señala el motor) | `archived` | No (410) | No | No | 🟡 plazo propuesto; el archivado es manual ✅ |
| Archivado → reactivación (contratación nueva o error) | `archived` → `active`/`suspended` | Se recupera todo | — | — | ✅ (transición permitida) |
| **Día 180: supresión definitiva** (90 días después del archivado) | `deleting` → `deleted` | — | — | — | 🟡 manual, con doble aprobación; no automatizado |
| Copias de seguridad | — | — | — | — | ✅ rotación (30 diarias, 12 semanales, 12 mensuales): los datos suprimidos desaparecen de las copias en un máximo de 12 meses |

## 2. Propuestas concretas

1. **Exportación hasta el archivado** (✅ decidido): la persona propietaria puede exportar desde el día 0 hasta el archivado. Cada ZIP es una copia que se retira a los 7 días; siempre puede pedir otro.
2. **Archivado a los 90 días** del fin (🟡): da 60 días más de exportación tras la solo lectura.
   - El motor de ciclo de vida ya señala la revisión (`retention_review`) al cumplirse `CP_LIFECYCLE_RETENTION_DAYS` (30 por defecto). Se propone fijarlo en **90**.
   - El archivado lo hace un operador, que comprueba:
     - que no hay contratación ni reactivación en curso;
     - que la empresa recibió los avisos;
     - el estado de deuda;
     - que no hay requerimiento legal pendiente.
3. **Avisos previos al archivado** (🟡): tres correos transaccionales nuevos a la persona propietaria, en los días 60, 83 y 89, con el botón a la exportación. Se incorporarían al catálogo de comunicaciones con su vista previa (`MAIL_MODE` sigue en `off`).
4. **Supresión definitiva a los 180 días** (🟡), nunca automática:
   - el operador ejecuta una orden con simulación previa;
   - antes, una lista de comprobación: exportación ofrecida, sin litigio ni requerimiento, sin deuda que exija conservar pruebas, y aprobación de dos personas;
   - se borran la base de la empresa, su usuario de base de datos y sus ficheros, y la empresa pasa a `deleted`;
   - las copias de seguridad desaparecen con su rotación (máximo 12 meses);
   - queda registro del acto (quién, cuándo y qué).
5. **Lo que no se suprime con la empresa** (validación jurídica):
   - la relación contractual con Elephant Source (pedidos, facturas de la suscripción, tickets), que vive en el plano de control y en Stripe y está sujeta a los plazos de conservación fiscal y mercantil (por ejemplo, 6 años según el art. 30 del Código de Comercio);
   - los datos del registro necesarios para acreditar la supresión.
6. **Papel de Elephant Source** (validación jurídica): para los datos de la empresa es encargado del tratamiento (art. 28.3.g RGPD: al terminar, devolver o suprimir). La exportación cumple la devolución; la supresión del día 180 cumple el resto, salvo obligación legal.

## 3. Decisiones necesarias

1. Plazos: archivado a los **90** días y supresión definitiva a los **180** días desde el fin (u otros).
2. Avisos previos al archivado: días **60, 83 y 89** (u otros).
3. Doble aprobación y lista de comprobación de la supresión.
4. Plazos legales de conservación de la relación contractual y de los registros (leads y registros de seguridad siguen pendientes, `docs/LEGAL_PENDIENTES.md` en la web).
5. Redacción legal correspondiente (borrador bigelephant-web #12, con estos plazos marcados como pendientes).

## 4. Qué se implementaría tras la aprobación (sin borrados automáticos)

- `CP_LIFECYCLE_RETENTION_DAYS=90` (configuración, sin código).
- Los tres correos de aviso (catálogo y disparador en el motor de ciclo de vida, como el de fin de solo lectura).
- La orden de supresión manual con simulación, doble aprobación y registro. **No** se programa: siempre la ejecuta una persona.
