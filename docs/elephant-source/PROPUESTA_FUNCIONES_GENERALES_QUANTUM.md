# Propuesta: funciones generales surgidas en Quantum Soulrise (16/11/2026)

Documento de diseño. No cambia código ni despliega nada. Cada función es reutilizable por cualquier empresa y nace apagada por defecto. El orden es el de prioridad propuesta.

## 0. Antecedente: incidencia de avisos de prueba (16/11/2026)

Dos solicitudes de prueba (leads 3 y 4 de Quantum Soulrise, marcadas «PRUEBA TECNICA») generaron avisos internos reales al correo configurado de la empresa. El registro de comunicaciones los muestra como `sent` por Brevo. La causa fue suponer, sin comprobarlo, que la política de correo de production lo impediría. No hubo comunicación al cliente final. Falta una forma segura de probar formularios y CRM sin salidas externas.

## 1. Modo de prueba de formularios y CRM sin notificaciones externas (prioridad 1)

**Objetivo:** que personal autorizado pruebe el circuito de solicitud (formulario → lead → inscripción → CRM) sin que salga ningún correo, aviso ni webhook.

**Diseño**
- **Quién puede activarlo:** solo una sesión autenticada de administrador del tenant, incluida la sesión de soporte con modificación. Nunca un visitante: el indicador no viaja en el cuerpo público de la solicitud.
- **Mecánica:** nuevo procedimiento autenticado `crm.leads.submitTest` (o un token firmado de corta vida emitido por un procedimiento de administrador y ligado a la sesión y al tenant). Reutiliza `processProductRequest`, pero con un contexto que marca el lead con `is_test = 1` y **omite**:
  - `notifyOwner` (aviso interno),
  - correos automáticos y programados,
  - integraciones salientes (webhooks, pixel, CAPI).
- **Trazabilidad:** el lead de prueba lleva la etiqueta «Prueba» visible en el CRM, queda registrado quién lo creó y se excluye de métricas, embudos y recuentos de plazas. Una anotación de auditoría registra «aviso suprimido por modo de prueba».
- **No bloquea lo legítimo:** el camino público no cambia. Un visitante que envíe `isTest` en el JSON lo ve ignorado (esquema estricto) y el aviso sale como siempre. Prueba de regresión.
- **Defensa en profundidad:** el modo de prueba además comprueba que el correo del solicitante use un dominio reservado (`.invalid`, `.example`, `.test`) o esté en una lista de pruebas del tenant.
- **Interruptor:** capacidad por tenant, apagada por defecto, activable desde el panel.
- **Pruebas:** (1) el público no puede activar el modo; (2) con sesión de administrador el aviso no se encola y consta la anotación; (3) las métricas excluyen los leads de prueba; (4) una solicitud legítima sigue avisando.
- **Migración:** aditiva (`leads.is_test TINYINT NOT NULL DEFAULT 0`).

## 2. Campos estructurados de idioma, modalidad y precio en CRM (prioridad 2)

Hoy van en el texto del lead. Propuesta: columnas en `leads` y `edition_enrollments`: `request_lang` (varchar 5), `variant_id`, `variant_label`, `shown_price` (decimal) y `shown_currency`. Se rellenan en `processProductRequest` desde la BD (nunca desde el navegador). Filtros y columnas en la bandeja de CRM, y exportación. Migración aditiva y nullable; sin retrocarga obligatoria.

## 3. Idioma principal configurable por tenant (prioridad 3)

Hoy el idioma principal está fijado a `es`. Propuesta: `cms.i18nSetDefaultLocale` con comprobaciones (existe traducción validada de las páginas publicadas, o se avisa de los huecos), vista previa y reversión. Cambia el idioma que se sirve sin sufijo y el de los correos del tenant. Requiere el punto 4 para no romper enlaces. Apagado por defecto.

## 4. Redirecciones 301 (prioridad 3, dependencia del punto 3)

Tabla `site_redirects` (origen, destino, código 301/302, activo, contador, fecha) con administración en el panel, importación en bloque, detección de bucles y cadenas, y límites. Resolución en la capa pública antes del 404. Registro de cambios. Pensada para renombrar slugs de producto y páginas sin perder posicionamiento, y para el plan de `yoga-soulretreat.com` → `quantumsoulrise.com` (que sigue sin ejecutarse hasta aprobación conjunta).

## 5. Formación digital con acceso individual (prioridad 4)

Resumen del diseño ya descrito en `quantum-soulrise-referencia/14-auditoria-articulate.md`:
- Producto digital con contenido asociado y duración de acceso (permanente, N días, hasta fecha).
- Matrícula (persona, producto, modalidad, convocatoria, estado, inicio, caducidad, origen del pago, quién la concedió).
- Liberación solo con estado `paid` verificado en servidor, manual al inicio.
- Contenido privado con vídeo servido por enlaces firmados de vida corta tras comprobar la matrícula.
- Área del alumno reutilizando Comunidades.
- Caducidad, revocación y renovación con trazabilidad; reembolso revoca.
- Progreso por persona: mejora posterior (SCORM/xAPI/cmi5 o propio).
**Bloqueo previo, no técnico:** derechos de los materiales de Articulate. No empezar hasta aclararlos.

## 6. Caducidad automática de variantes (hecho)
Publicada en #843 (migración 0072): `experience_variants.validUntil`, comparación en `Europe/Madrid`, inclusiva.

## Coordinación
Ninguna de estas funciones se fusiona mientras haya otra publicación en curso. Cada una va en su PR, con migración aditiva y prueba, sin interruptores bloqueados ni cambios de cobro o autorización.

## Orden de implementación y coordinación de migraciones

Un PR por función, en serie, nunca dos publicaciones a la vez y sin fusionar mientras otra sesión publica (se pregunta antes). El número de cada migración se asigna al fusionar (siguiente libre en `db/migrations`; el registro de plataforma, `db/registry`, es de otra ventana y no se toca desde aquí).

| Orden | PR | Contenido | Migración de empresa | Dependencias |
|---|---|---|---|---|
| 1 | Campos estructurados del CRM + modo de pruebas | `leads`/`edition_enrollments`: idioma, modalidad, precio mostrado; `leads.is_test`; procedimiento autenticado de prueba | una aditiva con todas las columnas nuevas | ninguna |
| 2 | Gestor de redirecciones 301 | tabla `site_redirects`, administración, resolución en la capa pública | una aditiva (tabla nueva) | ninguna |
| 3 | Idioma principal configurable | cambio de idioma principal con comprobación de traducciones y reversión | ninguna prevista (ajuste de configuración) | 2 (redirecciones al cambiar de URL) |
| 4 | Formación digital con matrícula y acceso individual | producto digital, matrícula, contenido privado con vídeo, área del alumno, caducidad y revocación | varias aditivas | derechos de Articulate (no técnico) |

### Quantum Soulrise
- Idioma principal: alemán; español e inglés secundarios (francés, apagado). Se aplica cuando exista la función 3 y estén validadas las traducciones; no antes.
- RECONNECT ONLINE: una única formación de tres módulos con tres meses de acceso (función 4). No se migra ningún material de Articulate hasta resolver los derechos y la disponibilidad de los originales.
- Los diseños actuales de la web se conservan y las compras públicas siguen desactivadas.
