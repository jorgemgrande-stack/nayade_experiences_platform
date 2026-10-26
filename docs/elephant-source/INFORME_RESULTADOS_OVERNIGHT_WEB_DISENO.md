# Informe de resultados — Quinto overnight: auditoría y rediseño de la web comercial

**Fecha:** 26/10/2026 · **Web:** https://www.bigelephant.es · **Repositorio:** `bigelephant-web` (rama `feat/elephant-web-portfolio`)

**Leyenda de estados.** *Diseñado*: decidido, pero sin código. *Implementado*: hay código con pruebas. *Publicado*: desplegado en live y en production. *Verificado*: comprobado en www tras publicar.

---

## 1. Diagnóstico

Antes de tocar nada se auditaron 23 páginas en tres anchos (1440, 768 y 390 px), 69 vistas en total, con un script medible. En cada vista se registró la captura de la primera pantalla, el texto por debajo de 13 px, los objetivos táctiles por debajo de 40 px, las imágenes sin dimensiones, los errores de consola, los desbordes, la estructura h1/h2, la longitud y si había una acción visible en la primera pantalla. También se midió Lighthouse en móvil.

La base técnica era buena:
- Lighthouse móvil: rendimiento 94–95, y 100 en accesibilidad, buenas prácticas y SEO;
- 0 errores de consola;
- 0 desbordes.

Los problemas eran de diseño y de mensaje:
- **Texto demasiado pequeño:** 1.908 textos por debajo de 13 px en las 69 vistas, hasta 108 en la portada.
- **Sin acción en la primera pantalla:** solo 8 de las 69 vistas mostraban un botón de acción en la primera pantalla. Las páginas interiores abrían con una cabecera grande y vacía.
- **Objetivos táctiles pequeños en móvil:** 625 en total (pie, migas, enlaces sueltos).
- **Llamadas a la acción contradictorias:** «Empieza gratis durante 15 días» convivía con «lista de espera, sin acceso inmediato», porque el alta automática está cerrada.
- **Producto invisible:** la portada no enseñaba el software. El área de funcionalidades usaba una ilustración conceptual.
- **Leyenda del diagrama desfasada** respecto a los estados reales del catálogo: decía «Se puede solicitar» y «Próximamente».

## 2. Inventario

- **Páginas comerciales:**
  - portada, Elephant Core y sus 3 planes, Elephant Net y sus familias, Elephant Connect y sus fichas;
  - precios, comparador, configurador, módulos y paquetes;
  - demostración, contacto, prueba gratuita y contratación;
  - preguntas frecuentes, seguridad, nosotros, soporte y textos legales.
- **Mapa del sitio:** 53 URLs.
- **Duplicados:** `/plataforma` y `/sectores` ya redirigen a `/elephant-core` y `/elephant-net`, con canónico y `noindex`, y no figuran en el mapa del sitio. Están bien resueltos y no requieren cambios.
- **Componentes compartidos:** cabecera (con «Iniciar sesión»), PageHero, CtaBand, pie, tarjetas de plan y paquete, formularios y textos legales.
- **Tokens de diseño:**
  - colores: `--red`, `--ink`, `--paper` y `--line`;
  - tipografías: Bricolage Grotesque para títulos e Inter para texto;
  - tamaños: `--fs-*`.
  - Se mantienen sin cambios, al igual que el logotipo.

## 3. Problemas encontrados (priorizados)

| Prioridad | Problema | Estado |
|---|---|---|
| Alta | La llamada principal prometía «Empieza gratis» sin acceso inmediato | Resuelto y verificado |
| Alta | La portada no mostraba el producto real | Resuelto y verificado |
| Alta | Las páginas de producto y precios no tenían ninguna acción en la primera pantalla | Resuelto y verificado |
| Media | Texto por debajo de 13 px en todo el sitio | Resuelto (15 restos justificados, ver §10) |
| Media | Objetivos táctiles pequeños en móvil | Muy reducido (625 → 187; el resto, ver §10) |
| Media | Leyenda del diagrama desfasada | Resuelto y verificado |
| Baja | Cabecera de páginas interiores con exceso de vacío y forma decorativa intensa | Resuelto y verificado |
| Baja | `aria-allowed-role` en el recorrido del producto (detectado tras publicar) | Resuelto y verificado |
| Baja | Quedan dos textos con «ya se pueden solicitar» (portada: «Crece contigo» y sectores) | Pendiente (§10) |

## 4. Cambios realizados

Todos los cambios siguientes están **implementados, publicados y verificados**.

1. **Nueva sección «El producto, tal como es»**, tras «Del caos al orden».
   - Cinco pestañas con capturas reales del panel de Elephant Core: Clientes, Tu web, Tu marca, Primeros pasos, y Plan y uso.
   - Origen: la empresa de pruebas de live, con la marca de demostración «Estudio Norte» y 6 clientes ficticios (`@example.com`).
   - Las capturas se tomaron con un acceso de soporte auditado de solo lectura, y se recortaron para excluir el usuario de soporte.
   - WebP en 800 y 1600 px, de 14 a 56 KB cada una.
   - Pestañas accesibles por teclado; en móvil pasan a un carril desplazable de 48 px.
   - Nota visible: «Capturas reales del panel de Elephant Core con datos de una empresa de demostración».
   - No se inventa ninguna pantalla: cada captura corresponde a una función que existe hoy.
2. **«Qué incluye Elephant Core»**:
   - las áreas CRM y CMS muestran ahora la captura real, rotulada «Captura real · datos de demostración»;
   - el resto de áreas mantienen la ilustración, rotulada como conceptual.
3. **Llamadas a la acción coherentes con lo que ocurre al pulsar** (dependen de `TRIAL.signupOpen`):
   - **Con el alta cerrada (hoy):**
     - la acción principal (roja) es «Solicitar demostración»;
     - la prueba se *solicita*: «Solicita tu prueba de 15 días» o «Prueba gratuita»;
     - nota del hero: «¿Prefieres probarlo antes? Solicita 15 días de Essential sin tarjeta: te avisamos cuando tu entorno esté listo».
   - **Si el alta se abre**, los textos vuelven solos a «Empieza gratis».
   - Afecta a la cabecera, el hero, el cierre de la portada, el pie, la banda final de cada página, la página de prueba y el configurador.
4. **Leyenda del diagrama:** «Se puede implantar», «En parte» y «En preparación o próximamente».
5. **Sistema de diseño:**
   - tamaño mínimo de texto de 13 px (`0.8125rem`) en todos los componentes;
   - objetivos táctiles de 44 px en móvil para los enlaces del pie, las migas, los enlaces sueltos de tarjetas y tablas, y el logotipo.
6. **PageHero con acciones:**
   - **acción principal más secundaria** en Elephant Core y sus planes, Net, Connect y sus fichas, precios, comparador, módulos y paquetes;
   - **más espacio útil:** menos relleno y una forma decorativa más pequeña y suave (opacidad de 0,10 a 0,06).
7. **Pruebas** actualizadas a los nuevos textos. Ahora exigen que, con el alta cerrada, no aparezca «Empieza gratis» en ninguna cabecera ni en la portada.

**Commits y PR (web):**
- PR #18: `6eb9b08` y la corrección de tipos;
- PR #19: corrección `aria-allowed-role`.

**Versión publicada:** web `39926f1a7e76`.

## 5. Capturas antes y después

Las capturas están en `docs/elephant-source/capturas-overnight-web/`.

| Vista | Antes | Después |
|---|---|---|
| Portada, 1440 | `antes-home-1440.jpg` | `despues-home-1440.jpg` |
| Portada, 390 | `antes-home-390.jpg` | `despues-home-390.jpg` |
| Elephant Core, 1440 | `antes-elephant-core-1440.jpg` | `despues-elephant-core-1440.jpg` |
| Elephant Core, 390 | `antes-elephant-core-390.jpg` | `despues-elephant-core-390.jpg` |
| Precios, 390 | `antes-precios-390.jpg` | `despues-precios-390.jpg` |
| Producto real, 1440 y 320 | (no existía) | `despues-producto-1440.jpg`, `despues-producto-320.jpg` |
| «Cómo funciona», con desplazamiento real | — | `despues-como-funciona-1440.jpg` |

El hueco que se veía en «Cómo funciona» en la auditoría inicial venía de la captura forzada, que no dispara la animación de las pilas. Con desplazamiento real, las cuatro pilas se ven completas en 1440 y 390 px.

## 6. Decisiones de diseño

- **Enseñar el producto, no dibujarlo.** Solo capturas reales con datos ficticios. Donde no hay una pantalla presentable (por ejemplo, la de usuarios vacía), se mantiene la ilustración rotulada como conceptual.
- **La acción principal es la que hoy responde de inmediato.** Con el alta automática cerrada, esa acción es la demostración. La prueba sigue visible, pero dice que se solicita.
- **Se mantiene el concepto V5** «Tu negocio no cabe en una caja. Nuestro software tampoco», junto con el logotipo, los colores, las tipografías, los precios y los textos legales.
- **No se acortó la portada eliminando secciones.** Todas aportan contenido comercial verificable. Se añadió el recorrido del producto, lo que alarga la portada unos 1.200 px; queda como recomendación (§11).
- **Excepción deliberada:** las etiquetas del diagrama del hero escalan con su contenedor. Con un mínimo de 13 px se solapan en anchos pequeños (lo detectó la prueba e2e del diagrama), así que conservan su mínimo original.

## 7. Pruebas

| Prueba | Resultado |
|---|---|
| `astro check` | 0 errores |
| Unitarias (Vitest, sobre el sitio generado) | 131/131 en verde |
| E2E (Playwright) | 60 en verde, 1 omitida (capturas legales, omitida por diseño) |
| CI de las PR #18 y #19 | En verde |
| Auditoría medible de www, 69 vistas | Ver §8 |
| Mapa del sitio de www | 53 URLs, todas 200 |

**Incidencia de proceso.** La primera ejecución de la CI de la PR #18 falló en `astro check` (3 errores de tipos en el cierre de la portada). En local había leído mal el resumen del chequeo. Se corrigió antes de fusionar, y nada roto llegó a publicarse.

## 8. Rendimiento, accesibilidad y SEO

**Auditoría de diseño (23 páginas × 3 anchos).** Antes de la publicación se midió sobre www; después, sobre www ya publicada.

| Métrica | Antes | Después |
|---|---|---|
| Textos por debajo de 13 px | 1.908 | 15 |
| Objetivos táctiles por debajo de 40 px (móvil) | 625 | 187 |
| Vistas con acción en la primera pantalla | 8 / 69 | 40 / 69 |
| Errores de consola | 0 | 0 |
| Desbordes horizontales | 0 | 0 |
| Imágenes sin dimensiones | 0 | 0 |

**Lighthouse en móvil (www):**

| Página | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP | CLS | Peso |
|---|---|---|---|---|---|---|---|
| Portada, antes | 94 | 100 | 100 | 100 | 2,7 s | 0 | 172 KB |
| Portada, después | 99 | 100 | 100 | 100 | 2,0 s | 0 | 193 KB |
| Elephant Core, antes | 95 | 100 | 100 | 100 | 2,6 s | 0 | 136 KB |
| Elephant Core, después | 100 | 100 | 100 | 100 | 1,6 s | 0 | 136 KB |
| Precios, antes | 94 | 100 | 100 | 100 | 2,7 s | 0 | 141 KB |
| Precios, después | 100 | 100 | 100 | 100 | 1,7 s | 0 | 141 KB |

**Lighthouse en escritorio:** portada a 100/100/100/100, LCP 0,5 s.

La mejora de LCP incluye varianza entre mediciones. La conclusión prudente es que el rediseño no empeora el rendimiento y lo mantiene en el rango alto. La portada pesa 21 KB más por la primera captura del producto.

## 9. Despliegue por entorno

| Paso | Ejecución | Resultado |
|---|---|---|
| CI web (PR #18 y #19) | GitHub Actions `bigelephant-web` | En verde |
| Live: `publicar` | 40252605329 y 40254271805 | Web `76eb034` y luego `39926f1` publicadas en live |
| Comprobación en live | Pasarela del equipo | Sección del producto, demostración como acción principal, ningún «Empieza gratis», imágenes servidas, PageHero con acciones |
| Production: `publicar` (ordinario) | 40253092638 y 40254441957 | «Web publicado 39926f1a7e76 en production» |
| Verificación en www | Auditoría, Lighthouse y mapa del sitio | Correcto |

Core y CRM no cambiaron en estas publicaciones; el workflow solo actualizó la web. No se usó ninguna acción extraordinaria.

## 10. Pendiente

- **«ya se pueden solicitar»** en `Modular.astro` («Crece contigo») y `Sectors.astro`: conviene alinearlo con «se pueden implantar», como en la leyenda. Es un cambio de texto menor; no se hizo para no abrir otro ciclo de publicación esta noche.
- **187 objetivos táctiles pequeños restantes:**
  - en su mayoría son enlaces dentro de frases (la norma WCAG los exime) y casillas con etiqueta pulsable;
  - el configurador concentra 53: controles del formulario que conviene revisar con calma.
- **15 textos pequeños restantes:** etiquetas del diagrama del hero (excepción de §6).
- **Formularios** (demostración, contacto, prueba, contratación): siguen sin botón en la primera pantalla porque el formulario es la acción. Se podría subir el primer campo.
- **Empresa de pruebas de live:** conserva los 6 clientes ficticios creados para las capturas. La marca de demostración ya está restaurada.

## 11. Recomendaciones para revisión humana

1. **Revisar las cinco capturas del producto** en la portada y decidir si alguna pantalla debe sustituirse, por ejemplo por una con oportunidades o facturas cuando haya datos de demostración presentables.
2. **Decidir si acortar la portada**, que tiene 15.237 px en escritorio. Candidatas a fusionar: «Plataforma gestionada» con «Planes y precios».
3. **Validar el texto de la nota del hero** sobre la prueba («te avisamos cuando tu entorno esté listo»), que describe el proceso actual de lista de espera.
4. Cuando se abra el alta automática, **comprobar que los textos vuelven a «Empieza gratis»**: lo hacen solos con `TRIAL.signupOpen`, y las pruebas cubren ambos estados.

## 12. Valoración final

La web ya era técnicamente sólida. El trabajo se centró en lo que un cliente percibe:
- **ahora ve el producto real;**
- **cada página de producto y precios ofrece una acción** en la primera pantalla;
- **los botones dicen lo que ocurre de verdad;**
- **el texto pequeño y los objetivos táctiles pequeños** casi desaparecen.

Todo está publicado en production y verificado en www, sin cambios en precios, Stripe, textos legales, catálogo, acceso ni logotipo.
