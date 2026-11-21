# Elephant Learning: qué está copiado y cómo recuperarlo (comprobado 21/11/2026)

Comprobación con la acción ordinaria de solo lectura `verificar-copia` (production, run 44884673068, SHA 2310761b).

## Base de datos (curso, estructura, matrículas)
Una sola copia lógica por empresa contiene todas las tablas `learning_*`: curso, módulos, lecciones, bloques, recursos
(registros y su relación con bloques y lecciones), matrículas, progreso, reglas de acceso y eventos.
- Quantum (`tenants/t12-quantum-soulrise`): 4 objetos en las últimas 24 h, el último 2026-11-21 08:17 UTC (1,80 MB), cada 15 min.
- Cifrada (AES-256-GCM), manifiesto firmado, verificada por SHA-256 al subir. Retención 30 diarias / 12 semanales / 12 mensuales.
- Registro del plano de control y CRM también copiados el mismo día.

## Ficheros (vídeo, audio, PDF)
- Quantum tiene 107 ficheros / 16 GB de Learning en el bucket de medios. `BACKUP_MEDIA=1` está configurado en `backup-job`.
- `files/t12-quantum-soulrise` figura actualizado hoy (índice cifrado, 0,10 MB).
- **No verificado:** que cada uno de los ficheros esté realmente replicado en `files/<empresa>/objects/`. `verificar-copia` solo
  lista lo escrito en las últimas 24 h y no enumera ni compara objetos. Se necesita una ejecución protegida de simulacro
  (`restore-files t12-quantum-soulrise --out <dir>`, que comprueba el SHA-256 de cada fichero) con autorización expresa.
- Hueco conocido: la réplica solo añade (sin versiones ni retención) y el destino secundario externo no está contratado:
  una pérdida de la cuenta de Railway no estaría cubierta.

## Recuperar el curso
Ver `BACKUPS_Y_RECUPERACION.md` §7 (restauración individual en base nueva + `--switch`) y §12 (`restore-files`).

## Simulacro de recuperación de ficheros (EJECUTADO y verificado el 21/11/2026)
**Hallazgo (21/11/2026):** el procedimiento protegido existente NO permite `restore-files`: la lista cerrada del drill
(`DRILL_ALLOWED`) excluye restauraciones salvo `restore-tenant`. Además `restore-files --out` escribe los 16 GB en el disco del
contenedor. Por eso se preparó una orden de **solo comprobación**: `verify-files <empresa>`.

**Qué hace:** lee el índice cifrado `files/<empresa>/index.json.enc`; para cada objeto de la réplica lo descarga, lo descifra EN
MEMORIA y compara su SHA-256 y tamaño con el índice. No escribe ningún fichero (ni disco ni bucket de medios), no toca los originales
ni la base de production. Un fallo no detiene el resto: informa de todos. Anota la comprobación en `backup_restores` (registro de
copias). Salida en LÍNEAS CORTAS (desde 21/11): `VERIFY-FICHEROS RESUMEN empresa= origen= ficheros= bytes= fallos= digest=`, una línea
`VERIFY-FICHEROS ENTRADA<TAB>ok|fallo<TAB>bytes<TAB>sha256<TAB>clave` por objeto y, si procede, `VERIFY-FICHEROS MOTIVO`. Al terminar el proceso
imprime `FIN-ORDEN codigo=N` (código real de salida, también tras un fallo). Código 1 si hay fallos.

**Incidencia del primer intento (21/11/2026, ejecución 44915427713) y corrección.** El paso terminó en SUCCESS sin resultado: Railway da el
despliegue por SUCCESS al *arrancar* el contenedor (reinicio NEVER), no al terminar la orden; el flujo esperaba 20 s fijos, leía el
registro y devolvía el reposo (`list`) con un redespliegue, que mató la verificación a los ~54 s (despliegue `854087b2`: solo «Starting
Container» y «Stopping Container»). Ni se verificó ni se detectó ningún fallo: ese intento NO cuenta como verificación. Corrección:
- `verify-files` se espera hasta ver `FIN-ORDEN codigo=N` al principio de línea (consulta cada 15 s; máximo 45 min).
- Código distinto de 0: el paso falla y se conserva el registro impreso.
- Sin marca en 45 min: el paso falla y NO se redespliega el reposo (la orden podría seguir ejecutándose; revisar el despliegue en Railway).
- El flujo recalcula la salida (recuento de objetos, suma de bytes, fallos, digest = sha256 de las líneas `clave:sha256` ordenadas) y
  no da el resultado por bueno si algo no cuadra: imprime `verify-files: COMPROBADO|NO COMPROBADO · objetos= bytes= fallos= digest=`.

**Operación exacta (así se ejecutó; repetible):**
1. Fusionar el PR de la herramienta y publicarlo (cambia `scripts/deploy/`, el flujo y el backup-job: es un cambio protegido).
2. `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=production -f action=desplegar-restore-drill -f confirm=production -f commit=<SHA>`
   (la imagen del drill debe contener `verify-files`).
3. `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=production -f action=verificar-ficheros -f only=t12-quantum-soulrise -f confirm=production`
   (acción protegida: entorno con aprobación; nunca está entre las ordinarias).

**Criterios de verificación (independiente):** (a) `FIN-ORDEN codigo=0` y «COMPROBADO» con `fallos=0`; (b) `learning-content/` = 107 objetos y
16.675.549.787 B (el total de la empresa incluye además `media/` y `_meta/`); (c) los 86 recursos de `learning.admin.materials.list`
coinciden por `objectId`, SHA-256 y tamaño, y los objetos restantes son los huérfanos de `storage.reconcile`; (d) digest guardado para comparar
simulacros futuros.

**Resultado del simulacro (21/11/2026): VERIFICADO.** Ejecución protegida 44923273875 (`verificar-ficheros`, `only=t12-quantum-soulrise`,
imagen de restore-drill con `4646129c`, PR #923), 41 min 50 s, solo lectura. Registro: `FIN-ORDEN codigo=0` y
`verify-files: COMPROBADO · objetos=308 bytes=16717089249 fallos=0`. Digest del conjunto completo (sha256 de las líneas `clave:sha256`
ordenadas, recalculado por el flujo): `1378f5dc5a8f72a2d5c80ef179939f61c51039ff0098bdd4da5ad38e948a51d5`.

| Prefijo de la réplica | Objetos | Bytes | Qué es |
|---|---|---|---|
| `learning-content/` | 107 | 16.675.549.787 | materiales de Elephant Learning (RECONNECT y repetidos) |
| `media/` | 47 | 41.447.199 | imágenes y PDF del CMS |
| `_meta/` | 154 | 92.263 | JSON auxiliares |
| **Total** | **308** | **16.717.089.249** | 0 fallos de descarga, descifrado, SHA-256 o tamaño |

Las cifras de referencia «107 objetos / 16.675.549.787 B» son las de `learning-content/`, que coinciden exactamente; el total de la
réplica de la empresa es mayor porque incluye medios del CMS y sidecars.

**Cruce con la base de datos y `storage.reconcile` (solo lectura, 21/11/2026):**
- Los 86 recursos de `learning.admin.materials.list` tienen su objeto en la réplica por `objectId`, con **SHA-256 y tamaño idénticos** (86/86; 0 distintos).
- Los 107 objetos tienen 85 hashes distintos; los 86 recursos también (un mismo contenido está referenciado por dos recursos).
- Los 21 objetos sin recurso son exactamente los 21 huérfanos de `storage.reconcile` (107 objetos, 86 referenciados, 21 huérfanos,
  2.516.453.419 B): los 21 existen en la réplica con el mismo hash y tamaño, y **los 21 son copias exactas de un contenido ya referenciado**
  (`sameHashAsReferenced`). Nada que recuperar de ellos; siguen SIN eliminar (la limpieza requiere autorización expresa).
- `storage.reconcile` informa de `planHash` `2a049d23e50ca0baaa6962407dc3058d901e3f32807411c9ec8a1730c075dcab`, `missing=0`, `protected=0`.
  (Media: 44 objetos en el proveedor frente a 47 en la réplica; sin relación con Learning.)

**Primer intento (ejecución 44915427713) NO válido:** véase la incidencia más abajo. No dejó resultado.

## Análisis de los 24 ficheros repetidos de Quantum (21/11/2026, solo lectura)
Medido con `storage.reconcile` (categoría `learning-content`) desde el panel de la propia empresa, sin cambios:
| Concepto | Resultado |
|---|---|
| Objetos de Learning | 107 (16.675.549.787 bytes) |
| Referenciados por recursos | 86 (= los 86 recursos) |
| **Huérfanos** (cero referencias) | **21** · 2.516.453.419 bytes (2,34 GB) · todos subidos el 19/11 entre 08:56 y 09:32 UTC |
| Huérfanos idénticos a uno en uso | 21 de 21 (10 contenidos distintos: 9 repetidos dos veces y 1 tres veces) |
| **Recursos compartidos** (un mismo objeto usado por varios recursos) | 0 |
| **Duplicados físicos entre objetos en uso** | 3 objetos extra (~3 MB): contenido idéntico en recursos distintos que subieron su propia copia |
| Faltan en el almacén | 0 |
| Total de «24 repetidos» (13 grupos) | 21 huérfanos + 3 duplicados físicos en uso = 24 · 2.519.510.665 bytes |
Conclusión: los 21 huérfanos son reenvíos de subidas del 19/11 (misma huella que el fichero vigente). Liberarlos recuperaría 2,34 GB
(Learning pasaría de ~15,5 GB a ~13,2 GB usados). Requiere el procedimiento protegido (`reconcileApply` con `planHash`, copia
verificada previa); **no se ha eliminado nada**. Los 3 duplicados en uso no se tocan: unificarlos exigiría que dos recursos
compartan un objeto (biblioteca multimedia con reutilización, lote 3).

## Copia externa independiente de Railway (fase futura, no implementada)
Hoy las copias (BD cifrada y réplica de ficheros) viven en el bucket del mismo proyecto de Railway: una pérdida de cuenta o de
proyecto las arrastraría. Estrategia propuesta, por orden:
1. **Contratar un segundo destino** (S3 compatible en otro proveedor y otra cuenta, p. ej. R2/B2/AWS) y activarlo con el
   mecanismo ya implementado y probado en contenedores (`BACKUPS_Y_RECUPERACION.md` §16: segundo destino, `backup_copies`).
2. **Ficheros**: réplica incremental cifrada al secundario (16 GB hoy, hasta el cupo de 25 GB por empresa); clave de copias
   guardada fuera de Railway (rotación: §13). Versionado del bucket de destino para recuperar borrados.
3. **Simulacro programado** trimestral de restauración desde el secundario en un entorno aislado (§16.6), con informe de hashes.
4. **Objetivos**: BD cada 15 min (RPO 15 min); ficheros diarios (RPO 24 h); RTO 4 h. Alertas `backup.secondary_stale`.
5. Antes de contratar: decisión del propietario sobre proveedor, región (UE) y coste (`estimate`, §18).
