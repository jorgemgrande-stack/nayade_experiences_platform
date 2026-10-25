# Guía de pruebas humanas — Big Elephant Admin

Para revisar Big Elephant Admin desde el navegador, sin herramientas técnicas.

**Dónde:**
- **Live (pruebas):** `https://elephant-source-crm-live.up.railway.app`. Aquí se hace todo lo que crea o cambia algo.
- **Production:** `https://admin.bigelephant.es`. Con clientes reales solo se **consulta**, salvo lo autorizado de forma expresa.

**Cómo entrar:** usuario de operador, contraseña y el código de la aplicación de autenticación (MFA).

**Cómo saber si algo ha funcionado:**
- aparece un aviso verde en la esquina («hecho», «guardado»…);
- la pantalla se actualiza sola con el cambio;
- en **Ficha → Auditoría** aparece la operación, con tu nombre, el motivo y el resultado.

Si sale un aviso rojo, cópialo tal cual en el registro de incidencias (al final).

---

## 0. Lo que NO se hace en estas pruebas

| No hacer | Motivo |
|---|---|
| Cobros, pagos, suscripciones de pago o cualquier cosa en Stripe | Lo gestiona la ventana de Stripe; puede mover dinero real |
| Firmar o activar contratos | Un contrato firmado puede dar de alta una empresa y empezar a facturar |
| Suspender, archivar o borrar **clientes reales** (Skibox, empresas de demostración de production) | Dejan a la empresa sin servicio |
| Enviar invitaciones, restablecimientos u otros correos a clientes reales sin autorización | Llegan de verdad |
| Cambiar el correo de production (modo, ámbito) | Solo con autorización expresa |
| Editar las **tarifas de coste** de production | Cambian el coste atribuido a cada empresa (dato interno). En live, sí |
| «Retirar» licencias de clientes reales | Les quita funciones |
| Publicar cambios en la web comercial de production | Se ven en www.bigelephant.es |

En **live** se puede hacer todo lo de esta guía con las empresas de prueba:
- `cms-prueba-a-20261023`;
- `alta-subdominio-20261024b`;
- `alta-correo-20261024c`, cuyo administrador es el buzón de pruebas `jgrande@bigelephant.es`;
- o una creada por ti en el recorrido A.

---

## 1. Recorrido A — empresa de prueba completa (en live)

| # | Pantalla | Operación | Resultado esperado | Cómo comprobarlo |
|---|---|---|---|---|
| A1 | Comercial › Leads | «Nuevo lead» con nombre, correo `@prueba.example` y empresa | Aparece en la lista como «Nuevo» | Abre el lead: ves los datos y su historial |
| A2 | Lead | «Contactado» y después «Convertir» (con oportunidad e importe) | Se crean la empresa, el contacto y la oportunidad | Comercial › Empresas y Pipeline los muestran |
| A3 | Comercial › Pipeline | Mueve la oportunidad a «Propuesta» | Cambia de columna | El importe ponderado del pipeline cambia |
| A4 | Ficha de la empresa (Comercial) | Añade un contacto y una nota | Se ven en la ficha y en su historial | Historial con fecha y autor |
| A5 | Comercial › Tareas | Crea una tarea con responsable y fecha y márcala hecha | Pasa a «Hecha» | El informe de actividad por responsable la cuenta |
| A6 | Comercial › Informes | Periodo «hoy» y «este mes»; exporta CSV | Cuentan el lead y la oportunidad de hoy | El CSV no lleva correos ni teléfonos |
| A7 | Ficha comercial › «Alta en la plataforma» | Da de alta la empresa con un subdominio libre y el contacto como administrador | En unos 20 s, «Alta completada» con su dirección `*.live.bigelephant.es` | Abre la dirección: sale su pantalla de acceso |
| A8 | Clientes SaaS › empresa › Accesos | Mira al administrador: invitación pendiente, sin contraseña | Si el correo de live lo permite (sandbox), «Reenviar invitación» está activo | Solo con el buzón de pruebas: llega el correo y su enlace abre «Establecer contraseña» |
| A9 | Pantalla «Establecer contraseña» (desde el correo) | Define una contraseña | Entras en el panel de la empresa | Accesos muestra «Aceptada», «con contraseña» y el último acceso |
| A10 | Accesos | «Enviar restablecimiento» al mismo administrador | Llega el correo; el enlace sirve una vez y caduca en 60 min | Usar el enlace dos veces: la segunda vez falla |
| A11 | Accesos | «Cerrar sesiones» | La sesión abierta en el panel de la empresa deja de valer | Recarga el panel de la empresa: pide entrar de nuevo |
| A12 | Ficha › Licencias | Activa «Hotel» y después «Suspender» (con motivo) | Hotel pasa a activo y luego a suspendido | Auditoría con el motivo |
| A13 | Ficha › Licencias › Estado técnico | Mira la tabla | Cada módulo dice Instalado, Habilitado, Contratado y Comercializable por separado | Hotel: instalado sí; habilitado sí mientras está activo y no al suspenderlo |
| A14 | Ficha › Integraciones | «Detalle» de una integración | Se ven qué permite, cómo se comprueba y sus incidencias | Ningún valor secreto en pantalla |
| A15 | Panel de la empresa › Configuración › Integraciones (`/admin/configuracion/integraciones`) | Configura algo falso (p. ej. VAPI con una clave inventada) y pulsa «Probar conexión» | «Credenciales rechazadas» | En la ficha (Admin): conexión «Credenciales rechazadas», con fecha y autor |
| A16 | Ficha › Integraciones | «Comprobar ahora», con motivo | El mismo resultado, ahora con tu nombre | Incidencia nueva en «Detalle» |
| A17 | Ficha › Cuotas | Pon una cuota baja de una métrica y vuelve a «Resource Manager» | La empresa aparece en advertencia o excedida | Quita la cuota después |
| A18 | Ficha › Operación | «Suspender acceso» (con motivo) | Su web pública responde «Service unavailable» | El **panel** de la empresa sigue cargando y se puede entrar (corregido en el #354) |
| A19 | Ficha › Operación | «Reactivar acceso» | Su web vuelve | Auditoría con los dos cambios |
| A20 | Ficha › Resumen | Tarjetas de base de datos, esquema y copias | El esquema dice «Al día» o cuántas migraciones le faltan | La última copia tiene menos de 24 h |

---

## 2. Recorrido B — Skibox, solo consulta (production)

Nada de este recorrido cambia datos ni envía correos.

| # | Pantalla | Qué mirar | Esperado |
|---|---|---|---|
| B1 | Clientes SaaS › Empresas clientes | Skibox en la lista | Estado y plan correctos |
| B2 | Ficha de Skibox › Resumen | Base de datos, esquema, copias, integraciones y tickets | Esquema al día y copia de las últimas 24 h |
| B3 | Ficha › Accesos | Administradores y estado de la invitación | Datos coherentes. **No pulses botones de envío** salvo el envío autorizado de la invitación |
| B4 | Ficha › Licencias (y Estado técnico) | Módulos contratados y su estado técnico | Coherente con lo contratado |
| B5 | Ficha › Integraciones | Estado de cada integración | Sin datos de comprobación: «No comprobada» (nunca «Conectada» solo por tener credenciales) |
| B6 | Ficha › Cuotas y Plataforma › Resource Manager | Consumo de Skibox | Cifras medidas o «sin datos», nunca inventadas |
| B7 | Resource Manager › Medición por empresa | Skibox | «Midiendo» |
| B8 | Ficha › Auditoría | Últimos eventos | Solo operaciones reales, cada una con su autor |
| B9 | Ficha › Comunicaciones | Envíos de la empresa | Nada salvo lo autorizado |

---

## 3. Por pantallas (comprobaciones sueltas)

| Pantalla | Qué probar | Esperado |
|---|---|---|
| Dashboard | Abrir | Indicadores con datos y alertas de recursos |
| Comercial › Panel, Leads, Pipeline, Empresas, Contactos, Contratos, Tareas | Buscar, filtrar, abrir fichas | Sin errores; los estados vacíos dicen «sin…» y no se ven en blanco |
| Comercial › Catálogo, Suscripciones, Contrataciones | Consultar | Sin botones que cobren (cobros apagados) |
| Comercial › Informes | Cambiar el periodo (incluido «hoy» de madrugada) | Las cifras incluyen lo creado entre las 00:00 y las 02:00 (corregido en el #355) |
| Clientes SaaS › Operación SaaS (7 pestañas) | Recorrer | Empresas, pruebas, vencimientos, aprobaciones, errores de alta y alertas |
| Plataforma › Módulos | Abrir un módulo | Empresas que lo usan |
| Plataforma › Resource Manager | Medición por empresa, anomalías, exportar CSV, política, tarifas | Lo nuevo de la fase 4. Tarifas: en live, cambia una y mira el historial; en production, no |
| Plataforma › Versiones | Consultar | Cada empresa: esquema al día o atrasado |
| Atención al cliente › Tickets, Desistimientos, Comunicaciones | Consultar | Sin errores |
| Administración › Operadores, Web comercial | Consultar | En Web comercial: los productos previstos se ven como «Próximamente» en la web |
| Cualquier pantalla en el móvil | Abrir | Sin desplazamiento horizontal |

---

## 4. Revisión visual (identidad corporativa)

Hazla en escritorio y en el móvil, con una empresa **sin marca** y con otra **con marca** (en live: Configuración › Marca del panel de la empresa). Usa enlaces de prueba, nunca uno real de Skibox.

| Pantalla | Empresa sin marca | Empresa con marca |
|---|---|---|
| `/login`, `/recuperar-contrasena`, `/nueva-contrasena` y `/establecer-contrasena` | El mismo armazón: panel grafito con el logotipo rojo de Big Elephant y botón rojo | Su logotipo y sus colores en las cuatro. Si su color no se lee bien, botón grafito |
| Enlace caducado o inválido | El mismo armazón, mensaje claro y enlace para pedir otro | Igual, con su marca |
| `/admin` sin sesión | Pasa directamente al inicio de sesión, sin «Acceso restringido» | Igual |
| Al establecer la contraseña | Entra directamente en el panel | Igual |
| Primeros pasos y panel | Acentos rojos (menú activo, botones, pasos), sin naranja | Sus colores |
| Web de una empresa suspendida | Página «Servicio no disponible temporalmente» con el logotipo de Big Elephant y «Entrar en el panel» | La misma (no muestra datos de la empresa) |
| Cambiar la marca en una empresa | — | No cambia nada en otra empresa |
| Cerrar sesión y volver | — | La marca se mantiene |

Anota como incidencia cualquier pantalla de este recorrido que aparezca en azul, naranja o con otro logotipo.

## 5. Registro de incidencias

Una fila por incidencia. Copia la tabla en un documento o en un mensaje y envíamela tal cual.

| Nº | Fecha y hora | Entorno (live / production) | Pantalla | Qué hice (pasos) | Qué esperaba | Qué pasó (texto exacto del aviso) | Empresa | Gravedad (bloquea / molesta / mejora) | Captura (sí/no) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |

**Gravedad:**
- **Bloquea:** no se puede terminar la operación.
- **Molesta:** se termina, pero mal o con dificultad.
- **Mejora:** funciona, pero se podría hacer mejor.
