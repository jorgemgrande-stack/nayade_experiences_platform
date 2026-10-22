# Renombrado a Elephant Core y retirada de la identidad heredada

**Estado:** preparado. **No** se ha cambiado ningún nombre remoto: renombrar el repositorio o los servicios requiere autorización.

## 1. Qué cambia y qué no

| Elemento | Hoy | Destino | Cómo | Riesgo |
|---|---|---|---|---|
| Repositorio GitHub | `nayade_experiences_platform` | `elephant-source-core` (decisión del 22/10/2026) | GitHub → Settings → Rename. GitHub redirige las URL antiguas (clones, PR, enlaces) | Railway: el servicio sigue enlazado por id. Hay que comprobar el enlace tras renombrar, sin desplegar |
| Paquete (`package.json` `name`) | `skicenter_platform` | `elephant-core` | Commit aislado de infraestructura | Bajo; no lo usa el arranque |
| Identidad del producto | Mezclada con la de Náyade y la de «Skicenter» | `server/_core/productIdentity.ts` (`PRODUCT`) | Hecho en esta rama | Ninguno |
| URL pública de los enlaces | 25 respaldos fijos `APP_URL ?? "https://www.skicenter.es"` | Un único `publicBaseUrl()` con el **mismo** respaldo | Hecho en esta rama, con una guarda que impide reintroducirlos | Ninguno (mismo comportamiento) |
| URL por empresa (multiempresa) | Global (`APP_URL`) | Dominio de la empresa en el registro, por petición | Pendiente | — |
| `CLAUDE.md` | Describía «Skicenter», una escuela de esquí que no existe | Elephant Core | Hecho en esta rama | Ninguno |

## 2. Identidad heredada que queda (inventario, sin cambios en esta rama)

| Dónde | Qué | Por qué no se toca aún |
|---|---|---|
| ≈ 60 apariciones de «skicenter» (sin distinguir mayúsculas) en el servidor tras centralizar las URL | Marca por defecto «Skicenter» en correos y plantillas (`emailTemplates.ts`, `mailer.ts`), títulos de presupuesto («Presupuesto Skicenter» en Vapi), enlaces de restaurantes | Lo ve el cliente final de la instalación de Náyade. Cambiarlo es un cambio visible en producción, y debe ir con la configuración de marca por empresa (`site_settings`) |
| 67 ficheros `.tsx` del cliente | Textos, páginas legales, colegios, lego packs con la marca Náyade | Son la web pública de Náyade en producción. Se separan al extraer el paquete «ocio» y la marca por empresa |
| Remitentes y copias | Remitente «Nayade» en la bandeja de GoHighLevel; copia global con la dirección de Náyade | Credenciales y remitentes por empresa: pendiente de la bóveda por empresa |
| `onboardingRouter.ts` | «Default tenant — Skicenter (id=1)» | Comentario heredado; se corrige con el resto |

## 3. Código sectorial heredado (para su extracción)

| Área | Ubicación | Destino |
|---|---|---|
| Hotel | `server/hotelDb.ts`, `server/routers/hotel.ts` (defecto de disponibilidad conocido) | Elephant Hotel Net (PMS y motor de reservas) |
| Spa y bienestar | `server/spaDb.ts`, `server/routers/spa.ts` (defecto de aforo conocido) | Elephant Care Net (agenda, tratamientos y bonos) |
| Restauración | `server/restaurantsDb.ts`, `server/routers/restaurants.ts` | Elephant Restaurant Net (reservas y mesas) |
| Actividades, monitores, lego packs, cupones | `commerce` del Core, `server/routers/legoPacks.ts`, `server/routers/ticketing.ts` | Paquete «ocio» y Elephant Deals |
| Agencias (REAV) | `server/reav.ts`, `server/routers/gestoria.ts` | Elephant Travel Net y Elephant Tax |
| RRHH | `server/routers/hr.ts` | Elephant People |

## 4. Orden propuesto (cada paso, un PR y un despliegue verificado)

1. Esta rama: identidad de producto, `publicBaseUrl()` y `CLAUDE.md`, sin cambio de comportamiento.
2. Marca por empresa: `brand_name`, remitente y textos legales desde `site_settings`, con respaldo de producto «Elephant Source» **solo** para empresas nuevas. Náyade conserva su configuración.
3. URL por empresa en multiempresa (registro → petición).
4. `package.json` `name` (commit de infraestructura aislado).
5. Renombrado del repositorio (lo hace Jorge). Después: comprobar Railway, el CI y los remotos locales (`git remote set-url`).

## 5. Renombrado del repositorio a `elephant-source-core`

**Decisión (22/10/2026):** Náyade deja de ser referencia del producto. El repositorio del Core pasa a llamarse `elephant-source-core`. **No se renombra** hasta completar la preparación y tener la reversión lista.

### Preparación (en el código)

| Dependencia | Estado |
|---|---|
| Nombre en el código (paquete de recuperación, mensaje de `railway up`, cabecera de la instantánea del catálogo) | Un único punto: `shared/repositories.ts` (`REPOSITORIES.core`). Al renombrar, cambia solo ese valor |
| GitHub Actions (`ci.yml`, `deploy-elephant-source.yml`) | No nombran el repositorio: usan el de la ejecución. Sin cambios |
| Despliegues de Elephant Source (`live`, `production`) | `railway up` desde el export del commit: no dependen del enlace de Railway con GitHub. Sin cambios |
| Servicio de Náyade en Railway (enlazado a GitHub, rama `main`) | Railway lo sigue por id; comprobar el enlace tras renombrar, sin desplegar |
| Remotos locales y worktrees | GitHub redirige el nombre antiguo; actualizar con `git remote set-url origin …/elephant-source-core.git` |
| CRM y web comercial | Solo lo citan en documentación y en la cabecera de `catalog.generated.json` (se actualiza al regenerar) |

### Procedimiento (lo ejecuta Jorge)

1. GitHub → Settings → Rename: `elephant-source-core`.
2. PR con `REPOSITORIES.core = "elephant-source-core"` a `integration/elephant-source` (CI en verde).
3. Comprobar sin desplegar: CI de un PR cualquiera, `verificar-token` y `estado` del flujo de despliegue en `live`, y el enlace del servicio de Náyade en Railway.
4. Actualizar los remotos locales.

### Reversión

- GitHub → Settings → Rename con el nombre anterior (GitHub vuelve a redirigir).
- Revertir el PR del paso 2.
- Ningún despliegue depende del nombre, así que no hay que redesplegar nada.
