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
