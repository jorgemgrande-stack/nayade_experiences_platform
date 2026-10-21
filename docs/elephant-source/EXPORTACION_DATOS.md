# Exportación de datos de las empresas

Estado al 21/10/2026, con las decisiones de producto del propietario incorporadas. Las que afectan a textos legales están pendientes de validación jurídica (sección 8). Código: `server/dataExport/*`, `server/routers/dataExportRouter.ts`, `server/controlPlane/relationshipExport.ts`, `server/stripe/billingPortal.ts`, pantalla `client/src/pages/admin/subscription/DataExportPage.tsx`.

## 1. Qué se entrega y cómo

| Categoría | Dónde vive | Cómo la obtiene la empresa | Automatizado |
|---|---|---|---|
| Datos operativos (todas las tablas de su base, en CSV y JSON) | BD de la empresa | Panel › Suscripción › Exportar mis datos (ZIP) | Sí |
| Ficheros (facturas emitidas, documentos, imágenes, adjuntos) | Almacenamiento de la empresa | En el mismo ZIP (`files/`) | Sí |
| Facturas de la suscripción | Stripe | Portal de facturación (solo la persona propietaria; apagado hasta activarlo) y, a petición, en el paquete contractual | Portal: sí, cuando se active |
| Contrato, pedidos, plan, documentos fiscales y tickets de soporte (mensajes públicos) | Plano de control (CRM) | A petición: paquete de relación contractual en 5 días hábiles | Generación sí; entrega manual verificada |

**No se incluye nunca:** contraseñas, tokens, claves y credenciales; sesiones; la cola técnica de correo; registros técnicos de webhooks; las notas internas de soporte. Un ZIP con ficheros que faltaban en el almacenamiento queda marcado **INCOMPLETO** (LÉEME, `manifest.json` → `complete: false`, aviso en el panel y en el correo).

## 2. Arquitectura de la exportación de datos

1. **Solicitud** (`dataExport.request`, solo la persona propietaria): solo registra una fila `pending` en `data_exports`. Límites: una en curso por empresa (índice único), **3 al día** en la aplicación (`DATA_EXPORT_DAILY_LIMIT`) y la cuota del gestor de recursos `data_export.runs` (**5 al día**).
2. **Generación** en el trabajo `data-export` (cada minuto, también en empresas suspendidas o en solo lectura) y en un primer intento inmediato tras la solicitud:
   - Se **reclama** con arriendo (`heartbeat_at`, latido cada minuto; arriendo de 5 min). Si el proceso se reinicia, el arriendo caduca y se reintenta (máximo 3 intentos); agotados, queda fallida con aviso.
   - Antes de escribir: tamaño estimado frente al máximo, cuota `data_export.bytes` (**20 GB al mes**) y espacio temporal libre.
   - El ZIP se escribe en **streaming** a `os.tmpdir()/elephant-data-export/<empresa>/<id>-<intento>/` (0700/0600), leyendo las tablas **por lotes** dentro de **una instantánea coherente** (REPEATABLE READ, solo lectura) y copiando los ficheros en flujo. La memoria no depende del tamaño de la empresa.
   - Se sube en streaming (`FileService.putFile`) como fichero privado `data-export` con propietario `export:<id>`. En un reintento se retiran antes los ZIP de intentos anteriores; si al terminar la fila ya no estaba en curso, se retira el recién subido.
   - El temporal de generación se borra siempre al terminar; los que deje un proceso caído se retiran a las 6 h.
   - Se registran en el gestor de recursos `data_export.bytes` (sin comprimir) y `data_export.ms`; en la fila, intentos, duración y bytes.
3. **Entrega:** enlace firmado de **24 h**, ligado a la empresa, con descarga en streaming; cada enlace y descarga quedan registrados. El correo («disponible» / «fallida») nunca lleva el enlace.
4. **Retirada de los ZIP a los 7 días:** el trabajo retira del almacenamiento los ZIP generados hace más de 7 días cuyo enlace ya caducó, y los restos de intentos de exportaciones fallidas.
   - Nunca retira uno con una descarga válida: se comprueba en la consulta y otra vez antes de borrar.
   - La fila se conserva con `purged_at` y la pantalla muestra «Archivo retirado».
   - Los datos y ficheros originales no se tocan.
5. **Concurrencia:** una generación a la vez por proceso (`DATA_EXPORT_CONCURRENCY`); el resto espera turno.

**Variables de entorno:**
- `DATA_EXPORT_MAX_MB`: 1024 por defecto.
- `DATA_EXPORT_MAX_MB_OVERRIDES`: excepciones por empresa, con el formato `empresa:MB,…` y un techo de 4096.
- `DATA_EXPORT_DAILY_LIMIT`: 3 por defecto.
- `DATA_EXPORT_CONCURRENCY`: 1 por defecto.
- Flag del trabajo por empresa: `data_export_job_enabled` (activo por defecto).

## 3. Migraciones necesarias (BD de cada empresa)

- `0011_data_exports` (registro), `0012_data_export_jobs` (trabajo asíncrono) y `0013_data_export_purge` (fecha de retirada). Las tres son aditivas (columnas nulas o con valor por defecto e índices) y tienen reversión.
- Sin 0011 la pantalla dice «aún no disponible»; sin 0012 o 0013, «pendiente de una actualización de la base de datos».
- **Estado en producción: no verificado.** No se presupone aplicado.
- El procedimiento completo, con copia, simulación, aplicación, verificación (`backup-job check-data-exports`) y reversión, está en `docs/elephant-source/PLAN_PUBLICACION.md` (fases 2 y 3).

## 4. Exportaciones de más de 1024 MB

1. La empresa ve el fallo «supera el tamaño máximo… pídela a soporte».
2. Soporte verifica que la petición viene del correo de la persona propietaria (`company_owner_email`).
3. Operaciones añade la excepción `DATA_EXPORT_MAX_MB_OVERRIDES=<empresa>:<MB>` (hasta 4096) en el servicio del Core, con registro en el ticket, y pide a la empresa que la solicite de nuevo.
4. Tras la descarga, se retira la excepción.
5. Por encima de 4096 MB: entrega desde la copia de seguridad de la empresa (`backup-job`), por un canal acordado; la decisión es del responsable de datos.

## 5. Documentación de la relación contractual (procedimiento verificable, máximo 5 días hábiles)

1. La persona propietaria escribe al contacto de soporte con el asunto «Documentación contractual». La pantalla lo indica, con el plazo.
2. Soporte abre un ticket el mismo día y comprueba que el remitente es el `company_owner_email` de la empresa. Si no lo es, pide que escriba la persona propietaria; el plazo empieza cuando llega la petición válida.
3. Operaciones genera el paquete: `GET /cp/v1/tenants/<empresa>/relationship-export?requestedAt=<fecha de la petición válida>`, con un token que tenga `billing:read` y `tickets:read`.
   - `request.deadline` da la fecha límite: **5 días hábiles con el calendario laboral de Madrid** (`server/controlPlane/madridCalendar.ts`): de lunes a viernes, sin festivos nacionales, autonómicos ni locales (Madrid capital). El día de recepción no cuenta; las fechas se toman en hora de Madrid; vence al final del quinto día. Fuentes: Decreto 75/2025 (2026) y Decreto 82/2026 (2027) de la Comunidad de Madrid y fiestas locales del Ayuntamiento. Las fiestas aún no publicadas oficialmente (las locales de 2027) cuentan como hábiles (plazo igual o más corto) y el paquete las lista en `provisionalIgnored`; en ese caso `request.status` es `requires_review`: el plazo **no se da por confirmado** hasta que una persona lo compruebe con la fuente oficial y lo anote en el ticket. Con `confirmed`, solo se han usado fechas oficiales. Sin calendario cargado para un año, el cálculo se niega (error 409): hay que añadir ese año con su fuente.
   - `complete`/`sources` indican si falta alguna fuente; un paquete incompleto nunca se entrega como completo.
4. Entrega antes de `deadline` por un canal acordado; nunca como adjunto de un correo sin cifrar si contiene datos personales.
5. En el ticket queda constancia de:
   - la fecha de la petición y la verificación del remitente;
   - la fecha límite y, si era `requires_review`, quién la revisó y con qué fuente;
   - la fecha y el canal de entrega;
   - las fuentes incluidas.

## 6. Acceso y caducidad (comportamiento probado en `server/dataExport.policy.test.ts`)

| Fase | Estado de la empresa | ¿Puede exportar? |
|---|---|---|
| Prueba, activa, gracia | trial / active / grace | Sí |
| Impago agotado o suscripción terminada | suspended (panel en solo lectura) | Sí: pedir y descargar son las únicas escrituras permitidas |
| Fin de los 30 días de solo lectura | suspended; el motor cancela las licencias (`read_only_end`) | **Sí, hasta el archivado**, con aviso en el panel y en el correo «Ha terminado el periodo de solo lectura» |
| Archivada por un operador | archived / deleting / deleted | No (410) |

No hay corte automático ni borrado automático de datos. Solo se retiran los ZIP generados, que son copias, a los 7 días. Los plazos de archivado (90 días) y supresión (180 días), adoptados provisionalmente y pendientes de validación jurídica, están en `CICLO_VIDA_TENANT.md`.

## 7. Portal de facturación de Stripe (solo la persona propietaria)

- **Core:** `subscription.billingPortalStatus` y `subscription.billingPortal`, solo para la persona propietaria.
- **Plano de control:** `POST /cp/v1/commerce/tenants/:id/billing-portal`, con el token de comercio ya existente.
- **Apagado** salvo que se definan `CP_BILLING_PORTAL_ENABLED=1` y `CP_BILLING_PORTAL_CONFIGURATION=bpc_…`. Esta segunda es una configuración CONCRETA del portal que se relee en Stripe en cada apertura.
  - Se rechaza (alerta `stripe.portal_unsafe`) si permite cambiar o cancelar el plan o editar datos de facturación.
  - Solo permite el historial de facturas y el método de pago: sin cobros ni cambios desde el portal.
  - Checkout sigue apagado.
  - El planificador de configuración (`server/stripe/portal.ts`) propone exactamente esa configuración restringida: nunca cambios de plan ni cancelaciones. La configuración por defecto que hoy existe en Stripe permite cancelar, así que hay que crear una configuración nueva restringida y usar su identificador.
- **Cliente de Stripe:** el enlazado a la empresa en el CRM. La vuelta solo se admite a un dominio activo de esa empresa.
- Hasta que haya cobros con Stripe, ninguna empresa tiene cliente en Stripe y el portal responde «aún no tiene facturas».

## 8. Coherencia con los textos legales (pendiente de validación jurídica; nada publicado)

Los textos aprobados del repositorio web dicen cosas que ya no coinciden con estas decisiones:

| Texto | Dice | Implementado / decidido |
|---|---|---|
| Términos §12, Cancelaciones §3, Privacidad (tabla de plazos) | Pasados los 30 días de solo lectura «los suprimimos» | No hay borrado automático; la exportación sigue disponible hasta el archivado, que es manual |
| Términos §12 | «El administrador puede descargar…» | Solo la persona propietaria |
| Cancelaciones §2 | Cancelar y reactivar «desde el portal de cliente» | El portal preparado solo permite facturas y método de pago |
| Términos §8 | Facturas «disponibles en el portal de cliente» | Coherente cuando se active el portal |

Hay una propuesta de redacción en un borrador del repositorio web, sin fusionar ni publicar.

## 9. Decisiones

**Adoptadas por el propietario e implementadas:**
- exportación disponible hasta el archivado tras los 30 días, con avisos;
- enlaces de 24 h y retirada de los ZIP a los 7 días;
- documentación contractual en 5 días hábiles;
- portal de facturación solo para la persona propietaria, preparado pero sin activar;
- límites: 3 solicitudes al día en la aplicación, y 5 al día y 20 GB al mes en el gestor de recursos.

**Pendientes:**
1. **Despliegue:** token de proyecto de Railway y entornos protegidos de GitHub (`PLAN_PUBLICACION.md`, fase 0).
2. **Textos legales:** validar la nueva redacción (sección 8) antes de publicar.
3. **Portal:** crear en Stripe la configuración restringida (solo facturas y método de pago) y anotar su identificador.
4. **Calendario laboral:** añadir cada año (y confirmar las fiestas locales de 2027 cuando se publiquen) antes de que haga falta.
5. **Ciclo de vida:** plazos de archivado y supresión (`CICLO_VIDA_TENANT.md`).
