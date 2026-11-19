# Elephant Learning: vista previa, matrícula técnica y licencia

Qué hay, cómo se usa y qué pasos protegidos quedan fuera del código. Complementa `quantum-soulrise-referencia/22-elephant-lms-informe.md`.

## 1. Curso en borrador, matrícula técnica y vista previa (sin migración)

| Pieza | Quién | Qué abre |
|---|---|---|
| Curso `published` | alumnos con matrícula vigente del módulo | su módulo (como siempre) |
| Curso `draft` (privado) | **solo** matrícula técnica; nadie más, ni con pago | los módulos concedidos |
| Curso `archived` | nadie | — |
| Vista previa de administración | administrador de la empresa | todo, sin matrícula ni progreso |

- **Matrícula técnica** = concesión administrativa cuyo motivo empieza por `[PRUEBA TÉCNICA]` (`shared/learning.ts`: `isTechnicalGrant`, `technicalReason`). Se emite con `learning.admin.grantTechnical` (panel: Formación → «Prueba técnica»): caducidad **forzosa en 1 día**, no crea invitación, no envía correo, no simula pago, no toca reglas ni productos. Una matrícula de pago o de demostración no abre un borrador, aunque lleve ese texto (el origen debe ser `admin`).
- No hace falta publicar el curso para validarlo: no hay catálogo, inscripción ni venta posibles. El borrador sigue siendo `draft`; para quien no tiene matrícula técnica, el curso **no existe** (`NOT_FOUND`).
- **Vista previa**: Formación → Cursos → «Vista previa como alumno» (`/admin/formacion/vista-previa/curso/:id`). Mismas pantallas y reproductor que `Aula.tsx` con banner «Vista previa». Procedimientos `learning.admin.previewCourse|previewLesson` (solo `adminProcedure`) y ruta `GET /api/learning/preview/resource/:id` (sesión real de administrador; 401 sin sesión, 403 otro rol; entrega privada prefirmada ≤ 300 s o streaming; `no-store`). No es un bypass reutilizable: `authorizeResource` (alumno) no cambia y la ruta del alumno sigue sin abrirse por ser administrador.
- **Auditoría**: cada curso/lección/recurso abierto en vista previa queda en `learning_access_events` con `enrollment_id = 0` y tipo `admin_preview_course|lesson|resource` (autor y detalle); se lista en Formación → «Prueba técnica». Sin progreso ni estadísticas reales.

## 2. Prueba con alumno autenticado de verdad (sin credenciales en el código)

No se implementa ninguna «sesión técnica» que fabrique una cookie de alumno desde el panel: sería un mecanismo de suplantación dentro de la autenticación global, y las contraseñas de producción no las teclea ningún agente. Procedimiento autorizado:

1. Una persona del equipo con una **dirección de pruebas propia** (no la de Indira ni la de un cliente) y cuenta del Core.
2. Admin: Formación → «Prueba técnica» → matrícula técnica del curso y módulos a probar (caduca sola en 24 h).
3. La persona entra **ella misma** con su cuenta (o activa su cuenta con el enlace normal y su propia contraseña) y recorre `/mi-formacion`.
4. Al terminar: Formación → Matrículas → «Revocar» (queda historial). Nada permanente que limpiar.
5. Además corre en CI la suite real sobre MySQL (`server/learningPreview.mysql.test.ts`): autenticación por cookie, matrícula técnica, módulos, entrega, revocación, caducidad, anonimato y aislamiento entre empresas.

## 3. Licencia (`LEARNING_LICENSE_ENFORCED`)

- Guarda tRPC (`learning.*`) y **ahora también Express** (`/api/learning/*`: recursos, vista previa, subida) en `server/_core/modules/routeGuard.ts` (`learningLicenseGuard`, montada en `server/_core/index.ts` antes del router).
- Apagada por defecto: sin la variable no cambia nada. Con `LEARNING_LICENSE_ENFORCED=1`: sin licencia `learning` → 403; licencia no verificable → 503 (se cierra).
- Dependencias para activarla sin bloquear nada: (a) Quantum **ya** tiene la licencia (concedida 19/11 desde el CRM); (b) ningún otro tenant usa el LMS (si lo usara, necesitaría licencia antes); (c) `auth.*` y el resto del Core no pasan por esta guarda.
- **Paso protegido (lo aplica el propietario/infraestructura, no el código):** variable de entorno `LEARNING_LICENSE_ENFORCED=1` en el servicio Core de Railway (producción) y redeploy. Verificación posterior: un tenant sin licencia recibe 403 en `/api/learning/resource/1` y en `learning.my.courses`; Quantum sigue respondiendo.

## 4. Despliegue

- Sin migración de esquema (se reutilizan `status`, `source`, `grant_reason` y `learning_access_events`).
- Un solo PR; la verificación en producción depende de que esté publicado (ver §5).

## 5. Plan de verificación en producción (pestaña propia de Quantum, sesión de administrador)

1. **Vista previa**: abrir `/admin/formacion/vista-previa/curso/1`; recorrer los 3 módulos y comprobar el orden de las 21 lecciones (6 + 8 + 7) y los títulos frente a `quantum-soulrise-referencia/articulate/*.json`.
2. **Los 86 recursos**: con el script `verificar-recursos-preview.js` (scratchpad) cargar cada recurso por `/api/learning/preview/resource/:id` en un `<video>`/`<audio>`/`fetch` (PDF) y registrar: estado HTTP, tipo, duración, resolución, llegada al final (seek al último segundo), tamaño PDF y cabecera `%PDF-`.
3. **Alumno autenticado**: persona del equipo con matrícula técnica (módulo 1): `/mi-formacion` → módulo 1 abre; lecciones de 2 y 3 bloqueadas; `GET /api/learning/resource/<id módulo 2>` = 403; tras «Revocar» = 403; tras caducidad = 403.
4. **Anónimo / otros tenants**: `curl` de `/api/learning/resource/1`, `/api/learning/preview/resource/1` y `learning.*` sin sesión y desde otros hosts de tenant → 401/403/404.
5. **Móvil**: vista previa en viewport 390×844 (Chrome DevTools «Device») con la misma serie de comprobaciones de lección (vídeo, audio, PDF).
6. **Estado final**: curso `draft`, 5 reglas `active = 0`, 0 matrículas comerciales (la técnica revocada queda en historial), sin correos.
