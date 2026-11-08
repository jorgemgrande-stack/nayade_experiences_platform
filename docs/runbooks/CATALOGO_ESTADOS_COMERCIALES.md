# Estados comerciales del catálogo

## Los cuatro estados

El estado comercial dice qué puede hacer el visitante. Es independiente del estado técnico (operativo, parcial, en hoja de ruta) y de que un módulo esté instalado, habilitado o contratado por una empresa.

| Estado | Valor | Cuándo | En la web | En el CRM |
|---|---|---|---|---|
| Disponible | `available` | Completo, comprobado y preparado para ofrecerse. Exige estado técnico operativo. | «Solicitar contratación» | Se contrata |
| Implantación acompañada | `on_request` | Operativo; lo implanta el equipo con el cliente. | «Solicitar implantación» | Se contrata |
| En preparación | `in_preparation` | Hay código, pero falta desarrollo o validación. | «Avísame» (nunca contratación) | Solo como piloto |
| Próximamente | `coming_soon` | Previsto, sin código que se pueda implantar. | «Avísame» | No se contrata |

Además existe `unpublished`, que no se muestra en ningún sitio.

El cotizador de la web y el autoservicio solo dejan contratar lo «Disponible». Cambiar un estado:

- no activa módulos ni licencias;
- no toca Stripe ni cobros.

## Fuente de verdad única

La base del CRM (`web_entries`) es la fuente de verdad, y se edita en **CRM → Web comercial → producto → Disponibilidad comercial**:

- **Permisos:** guardar exige `web:write`; publicar exige `web:publish`.
- **Historial:** cada cambio queda con versión, autor y evento.
- **Recuperación:** se restaura una versión anterior y se publica.
- **Evidencia interna:** cada producto tiene un campo de evidencia que nunca se publica.
- **Avisos:** el CRM señala lo que se ofrece sin evidencia o con un estado que no se puede entregar.

La web toma lo publicado al compilarse (`/cp/v1/public/site`). Tras publicar, hay que desplegar la web: acción `desplegar-web`.

La semilla `server/catalog/elephantSourceV1.ts` solo carga lo que falta. En una base existente nunca revierte el estado comercial ni la evidencia decididos en el CRM (`seed.ts`, `keepCommercialState`).

## Revisiones en bloque

Una revisión, como `server/catalog/review20261025.ts`, lista cada cambio con su estado de partida y su evidencia. La orden `catalog-review` la aplica por el flujo normal del CRM (guardar y publicar, con autor `operacion:<revisión>`):

- Solo cambia lo que sigue en su estado de partida. Si alguien lo cambió desde el CRM, se informa y no se toca.
- Si un producto tiene cambios sin publicar, lo deja sin tocar: nunca publica un borrador ajeno.
- No toca precios.
- Repetirla no cambia nada.

Acciones del flujo de despliegue:

- `catalogo-revision`: simulación.
- `catalogo-revision-aplicar`: la aplica. En production usa el entorno protegido, con aprobación.

`aplicar-production` también la aplica (paso 4b), y es idempotente.

Para deshacer un producto, en el CRM se restaura su versión anterior y se publica.

## Revisión del 25/10/2026

Se contrastó con el código y las pruebas de cada módulo, y con las verificaciones de las fases nocturnas. La evidencia de cada uno está en el fichero de la revisión.

**Implantación acompañada:**
- **Planes:** Essential y Business. Business muestra sus 7 capacidades sin código como «Prevista».
- **Hotel Net:** PMS y motor de reservas.
- **Care Net:** agenda.
- **Restaurant Net:** reservas y mesas.
- **Connect:** Voice, People, Tax, Partners, POS, Deals, Finance Sync y el paquete Finance.
- **Servicios:** alojamiento y dominios.
- **Complementos:** usuarios y almacenamiento.

**En preparación:**
- Enterprise.
- Sede adicional Business.
- Los paquetes Hotel, Care y Restaurant Complete.
- Tratamientos y bonos.
- Travel Net · Agencias.
- Ski Net · Alquiler.
- WhatsApp AI y Automatizaciones avanzadas.
- Los paquetes Communications y AI Suite.

**Próximamente:** el resto, es decir, todo lo que no tiene código.

**Disponible:** ninguno todavía. Exige estado técnico operativo, y Essential lo será tras la primera compra controlada.

## Revisión del 07/11/2026 (autorizada el 08/11/2026)

`server/catalog/review20261107.ts` pasa a **Implantación acompañada** Hotel Net, Restaurant Net, Care Net, Ski Net y Travel Net. Su recorrido esencial se verificó en production el 07/11/2026 en la empresa Elephant Demo. Ski Net y Travel Net pasan además de estado técnico «planned» a «partial»: la revisión lo indica con su estado de partida, con las mismas reglas que el comercial.

- Venta asistida: el panel muestra «Lo activa nuestro equipo contigo» y «Solicitar información» crea una solicitud en el CRM; la web ofrece «Solicitar propuesta». No hay checkout ni cobro automático, y no se crea ningún Price de Stripe.
- Precios, contratos y suscripciones no cambian. Social Token Net y Life Net siguen en Próximamente.
- La orden `catalog-review` aplica las dos revisiones en orden. En la del 25/10, los productos que ya cambió la del 07/11 aparecen como conflicto: es lo esperado.

## Revisión del 08/11/2026: plan personal Life

`server/catalog/review20261108.ts` (decisiones J1–J10 de Jorge del 08/11/2026) da de alta el plan personal **Life** (`life`, familia `core_plan`), independiente de Essential: un hogar por tenant con `life-net`, `admin-users` y `comms-email`, 5 miembros del hogar (`household_members`) y solo tarifa mensual de 7,44 € sin IVA (9,00 € IVA incluido). Entra en **Próximamente** con estado técnico «planned»: no se suscribe, no se cotiza como contratable, no tiene Price de Stripe y la prueba de 14 días está apagada (`CP_LIFE_TRIAL_ENABLED`). También cambia la presentación de Life Net de «Profesionales y familias.» a «Particulares y familias.», solo desde ese valor de partida.

- Por el flujo normal del CRM (crear → publicar → precio en borrador → aprobar), con autor `operacion:revision-catalogo-2026-11-08`. Idempotente; un plan `life` creado por otra persona o un borrador ajeno de Life Net se respetan y salen como conflicto.
- El único precio que añade es el del plan nuevo. La orden comprueba que los precios que ya existían quedan iguales (`preciosExistentesIntactos`) y falla si no.
- **Orden en production (sin cambio de estado comercial):** primero `catalogo-revision` (simulación) y `catalogo-revision-aplicar`, porque la ficha de un producto que todavía no existe no se puede importar; después `catalogo-fichas` → `catalogo-fichas-aplicar` → `catalogo-fichas-publicar` → `catalogo-fichas-publicar-aplicar` y `catalogo-fichas-integridad`. Al revés, el cambio de presentación de Life Net encontraría el borrador de la ficha sin publicar y quedaría como conflicto.
- Contratación de particulares, textos y variables: `docs/elephant-source/LIFE_CONTRATACION_PARTICULARES.md`.
