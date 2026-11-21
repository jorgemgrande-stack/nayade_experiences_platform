# Idioma de la interfaz del panel (i18n)

Capacidad estructural de Elephant Core: cada persona elige el idioma de **su** interfaz (español `es-ES` o alemán `de-DE`). Preparado para añadir inglés y francés sin tocar la arquitectura.

## Idioma de interfaz ≠ idioma de contenido

Solo se traduce la **interfaz** (menús, botones, etiquetas, validaciones, avisos). **Nunca** se traducen ni se modifican: cursos y materiales, productos y descripciones, páginas públicas, documentos, facturas, contratos, mensajes de clientes ni ningún dato guardado. El idioma de contenido de la web pública (`shared/i18n.ts`) y el del aula de Learning (`shared/learningText.ts`) son otros sistemas y no cambian.

## Piezas

| Pieza | Dónde |
|---|---|
| Núcleo puro (traductor, plurales, formatos, resolución de idioma) | `shared/i18n/core.ts` |
| Diccionarios por espacio de nombres | `shared/i18n/locales/<es|de>/<espacio>.ts` |
| Etiquetas del menú (texto español → alemán) | `shared/i18n/navLabels.ts` |
| Proveedor, hooks `useI18n()` / `useFormat()` y selector | `client/src/i18n/` |
| Preferencia por usuario (servidor) | `server/uiLocale.ts`, `server/routers/uiLocale.ts`, tabla `user_ui_prefs` (migración 0085) |
| Pruebas | `server/panelI18n.test.ts` |

## Contrato para un módulo nuevo (o una pantalla que se traduce)

1. Crea `shared/i18n/locales/es/<espacio>.ts` (`export default { ... }`). El español es la fuente de verdad de las claves.
2. Crea `shared/i18n/locales/de/<espacio>.ts` con `satisfies Mirror<typeof es>` (copia `locales/de/shell.ts`): si falta una clave o sobra una, **no compila**.
3. No hay lista central: los ficheros se descubren solos (`import.meta.glob`), así que dos ramas no chocan.
4. En el componente: `const { t } = useI18n(); t("espacio.grupo.clave", { n })`. Claves literales (las valida la prueba).
5. Fechas, números y monedas: `const f = useFormat(); f.date(x)`, `f.currency(x)`, `f.number(x)`. Nada de `toLocaleString("es-ES")` ni `toFixed(2) + "€"` fijos.
6. Plurales y parámetros con la sintaxis ICU reducida: `"{count, plural, =0 {Ninguno} one {# cliente} other {# clientes}}"`, `"Hola {name}"`.
7. Tonos: alemán informal (**du**), igual que el aula de Learning. Términos de producto (Elephant Studio, Copilot…) no se traducen.

## Garantías (pruebas)

- Mismas claves y mismos parámetros en `es` y `de`; sin textos vacíos.
- Toda clave `t("…")` usada en `client/src` existe en español.
- Cada etiqueta del menú (incluidas las de extensiones) tiene traducción alemana.
- Ante una clave ausente se usa el español (nunca una pantalla rota); en desarrollo avisa por consola.

## Persistencia y aislamiento

- `uiLocale.get/set` leen y escriben solo la fila del usuario de la sesión, en la base de datos de **su** empresa. No cambian el idioma de otros usuarios ni datos de la empresa.
- Respaldo en el navegador con clave por usuario (`panel.uiLocale.<id>`) para pintar sin parpadeo; en modo soporte no se escribe en el servidor.
- Si la migración 0085 aún no está aplicada, el panel funciona con el respaldo del navegador.

## Añadir un idioma (inglés, francés…)

1. Añádelo a `LOCALES` y `LOCALE_META` (`core.ts`) y a `Catalog`.
2. Crea `locales/<idioma>/<espacio>.ts` para cada espacio existente y su entrada en `navLabels.ts`.
3. Las pruebas de paridad fallan hasta que esté completo.
