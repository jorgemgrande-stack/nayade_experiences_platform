# Espacio vertical de la sección (Elephant Studio)

**Para qué.** Cada sección con columnas llevaba un relleno vertical fijo (`py-8 md:py-10`) que ningún control del bloque alcanzaba.
Con varias secciones seguidas sumaban unos 80 px de aire muerto entre una imagen y el título siguiente (fichas de retiro de Quantum).

**Qué hay.** Una opción nueva de la sección, «Espacio vertical de la sección» (`vspace`), en la pestaña Diseño:

| Valor | Relleno | Cuándo |
|---|---|---|
| Normal (por defecto) | `py-8 md:py-10`, el de siempre | Toda sección existente y toda sección nueva |
| Reducido | `py-3 md:py-4` | Fichas con secciones seguidas |
| Sin espacio | `py-0` | Cuando el bloque ya trae su propio aire |

**Alcance.** Solo las secciones de primer nivel: dentro de una columna el relleno ya lo fija la columna (`COLUMN_CLASS`).
Está desactivada por defecto: una página guardada antes de la opción se sanea a «Normal» y se ve igual. No toca fotos, textos ni datos comerciales,
y no cambia ninguna otra empresa mientras nadie la active.

**Reversión.** Cualquiera de estas dos, sin tocar código:
1. En el editor, la sección → Diseño → «Espacio vertical de la sección» → Normal.
2. Historial de versiones de la página (`cms.restorePageVersion`) y publicar de nuevo.

Si hubiera que retirar la opción del Core, bastaría con volver al commit anterior: el dato `vspace` extra se descarta al normalizar.

Pruebas: `server/studioSeccionEspacio.test.ts`.
