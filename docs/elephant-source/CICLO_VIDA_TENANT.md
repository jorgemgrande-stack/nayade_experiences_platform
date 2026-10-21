# Ciclo de vida de una empresa (tenant)

**Plazos adoptados provisionalmente por el propietario (21/10/2026), sujetos a aprobación jurídica:**
- archivado a los 90 días;
- supresión a los 180 días;
- avisos los días 60, 83 y 89;
- doble aprobación humana para la supresión.

No hay borrados automáticos ni se publican textos legales hasta la validación. La tabla distingue lo que **ya funciona** (✅) de lo que **falta implementar** (🟡).

## 1. Línea temporal

Los días se cuentan desde el fin de la prueba sin contratar o desde el fin del contrato (cancelación efectiva o impago agotado).

| Momento | Estado de la empresa | Uso del panel | Web pública | Exportación de datos | Estado |
|---|---|---|---|---|---|
| Prueba (15 días; avisos a 7, 3, 1 y 0 días) | `trial` | Completo | Sí | Sí | ✅ |
| Impago: gracia de 7 días (avisos a 0, 3 y 6) | `grace` | Completo | Sí | Sí | ✅ |
| Día 0 → 30: solo lectura | `suspended` | Consulta | No | Sí | ✅ |
| Día 30: fin de solo lectura (licencias canceladas; correo «Ha terminado el periodo de solo lectura») | `suspended` | Solo Suscripción y exportación | No | Sí, hasta el archivado | ✅ |
| Avisos de archivado: días 60, 83 y 89 («tu entorno se archivará el día X; exporta tus datos») | `suspended` | Igual | No | Sí | 🟡 correos nuevos (hoy no existen) |
| **Día 90: archivado** (operador, tras la revisión que señala el motor) | `archived` | No (410) | No | No | 🟡 `CP_LIFECYCLE_RETENTION_DAYS=90`; el archivado manual ✅ |
| Archivado → reactivación (contratación nueva o error) | `archived` → `active`/`suspended` | Se recupera todo | — | — | ✅ (transición permitida) |
| **Día 180: supresión de los datos operativos** (90 días después del archivado) | `deleting` → `deleted` | — | — | — | 🟡 manual, con doble aprobación; nunca automatizada |
| Copias de seguridad | — | — | — | — | ✅ rotación (30 diarias, 12 semanales, 12 mensuales): los datos suprimidos desaparecen de las copias en un máximo de 12 meses |

## 2. Qué se suprime y qué se conserva

La supresión del día 180 afecta **solo a los datos operativos**. La documentación sujeta a obligaciones legales o fiscales vive en otros sistemas y no se toca con la empresa.

| Grupo | Qué es | Dónde vive | Papel de Elephant Source | Día 180 | Conservación |
|---|---|---|---|---|---|
| **Datos operativos** | Todo lo que la empresa gestiona en su panel: clientes, reservas, productos, usuarios del panel, ficheros, facturas que la empresa emite a sus clientes, comunicaciones | BD de la empresa y su almacenamiento | Encargado del tratamiento | **Se suprimen** (BD, usuario de BD y ficheros) | Copias de seguridad hasta su rotación (máx. 12 meses). Conservar las facturas que emite a sus clientes es obligación de la **empresa**: por eso la exportación está disponible hasta el día 90 y se avisa antes |
| **Documentación de la relación contractual** | Contrato y aceptaciones, pedidos, suscripción, facturas de la suscripción, documentos fiscales, tickets de soporte | Plano de control (CRM) y Stripe | Responsable (cliente propio de Elephant Source) | **No se toca** | Plazos fiscales y mercantiles (p. ej., 6 años, art. 30 del Código de Comercio; plazos tributarios). Pendiente de validación jurídica |
| **Prueba de la supresión** | Identificador de la empresa, fechas, quién aprobó y ejecutó, resultado | Registro de empresas y registro de auditoría | Responsable | **Se conserva** (mínimo, sin datos operativos) | Mientras pueda exigirse acreditar la supresión (pendiente de validación) |
| **Registros técnicos y de seguridad** | Accesos, auditoría y registros de servicio | Plataforma | Responsable | Según su propio plazo | Pendiente (`docs/LEGAL_PENDIENTES.md` en la web) |

La documentación de la relación contractual se entrega a la empresa a petición, en 5 días hábiles (`EXPORTACION_DATOS.md`, sección 5).

## 3. Reglas de operación

1. **Exportación hasta el archivado:** la persona propietaria puede exportar desde el día 0 hasta el día 90. Cada ZIP es una copia que se retira a los 7 días, y siempre puede pedir otro.
2. **Archivado a los 90 días (manual).** El motor señala la revisión (`retention_review`) al cumplirse `CP_LIFECYCLE_RETENTION_DAYS`. Antes de archivar, el operador comprueba:
   - que no hay contratación ni reactivación en curso;
   - que se enviaron los avisos;
   - el estado de la deuda;
   - que no hay requerimiento legal pendiente.
3. **Avisos de los días 60, 83 y 89:** correos transaccionales a la persona propietaria, con el botón a la exportación. Se añaden al catálogo de comunicaciones con vista previa; `MAIL_MODE` sigue en `off`.
4. **Supresión a los 180 días, nunca automática:**
   - una orden manual, primero en simulación (lista lo que borraría, separado por grupos de la sección 2);
   - lista de comprobación: exportación ofrecida, sin litigio ni requerimiento, sin deuda que exija conservar pruebas;
   - **dos personas distintas** aprueban;
   - se borran solo los datos operativos y la empresa pasa a `deleted`;
   - queda la prueba de la supresión (quién, cuándo y qué).
5. **Base jurídica (por validar):** para los datos operativos, Elephant Source es encargado del tratamiento (art. 28.3.g RGPD: al terminar, devolver o suprimir). La exportación cumple la devolución; la supresión del día 180 cumple el resto, salvo obligación legal.

## 4. Pendiente

**Decisiones:**
- validación jurídica de los plazos (90/180), de los plazos de conservación de la sección 2 y de la redacción legal (borrador bigelephant-web #12).

**Implementación, después del lanzamiento, sin borrados automáticos:**
- `CP_LIFECYCLE_RETENTION_DAYS=90` (configuración, sin código);
- los tres correos de aviso;
- la orden de supresión manual con simulación, doble aprobación y registro.

Nada de esto bloquea el lanzamiento: sin la configuración de 90 días ni la orden de supresión, ninguna empresa se archiva ni se suprime sola. En la fase 5 de `PLAN_PUBLICACION.md` se anotan las empresas que ya estén en `suspended`, para que ningún archivado se haga antes de tener los avisos.
