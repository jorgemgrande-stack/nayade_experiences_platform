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

## Simulacro de recuperación de ficheros (preparado, NO ejecutado)
Es una operación protegida (`drill` con `restore-files`); no se ha lanzado. Solicitud que habría que autorizar, y nada más:
1. Restaurar `t12-quantum-soulrise` con `restore-files t12-quantum-soulrise --out <directorio aislado del runner>`: escribe en un
   directorio temporal del trabajo, **nunca** en el bucket de medios ni en la base de production.
2. El propio comando descarga cada objeto de `files/t12-quantum-soulrise/objects/`, lo descifra y comprueba su SHA-256 contra el
   índice. Resultado esperado: 107 ficheros (86 referenciados + 21 sin referencias), 16.675.549.787 bytes.
3. Segunda comprobación independiente: comparar los 86 hashes con `learning_resources.sha256` de la base (lectura).
4. El directorio se destruye al terminar el trabajo. No se borra ni se sobrescribe nada de production.

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
