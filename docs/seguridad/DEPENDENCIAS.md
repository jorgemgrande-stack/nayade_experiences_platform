# Seguridad de dependencias (Overnight 4, fase 1)

Revisión de `pnpm audit` antes de exponer servicios, en los tres repositorios de Elephant Source:
Core (este repositorio), CRM interno y web comercial. Rama `chore/dependencias-seguras` en los tres.
Este documento no contiene secretos. Lo que queda pendiente se describe de forma resumida a
propósito (el repositorio es público).

## 1. Criterios

- Primero lo que llega a producción y es explotable con nuestro uso real; después las herramientas
  de desarrollo y construcción.
- Dependencias directas: actualización menor o de parche dentro de la misma versión mayor.
- Transitivas: actualizar el paquete padre o, si el padre aún no lo eleva, `pnpm.overrides` acotado
  a las versiones vulnerables (`paquete@<corregida`) y apuntando al parche corregido de la misma
  serie. Ningún aviso ignorado ni exclusiones generales.
- Saltos mayores solo tras evaluar sus cambios incompatibles y con las pruebas en verde; cada uno en
  su propio commit para poder revertirlo por separado.
- El lockfile se regenera con la misma versión de pnpm del Dockerfile (10.32.1), de modo que
  `pnpm install --frozen-lockfile` sigue funcionando. No cambia `packageManager`, el Dockerfile ni
  ninguna configuración de arranque.

## 2. Cifras antes y después

Recuento de `pnpm audit` (campo `metadata.vulnerabilities`). «Producción» es `pnpm audit --prod`;
«Todo» incluye desarrollo.

| Repositorio | Alcance | Antes (crítico / alto / moderado / bajo) | Después (crítico / alto / moderado / bajo) |
|---|---|---|---|
| Core | Producción | 2 / 52 / 78 / 14 | **0 / 0 / 0 / 2** |
| Core | Todo | 6 / 88 / 109 / 15 | **2 / 0 / 4 / 2** |
| CRM | Producción | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| CRM | Todo | 4 / 1 / 12 / 2 | **0 / 0 / 0 / 0** |
| Web | Producción | 1 / 5 / 5 / 3 | **0 / 0 / 0 / 1** |
| Web | Todo | 5 / 6 / 10 / 3 | **0 / 0 / 0 / 1** |

Los dos críticos que quedan en el Core son de una dependencia de desarrollo (sección 5).

## 3. Core: avisos críticos y altos y decisión

Columnas: paquete, versión afectada, ruta (directa o a través de qué paquete), producción o
desarrollo, avisos (C = crítico, el resto altos), explotación con nuestro uso y decisión.

### Producción

| Paquete | Versión | Ruta | Avisos | Explotación con nuestro uso | Decisión |
|---|---|---|---|---|---|
| proxy-addr | 2.0.7 | express | 1 (C) | La app principal confía en un número de saltos (no afectado); el plano de control admite una lista de redes de confianza configurable, que sí lo estaría | Override `proxy-addr@<2.0.8` → `^2.0.8` (express 4.22.3 aún fija `~2.0.7`) |
| fast-xml-parser | 5.2.5 | @aws-sdk/client-s3 | 4 (1 C) | Solo analiza respuestas de nuestro almacenamiento S3/MinIO, un servicio de confianza: baja | @aws-sdk 3.907 → 3.1152 (menor) |
| xlsx | 0.18.5 | directa | 2 | Lee extractos bancarios y de TPV subidos al panel y adjuntos de correos ingeridos: entrada externa, real | 0.20.3 desde la distribución oficial de SheetJS (npm no tiene versión corregida). URL e integridad fijadas en el lockfile. Misma salida verificada para CSV y XLSX |
| nodemailer | 8.0.2 / 8.0.5 | directa; imapflow | 4 | El analizador de direcciones procesa cabeceras de correos entrantes: denegación de servicio real. Lo demás requiere opciones que no usamos | 10.1.2 (mayor; Node ≥ 20 y validación TLS al descargar contenido remoto, que no usamos). imapflow 1.7.8 ya no lo arrastra |
| linkify-it | 5.0.0 | mailparser | 2 | Texto de correos entrantes: denegación de servicio real | mailparser 3.9.8 → 3.9.40 (parche) |
| multer | 2.1.1 | directa | 3 | Rutas de subida de ficheros: denegación de servicio con nombres de campo manipulados | 2.4.0 (menor) |
| axios | 1.12.2 | directa | 11 | Peticiones salientes a APIs conocidas; varios requieren contaminar antes el prototipo: media | 1.20.0 (menor) |
| form-data | 4.0.4 | axios | 1 | Los nombres de campo los ponemos nosotros: baja | Arrastrado por axios (4.0.6) |
| @trpc/server | 11.6.0 | directa | 1 | Afecta a una API experimental de Next.js que no usamos | 11.19.0 (menor), también cliente y react-query |
| drizzle-orm | 0.44.6 | directa | 1 | Requiere identificadores SQL procedentes del usuario; no hemos encontrado ese uso | 0.45.4 (serie 0.x; sin cambios de API que nos afecten) |
| mysql2 | 3.15.1 | directa | 1 | Requiere un servidor de base de datos malicioso o interpuesto: baja | 3.24.6 (menor) |
| path-to-regexp | 0.1.12 | express | 1 | Depende de la forma de las rutas: baja | express 4.22.3 (0.1.13) |
| ip-address | 10.1.0 | express-rate-limit; puppeteer | 1 | Agrupación de IPv6 en el limitador de peticiones | express-rate-limit 8.7.1; en puppeteer desaparece |
| nanoid | 5.1.6 / 3.3.11 | directa; postcss | 5 | Solo con tamaños negativos o cero; usamos tamaños fijos | 5.1.16 (parche); postcss actualizado |
| lodash / lodash-es | 4.17.21 | archiver; streamdown > mermaid | 2 | `_.template` con claves externas: no lo usamos | Override `<4.18.0` → `^4.18.1` |
| brace-expansion | 2.0.2 | archiver > glob > minimatch | 5 | Los patrones los definimos nosotros: no explotable | Override `>=2.0.0 <2.1.6` → `^2.1.7` |
| basic-ftp, extract-zip, ws | varias | puppeteer-core > @puppeteer/browsers | 8 | Solo intervienen al descargar navegadores, que no hacemos (usamos el Chromium del sistema) | puppeteer-core 24.40 → 25.14 (mayor), que elimina esas dependencias. extract-zip no tenía versión corregida |

Además, streamdown 1.4.0 → 1.6.11 (menor) elimina todos los avisos moderados de producción
(mermaid, dompurify y mdast-util-to-hast en el renderizado de Markdown del cliente).

Ajuste de código necesario: con puppeteer-core 25, `page.setContent` ya no acepta
`waitUntil: "networkidle0"` en sus tipos; `server/pdfGenerator.ts` espera al evento `load`, que ya
cubre imágenes y hojas de estilo (las plantillas de PDF no cargan fuentes web). Se generó un PDF
real con Chrome local para comprobarlo.

### Desarrollo y construcción

| Paquete | Versión | Ruta | Avisos | Decisión |
|---|---|---|---|---|
| vite | 7.1.9 (y 5.4.20 vía vitest) | directa | 4 | 7.3.7 (menor); la copia de vitest desaparece con vitest 3 |
| vitest | 2.1.9 | directa | 1 (C) | 3.2.7 (mayor; suites sin cambios) |
| tinypool | 1.1.1 | vitest | 2 (C) | **Pendiente** (sección 5) |
| pnpm (devDependency) | 10.18.0 | directa | 14 | 10.34.7 (menor). No cambia el pnpm del Dockerfile ni `packageManager` |
| tar | 7.5.1 | @tailwindcss/vite > @tailwindcss/oxide | 9 (1 C) | Actualizado dentro de su rango |
| rollup, picomatch | 4.52.4, 4.0.3 | vite | 2 | Actualizados dentro de su rango |
| postcss | 8.5.6 | directa | 2 | 8.5.30 (parche) |
| browserslist | 4.26.3 | @vitejs/plugin-react > @babel/core | 2 | plugin-react 5.2.0 y actualización dentro de rango |
| source-map-js | 1.2.1 | @tailwindcss/vite | 1 | Actualizado dentro de su rango |

## 4. CRM y web comercial

**CRM** (`big-elephant-crm`). Sin avisos en producción. En desarrollo: vitest 2.1.8 → 4.1.12 (dos
críticos del servidor de Vitest y dos de tinypool, que la serie 4 ya no usa), vite 5.4.11 → 6.4.4
(un alto del servidor de desarrollo en Windows) y @vitejs/plugin-react 4.3.4 → 4.7.0. Único ajuste:
`vite.config.ts` referencia los tipos de `vitest/config`. Resultado: 0 avisos.

**Web** (`bigelephant-web`). Es un sitio estático (`output: "static"`, sin adaptador de servidor ni
optimización de imágenes), así que la explotación real de los avisos de astro y sharp era baja: se
ejecutan solo al construir y con contenido propio. Aun así la corrección de astro solo existe en la
serie 7 y el salto resultó pequeño: astro 5.18.2 → 7.3.8, sharp 0.34.5 → 0.35.5, vitest 2.1.8 →
4.1.12, @astrojs/check 0.9.4 → 0.9.10 y @types/node 22.10.2 → 22.20.5. Sin cambios de código.
astro 7 requiere Node ≥ 22.12 en la máquina que construye la web.

## 5. Pendientes

| Repositorio | Paquete | Severidad | Ámbito | Motivo |
|---|---|---|---|---|
| Core | tinypool (vía vitest 3) | Crítico (2) | Solo pruebas | Se corrige con vitest 4. Probado: dos pruebas pesadas de las suites bloqueantes superan el tiempo límite por defecto en Windows. Requiere una tarea propia (ajustar tiempos o dividir esas pruebas). Solo afecta al proceso de pruebas |
| Core | vitest / @vitest/mocker 3.2.7 | Moderado (2) | Solo pruebas | Misma corrección (vitest 4) |
| Core | esbuild 0.18 (vía drizzle-kit) | Moderado | Solo servidor de desarrollo | Corregido en una serie de esbuild que drizzle-kit aún no admite |
| Core | postcss-selector-parser 6.x | Moderado | Construcción | Lo fija un plugin de Tailwind en su rango actual |
| Core | katex (vía streamdown) | Bajo | Cliente | Corregido en una serie mayor de katex que streamdown 1.x no admite |
| Web | esbuild 0.27 | Bajo | Solo servidor de desarrollo | Lo fija la cadena de construcción de astro 7 |

Fuera del alcance de esta tarea: Express 5, pnpm 11/12, vite 8 en el Core y las series mayores
siguientes de streamdown e imapflow. Ninguna es necesaria para cerrar los avisos críticos y altos
de producción.

## 6. Verificación

Core, después de cada grupo de cambios (contenedor MySQL 8.4 desechable propio):

- Suites unitarias bloqueantes del CI: 1072 pruebas en verde, 1 omitida. El fichero
  `server/tscBaseline.test.ts` ya fallaba al cargarse en Windows antes de los cambios (no lo afecta
  esta rama).
- `node scripts/ci/tsc-baseline.mjs`: 10 errores, igual que la línea base (sin errores nuevos).
- Suites de integración con MySQL real: 37 ficheros y 238 pruebas en verde, igual que antes.
- `pnpm build` y `pnpm build:cp` correctos. El servidor construido arranca
  (`Server running on http://localhost:…`).
- Pruebas de humo: PDF real con puppeteer-core 25, envío con `streamTransport` de nodemailer 10
  leído con mailparser, y lectura y escritura con xlsx 0.20.3 comparadas con la 0.18.5.

CRM: `pnpm test` 78/78, `pnpm typecheck` y `typecheck:e2e` sin errores, `vite build` correcto; una
aserción saboteada a propósito se detectó como fallo. Web: `astro check` sin errores, `pnpm test`
69/69 (incluye la construcción de 71 páginas), `pnpm e2e` 36/36 con Playwright.
