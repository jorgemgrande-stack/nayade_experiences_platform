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
