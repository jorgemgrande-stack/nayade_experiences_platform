# Referencias de contrato: `CT-AAAA-NNNNNN` — análisis y decisión propuesta (D5)

**Estado:** análisis para decidir. **No se ha cambiado nada.** Corresponde a la decisión D5 de `docs/roadmap/FASE5_INTEGRACION.md`.

## 1. Situación actual (verificada)

| Pieza | Formato | Dónde |
|---|---|---|
| Contratos creados por el código | `CT-AAAA-NNNNNN`: año UTC del momento de creación e id con 6 dígitos (sin truncar) | `server/crm/service.ts` → `contractReference()`, ramas #68 y siguientes |
| Contratos que ya existían al aplicar la migración (relleno) | `CT-NNNNNN`: sin año | `db/crm/migrations/0002_crm_contracts_v2.sql` → `CONCAT('CT-', LPAD(id, 6, '0'))` |
| Documentación (README de migraciones, tipos) | `CT-AAAA-NNNNNN` («rellena las existentes») | contradice al SQL |

**Datos reales:**

- **Producción:** no existe base de datos del CRM. El plano de control no está desplegado (B12), así que la 0002 no se ha aplicado en ningún entorno real.
- **Entorno local de desarrollo (`be_dev_crm`):** 17 contratos, **todos** en `CT-AAAA-NNNNNN`, porque se crearon con el código después de la 0002. No hay ningún `CT-NNNNNN`.
- **Uso de la referencia:** es **opaca**. Se muestra (CRM: ficha de empresa, lista y detalle de contratos), se busca (`includes`), se escribe en notas de actividad («Contrato X creado») y es única (`uq_contract_reference`). **Ningún código la interpreta ni extrae el año o el número.**
- **No sale de Big Elephant:** no hay documentos, facturas ni correos emitidos con esa referencia. La facturación está apagada y la firma electrónica no existe.

## 2. Problemas detectados

1. **Dos formatos para la misma columna.** Si la 0002 se aplicara sobre una BD con contratos previos, esos quedarían como `CT-000012` y los nuevos como `CT-2026-000013`. Cualquier integración futura (facturación con `crm_contract_ref`, documentos, búsquedas por patrón) tendría que aceptar los dos.
2. **`LPAD` trunca.** A partir del id 1.000.000, `LPAD(id, 6, '0')` corta el número: `LPAD(1234567, 6, '0')` = `123456`. Eso provoca colisiones con la clave única y un fallo de la migración. El código (`padStart`) no trunca. Hoy no ocurre (ids pequeños), pero es un defecto.
3. **Asignación en dos pasos.** El contrato se inserta con `reference = NULL` y después se actualiza, sin transacción. Si la segunda escritura falla, queda un contrato sin referencia. No es exclusivo del formato, pero conviene corregirlo a la vez.

## 3. Opciones

| | Opción | Consecuencias |
|---|---|---|
| **A** | Dejar la 0002 como está (`CT-NNNNNN` para los existentes) | Sin trabajo. Mantiene dos formatos para siempre y el defecto de `LPAD`. |
| **B (recomendada)** | **Corregir la 0002 antes de aplicarla en ningún entorno real:** el relleno genera `CT-<año UTC de created_at>-<id con al menos 6 dígitos>`, igual que el código | Un único formato desde el principio. Es determinista: la misma BD produce siempre las mismas referencias, equivalentes a las que el código habría asignado. No modifica ninguna referencia existente, porque el relleno solo toca `reference IS NULL`. **Única consecuencia:** el checksum de la 0002 cambia, así que las BD locales de desarrollo y prueba donde ya se aplicó hay que recrearlas o resolverlas a mano (ver §4). |
| **C** | Dejar la 0002 y añadir una 0006 que reescriba `^CT-[0-9]{6}$` a `CT-AAAA-NNNNNN` | No toca ficheros aplicados, pero **modifica referencias existentes**. La reversión es ambigua y es un cambio irreversible sobre datos. Solo tendría sentido si la 0002 ya se hubiera aplicado en un entorno real con contratos previos, y no es el caso. |

## 4. Plan de compatibilidad de la opción B (pendiente de autorización)

1. **Cambio del SQL de la 0002**, en su PR de origen (#68) y propagado a la pila:
   ```sql
   SET time_zone = '+00:00';
   UPDATE crm_contracts
      SET reference = CONCAT('CT-', YEAR(FROM_UNIXTIME(FLOOR(created_at / 1000))), '-', IF(id < 1000000, LPAD(id, 6, '0'), id))
    WHERE reference IS NULL;
   ```
   - `created_at` es `BIGINT` en milisegundos (`db/crm/0000_crm.sql`).
   - Fijar la zona horaria a UTC iguala el año al de `contractReference()`.
   - El `IF` evita el truncado.
2. **Asignación atómica en el código:** insertar el contrato y fijar su referencia dentro de una transacción. Si falla, no queda contrato sin referencia.
3. **Prueba con MySQL real:**
   - una BD con contratos previos a la 0002 en varios años y con ids menores y mayores de 1.000.000;
   - aplicar la migración;
   - comprobar el formato, la unicidad y la igualdad con `contractReference(id, created_at)`;
   - comprobar que la reversión y la nueva aplicación son idempotentes.
4. **BD ya migradas** (solo locales: `be_dev_crm` y los contenedores de prueba). El ejecutor detectará el cambio de checksum y se detendrá, que es lo correcto. Para estas BD:
   - los contratos existentes ya están en `CT-AAAA-NNNNNN`, así que no hay nada que convertir;
   - se actualiza el checksum registrado de la 0002 en su tabla de registro, con un procedimiento documentado y solo en local.

   Ninguna BD real se ve afectada.
5. **Documentación:** el README de migraciones del CRM ya describe `CT-AAAA-NNNNNN`. Hay que añadir la regla del año (UTC de `created_at` para los rellenos y momento de creación para los nuevos).

## 5. Qué no se hace sin autorización

- Ninguna de las opciones se ha implementado.
- No se modifica ninguna referencia existente.
- No se edita la 0002 hasta que se decida D5.
