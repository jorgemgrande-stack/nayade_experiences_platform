# Informe de resultados — cuarto overnight de Big Elephant Admin

**Fecha:** 25/10/2026
**Encargo:** resolver el máximo del 22 % pendiente tras la fase 3, más la unificación visual de la experiencia del cliente y la incidencia de los accesos de Skibox.
**Registro de trabajo:** [OVERNIGHT_FASE_4.md](OVERNIGHT_FASE_4.md).
**Guía de pruebas humanas:** [GUIA_PRUEBAS_HUMANAS.md](GUIA_PRUEBAS_HUMANAS.md).

**Cómo leer este informe:** fusionado, publicado en live y publicado en production se indican por separado. «Verificado» solo se usa cuando lo comprobé con la API real, el navegador o los registros de una ejecución.

**Estado final (25/10/2026):**
- Toda la fase 4 está publicada en production: commit `58ac43d6`, ejecución aprobada 40172036024.
  - Copia previa y migraciones 0014 (registro) y 0015 (las siete empresas) aplicadas.
  - Plano de control, Core y pasarela desplegados.
  - Salud en 200.
- Verificado en production:
  - las rutas nuevas responden 401 sin sesión;
  - la identidad de Big Elephant aparece en las pantallas de acceso de Skibox (escritorio y móvil, capturas);
  - el aviso de cookies ya está corregido.

---

## 1. Avance

**Avance del encargo original: 86 %**, frente al 78 % de partida.

- Solo cuenta lo terminado, publicado y comprobado.
- Todo el desarrollo de la fase está verificado en **live**, con 16/16 comprobaciones funcionales.
- Está publicado en **production**, donde he comprobado el despliegue, las migraciones, la protección de las rutas nuevas y la identidad visual.
- Las pantallas nuevas del CRM sobre datos reales de production requieren una sesión de operador con MFA: van en la guía de pruebas humanas.

## 2. Desarrollos

| Área | Qué se ha hecho | PR |
|---|---|---|
| Integraciones | Comprobación real de solo lectura con resultado claro: conectada, credenciales rechazadas, error o no comprobada. Comprobaciones disponibles: GHL, VAPI y Meta por HTTP; IMAP inicia sesión sin leer mensajes; SMTP se verifica sin enviar; Redsys se valida en local. El estado queda registrado en la base de cada empresa (migración 0015). La ficha muestra última comprobación y sincronización, último error, incidencias de 90 días, capacidades y «Comprobar ahora» (con motivo y auditoría). Cuentan como sincronización la lectura de buzones y los webhooks válidos de GHL y VAPI | #350, #356, CRM #63 |
| Módulos | Estado técnico real por empresa: versión, origen, compatibilidad, dependencias, migraciones aplicadas y pendientes, errores de carga y módulos obsoletos. Se separan cuatro capas: instalado, habilitado, contratado y comercializable. Sin datos del Core, la ficha dice «sin datos» y nunca «instalado» | #352, CRM #64 |
| Resource Manager | Tarifas editables con versión e historial (registro 0014); mientras no se configuren, sigue la estimación declarada. Además: anomalías (picos y caídas frente a 14 días), estado de la medición por empresa, exportación CSV y política de exceso de cuota (la suspensión nunca es automática). Almacenamiento ocupado y correo de 30 días calculados por empresa | #353, CRM #64 |
| Ciclo de vida | Ciclo completo probado en live. **Fallo corregido:** con la empresa suspendida, el panel no cargaba. Suspender, archivar o borrar exige ahora un motivo | #354 |
| Ficha 360° | El esquema indica «al día» o cuántas migraciones faltan | CRM #64 |
| Comercial | Circuito completo probado en live. **Fallo corregido:** el día del cambio de hora, los informes perdían lo creado entre las 00:00 y las 01:00 | #355 |
| Estabilidad | La prueba de informes calculaba «hoy» en UTC | #351 |
| Correo de acceso | Ámbito por empresa y tipo; tres defectos de seguridad de las invitaciones corregidos; la invitación sale por correo tras el alta sin mostrar el enlace al operador; activación limitada y consulta de entregas en production | #344, #347, #348, #357, CRM #61, #62 |
| Identidad visual | Ver sección 4 | #358 |

## 3. Publicación

| Componente | GitHub | Live | Production |
|---|---|---|---|
| Correo de acceso (#344–#348) | Fusionado | Verificado | Core #344 desplegado (`55451c2d`). #347 y #348 solo afectan al alta y a las herramientas de despliegue; pendientes de la aprobación siguiente |
| Activación del correo de Skibox | — | — | **Verificado** (ejecución 40141253411) |
| Integraciones, módulos, Resource Manager, ciclo de vida e informes (#350–#357) | Fusionado | **Verificado** (16/16 comprobaciones) | **Publicado** (40172036024): migraciones 0014 y 0015 aplicadas; rutas protegidas (401 sin sesión) |
| Identidad visual (#358, #359) | Fusionado | **Verificado** (capturas en escritorio y móvil con dos empresas de prueba) | **Verificado** (capturas de Skibox en escritorio y móvil) |
| Pantallas del CRM (#61–#64) | Fusionado | Publicado | Publicado por la publicación ordinaria. Las de la fase 4 muestran «sin datos» hasta que el Core de production tenga sus rutas |

**Aprobaciones:** ninguna pendiente. La publicación de la fase 4 (40172036024) se aprobó y terminó correctamente.

## 4. Unificación visual (#358)

**Diagnóstico.** Una empresa sin marca heredaba los colores de Náyade: azul en claro y **naranja** en oscuro, y el panel arranca en oscuro. Por eso Primeros pasos y «Acceso restringido» salían en naranja. «Establecer contraseña» tenía un azul fijo, sin logotipo y con otro armazón. Tras establecer la contraseña se caía en «Acceso restringido».

**Cambios:**
- **Un solo sistema de tokens.** Se aplica en un único sitio, en modo claro y oscuro: Big Elephant (rojo corporativo, grafito y blanco) hasta que la empresa configura su marca; después, la de la empresa. Si su color no se lee (contraste menor de 3:1), se usa grafito neutro. Náyade no cambia.
- **Pantallas de acceso:** «Establecer contraseña» usa el mismo armazón que el acceso, la recuperación y la nueva contraseña, con el logotipo oficial. Al terminar se inicia sesión con el inicio de sesión normal y se entra en el panel.
- **Panel sin sesión:** lleva directamente al inicio de sesión de la empresa; desaparece «Acceso restringido». Los estados de carga, el elemento activo del menú, la etiqueta de rol y el avatar usan los tokens.
- **Suspensión, archivo y dirección desconocida:** página con la identidad de Big Elephant para el navegador, sin datos de la empresa. La API mantiene la respuesta de siempre.
- **Eliminada** la insignia heredada de Náyade.
- **Se mantienen los colores con significado:** verde para lo correcto, ámbar para los avisos y rojo para los errores.

**Personalización por empresa:** ya existía y ahora alcanza a toda su experiencia.
- Editor de marca en Configuración › Marca y en Primeros pasos: logotipo, colores, favicon, nombre, fondo y textos del acceso.
- Vista previa en escritorio y móvil y aviso de contraste.
- Se puede restaurar lo predeterminado.
- La personalización se guarda en la base de cada empresa, así que no afecta a otras.

**Pruebas:**
- Automáticas: tokens, contraste, página de estado (HTML frente a API) y una comprobación de que las pantallas de acceso no tienen azules ni naranjas fijos.
- Live: capturas antes y después en escritorio y móvil (empresa sin marca: rojo de Big Elephant y logotipo oficial en las seis pantallas del acceso; `/admin` sin sesión lleva al inicio de sesión. Empresa con su color: su color en todas. Sin desbordes en el móvil. Antes, el `--primary` de toda la experiencia era el naranja de Náyade. Las capturas sacaron a la luz el aviso de cookies con colores fijos, corregido en el #359).

**Pendiente:**
- El asistente antiguo de onboarding (solo instalación única).
- Los acentos de los portales de empleados y socios, que no forman parte del recorrido del cliente SaaS.
- La pantalla de mantenimiento conserva el ámbar, que tiene significado.

## 5. Skibox

| Paso | Estado | Cómo se comprobó |
|---|---|---|
| Correo de acceso activado (solo Skibox; invitación y recuperación) | Verificado | Ejecución 40141253411 y consulta 40142763109 |
| Botón «Reenviar invitación» habilitado en production | Verificado | Captura del propietario: «Correo activo» y botón habilitado |
| Invitación real enviada y **entregada** | Verificado | Postmark: «Bienvenido a Skibox — Activa tu cuenta», entregado a las 01:16 |
| Enlace abierto en `skibox.app.bigelephant.es/establecer-contrasena` | Verificado | Captura del propietario |
| Recuperación de contraseña entregada y **contraseña cambiada** | Verificado | Postmark: «Recuperar contraseña» (01:23) y «Tu contraseña se ha cambiado» (01:24), los dos entregados |
| Inicio de sesión del administrador en su panel | **Verificado** | Confirmado por el propietario el 25/10/2026. Incidencia cerrada |

## 6. Pruebas

- **Automáticas (CI):**
  - suites unitarias y E2E con MySQL real y dos empresas;
  - todas en verde en cada fusión;
  - la suite completa en local, salvo cinco pruebas que ya fallaban en este equipo por el entorno y que en la CI pasan.
- **Funcionales en live:**
  - ciclo de vida: 7 transiciones y una prohibida;
  - circuito comercial: 19/20; el paso restante era una expectativa mía equivocada;
  - correo de acceso de punta a punta;
  - fase 4: 16/16.
- **Aislamiento:**
  - integraciones: la comprobación de una empresa no aparece en la otra;
  - métricas de almacenamiento y correo;
  - módulos;
  - página de estado sin datos de la empresa.
- **Seguridad:**
  - nuevas rutas con 401/403/404/400;
  - proveedor firmado en el canal interno;
  - sin secretos en las respuestas;
  - motivo obligatorio para suspender o archivar;
  - en production, rutas de Accesos y métricas en 401 sin sesión, también con un token falso, y `/_ops` en 404.

## 7. Pendientes

- **Funcionalidades:**
  - instalar o reintentar migraciones de módulos desde Admin (hoy, solo por el procedimiento protegido);
  - reconexión de integraciones desde Admin (las credenciales las cambia la empresa);
  - medición de colas, mensajería y CPU o memoria por empresa (declaradas «no disponible»).
- **Stripe:** cobros, suscripciones de pago, ampliaciones y autoservicio con pago. Los lleva la ventana de Stripe.
- **Postmark:**
  - el webhook de entregas del servidor de production todavía no está configurado (la entrega se consulta por la API);
  - ampliar el ámbito a otras empresas exige tu autorización.
- **Decisiones empresariales:**
  - tarifas reales de coste;
  - política de suspensión por exceso de cuota;
  - borrar las bases de pruebas de restauración de live (18–21/10).
- **Autorizaciones:** ninguna pendiente.

## 8. Pruebas humanas

La guía está lista: [GUIA_PRUEBAS_HUMANAS.md](GUIA_PRUEBAS_HUMANAS.md). Incluye:
- recorrido completo con una empresa de prueba en live, con 20 pasos;
- consulta segura de Skibox en production, con 9 pasos;
- comprobaciones por pantalla;
- lo que no se debe hacer con clientes reales;
- registro de incidencias.

Se ha añadido la revisión visual (sección 4 de la guía).

## 9. Preparación comercial

- **Ya con clientes reales:**
  - Skibox, con acceso entregado por correo;
  - alta asistida por el equipo;
  - gestión de accesos, licencias, cuotas y ficha 360°;
  - CRM comercial.
- **Publicado y pendiente de vuestra revisión en production:** todo lo nuevo de la fase 4 (guía de pruebas humanas).
- **Impide todavía la comercialización general:**
  - cobro y autoservicio de pago (Stripe);
  - correo de acceso habilitado solo para Skibox, que hay que ampliar empresa a empresa o de forma general con tu autorización;
  - el 50 % del catálogo publicado es «previsto».

## 10. Antes de las pruebas humanas (imprescindible)

1. Revisar en production, con la guía, las pantallas nuevas de la ficha (Integraciones, Licencias › Estado técnico) y el Resource Manager.
2. Decidir si el correo de acceso se amplía a las empresas que se usarán en las pruebas.
