# 🔍 Diagnóstico: Lego Packs — Configuración de Líneas Editables

## Problema Reportado

Los Lego Packs tienen líneas configurables en el **admin** (Opcional/Obligatoria), pero:
- ❌ En **ecommerce** (página pública): El cliente **NO puede editar/quitar/añadir** actividades
- ❌ En **TPV** (administrador): El **NO puede configurar el producto** cuando lo vende

---

## Análisis Técnico

### 1. Backend — Estructura de Datos

**Archivo:** `server/routers/legoPacks.ts` línea 67
```typescript
isClientEditable: z.boolean().default(false),  // ← EXISTE el campo
```

**Estado:**
- ✅ La BD **soporta** lineas editables (campo `isClientEditable` en tabla `lego_pack_lines`)
- ✅ El schema permite marcas líneas como `isOptional: true`
- ✅ El backend calcula precios dinámicos según líneas activas (`calculateLegoPackPrice`)

### 2. Frontend — Ecommerce (Cliente Final)

**Archivo:** `client/src/pages/LegoPackDetail.tsx`

**Estado:**
```typescript
// Línea 108: Solo muestra líneas visibles — SIN EDICIÓN
const visibleLines = (pricing?.lines ?? []).filter((l) => l.isClientVisible);

// Línea 242: Renderiza como READ-ONLY
{visibleLines.map((line) => (
  <div className="flex items-center justify-between">
    {/* Solo muestra info: nombre, precio, badge "Opcional" */}
    {/* ❌ NO hay inputs para toggle/editar cantidad */}
  </div>
))}
```

**Problema:**
- ❌ Las líneas `isOptional` muestran badge "Opcional" pero no hay checkbox/toggle para deseleccionar
- ❌ Las líneas `isQuantityEditable` no permiten cambiar cantidad
- ❌ NO hay forma de añadir/quitar actividades
- ❌ El carrito toma un "snapshot" de la configuración predefinida, sin personalización

**Resultado:** El cliente ve "Pack con 8 actividades" pero **NO puede personalizar** cuál desea, aunque la configuración admin marque actividades como opcionales.

### 3. Frontend — TPV (Admin que Vende)

**Archivo:** `client/src/pages/admin/tpv/TpvScreen.tsx`

**Estado:**
```typescript
// Línea 31: Lego Packs están soportados como tipo de producto
type ProductType = "experience" | "pack" | "spa" | "hotel" | "restaurant" | "extra" | "legoPack";

// Pero NO hay UI para configurar líneas del pack
```

**Problema:**
- ❌ Cuando el admin **añade un Lego Pack al carrito en TPV**, no ve opciones para:
  - Quitar actividades opcionales
  - Cambiar cantidades
  - Modificar precios/descuentos de líneas
- ❌ Se vende el pack "como está" sin posibilidad de adaptarlo a lo que el cliente solicita en el mostrador

**Resultado:** El admin vuelve a pedir "hace falta poder editar el pack en TPV para adaptarlo al cliente"

---

## Impacto

| Contexto | Impacto |
|----------|---------|
| **Ecommerce** | Cliente compra pack fijo → sin personalización → baja conversión si quiere un combo diferente |
| **TPV** | Admin vende pack fijo → debe crear presupuesto manual si cliente quiere cambios → fricción |
| **CRM** | Presupuestos personalizados incluyen este control → incoherencia UX entre canales |

---

## Solución Requerida

### Fase 1: Ecommerce (Cliente Final) — **PRIORITARIO**

**En `LegoPackDetail.tsx`:**
1. Para cada línea con `isOptional: true`:
   - Mostrar **checkbox/toggle** para marcar como "incluido" o "no incluido"
2. Para líneas con `isQuantityEditable: true`:
   - Mostrar **input numérico** para cambiar cantidad
3. Al cambiar configuración:
   - **Recalcular precio dinámicamente** llamando a `legoPacks.calculateLegoPackPrice` con las líneas seleccionadas
   - Actualizar "Total estimado" en el widget de precio lateral
4. Al añadir al carrito:
   - Pasar **selección personalizada** (qué líneas + cantidades) al contexto de carrito

**Impacto técnico:**
```typescript
// Pseudo-código
const [selectedLines, setSelectedLines] = useState(new Set());
const activeLineIds = Array.from(selectedLines);
const { data: customPrice } = trpc.legoPacks.calculateLegoPackPrice.useQuery({
  legoPackId: pack.id,
  activeLineIds,
});
```

### Fase 2: TPV (Admin que Vende) — **IMPORTANTE**

**En `TpvScreen.tsx` + nuevo componente `LegoPackLineSelector`:**
1. Cuando el admin **hace clic en un Lego Pack** para añadirlo al carrito:
   - Abrir **modal/panel lateral** con la misma interfaz que ecommerce
   - Permitir activar/desactivar líneas opcionales
   - Permitir cambiar cantidades si `isQuantityEditable: true`
   - Mostrar **precio total personalizado** en tiempo real
2. Al confirmar:
   - El pack se añade al carrito con la **configuración personalizada**

**Impacto técnico:**
```typescript
// Nuevo componente reutilizable
<LegoPackLineSelector 
  packId={pack.id} 
  onConfirm={(activeLineIds, customPrice) => addItemToCart(...)}
/>
```

---

## Checklist de Implementación

### Ecommerce
- [ ] Crear estado `selectedLineIds` en `LegoPackDetail.tsx`
- [ ] Renderizar checkbox para líneas `isOptional`
- [ ] Renderizar input cantidad para líneas `isQuantityEditable`
- [ ] Llamar a `legoPacks.calculateLegoPackPrice` dinámicamente
- [ ] Actualizar "Total estimado" al cambiar selección
- [ ] Pasar `selectedLineIds` al carrito al hacer click "Añadir al carrito"
- [ ] Probar: cambiar checkbox → precio actualiza → carrito tiene configuración personalizada

### TPV
- [ ] Crear componente `LegoPackLineSelector` (modal reutilizable)
- [ ] Modificar lógica de clic en Lego Pack en TPV para abrir el selector
- [ ] Integrar con `calculateLegoPackPrice`
- [ ] Pasar configuración personalizada al carrito del TPV
- [ ] Probar: admin elige pack → abre selector → personaliza → precio correcto → se añade al carrito

---

## Notas Adicionales

### ¿Por qué no funciona ahora?

El código backend **está completo** (`isClientEditable`, `isOptional`, `calculateLegoPackPrice`), pero **no fue conectado al frontend**. Es probable que:
1. La feature se implementó en backend primero
2. El frontend se quedó a mitad del camino (solo muestra líneas, no las edita)
3. Nunca se completó el componente de selector para TPV

### Datos que ya están en BD

```sql
lego_pack_lines.isOptional          -- ¿Se puede desseleccionar?
lego_pack_lines.isClientEditable    -- ¿Puede editar cliente?
lego_pack_lines.isQuantityEditable  -- ¿Puede cambiar cantidad?
```

Todos estos campos están listos. Solo falta la **UI para interactuar** con ellos.

### Backend ya soporta

- `legoPacks.calculateLegoPackPrice(packId, activeLineIds[])` — calcula dinámicamente
- La BD almacena configuración personalizada en `lego_pack_snapshots` (si aplica)

---

## Estimación de Esfuerzo

| Tarea | Esfuerzo | Notas |
|-------|----------|-------|
| Ecommerce (selector cliente) | 2-3 horas | Componente simple, reutiliza estado + estilo existente |
| TPV (selector admin) | 1-2 horas | Reutiliza componente de ecommerce en modal |
| Testing e integración | 1 hora | Verificar carrito + precios calculados correctamente |
| **Total** | **4-6 horas** | Feature de bajo riesgo, alto valor |

---

## Recomendación

✅ **Implementar Fase 1 (Ecommerce) primero** — Cliente final es la prioridad  
✅ **Luego Fase 2 (TPV)** — Admin venta personalizada es secundaria pero solicitada

Ambas phases usan el mismo componente base, por lo que la arquitectura es escalable.

