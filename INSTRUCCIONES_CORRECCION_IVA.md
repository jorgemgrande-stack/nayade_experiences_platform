# 🔧 Corrección de Bug IVA en Nayade Experiences Platform

## Estado Actual ✅
- ✅ Código corregido (**commit `ba96e49` en main**)
- ✅ Desplegado en Railway (Build automático)
- ⏳ **Pendiente:** Ejecutar correcciones en producción

---

## 📋 Resumen del Bug

**Problema:** 4 facturas emitidas con cálculo incorrecto de IVA (sumado "encima" en lugar de extraído correctamente).

| Factura | Estado | Sobrecoste | Requiere |
|---------|--------|-----------|----------|
| **FAC-2026-0083** | Abonada | 0,17 € | Ajuste documental |
| **FAC-2026-0085** | Generada | 5,21 € | Ajuste documental |
| **FAC-2026-0147** | Enviada | 26,03 € | Ajuste documental |
| **FAC-2026-0120** | Cobrada | **56,40 €** | **⚠️ DEVOLUCIÓN + ABONO** |

**Total a devolver:** 88,00 €

---

## 🚀 Cómo Ejecutar las Correcciones

### Paso 1: Acceder al Panel de Admin
```
https://www.nayadeexperiences.es/admin
```

### Paso 2: Abrir Consola del Navegador (F12)
```javascript
// En la pestaña "Console", ejecutar:
const fiscalAudit = await fetch('/api/trpc/fiscalAudit.auditInvoicesIVA', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});
const result = await fiscalAudit.json();
console.log(result);
```

**Alternativa:** Usar la terminal del servidor:
```bash
cd /ruta/a/nayade_experiences_platform
railway run pnpm tsx -e "console.log('Endpoints listos')"
```

### Paso 3: Ejecutar la Corrección (⚠️ IRREVERSIBLE)
```javascript
// En la consola del navegador:
const fix = await fetch('/api/trpc/fiscalAudit.fixInvoicesIVA', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': document.cookie  // Para autenticación
  },
  body: JSON.stringify({})
});
const result = await fix.json();
console.log(result);
```

---

## ✅ Qué Pasa Después de la Corrección

### Facturas Corregidas (FAC-2026-0083/0085/0147):
- ✅ Subtotal recalculado (base imponible correcta)
- ✅ TaxAmount recalculado (IVA correcto al 21%)
- ✅ Total ajustado al valor correcto
- ✅ TaxBreakdown actualizado

### Factura FAC-2026-0120:
- ✅ Total reducido de 381,40 € a 325,00 € (sobrecobro -56,40 €)
- ✅ Se genera automáticamente: **ABO-2026-0120-01** (abono por -56,40 €)
- ⚠️ **ACCIÓN MANUAL:** Contactar al cliente para devolución de 56,40 €

---

## 📧 Acciones Posteriores Necesarias

### 1. **Devolución Cliente** (FAC-2026-0120)
```
Cliente: [BUSCAR EN BD]
Email: [BUSCAR EN BD]
Monto a devolver: 56,40 €
Referencia: FAC-2026-0120 / Corrección IVA
```

### 2. **Actualizar Modelo 303 (Hacienda)**
- Incluir abono **ABO-2026-0120-01** en la próxima declaración
- Total de rectificaciones: -88,00 € en IVA repercutido

### 3. **Auditoría Interna**
- Revisar sistema de cálculo de IVA (ya está corregido en código)
- Verificar que NO hay más facturas con este bug (auditoría SQL disponible en `scripts/audit-invoices-iva.ts`)

---

## 🔍 Verificación Post-Corrección

### En Panel de Admin:
1. Ir a **Gestión → Tributación de IVA**
2. Verificar que el IVA 18.17% ha desaparecido
3. Todos los porcentajes deben ser **21%** ahora

### En BD (SQL):
```sql
SELECT invoiceNumber, subtotal, taxAmount, total, status 
FROM invoices 
WHERE invoiceNumber IN ('FAC-2026-0083', 'FAC-2026-0085', 'FAC-2026-0147', 'FAC-2026-0120', 'ABO-2026-0120-01');
```

**Esperado:**
```
FAC-2026-0083 | 0.83    | 0.17   | 1.00    | abonada
FAC-2026-0085 | 24.79   | 5.21   | 30.00   | generada
FAC-2026-0147 | 123.97  | 26.03  | 150.00  | enviada
FAC-2026-0120 | 268.60  | 56.40  | 325.00  | cobrada
ABO-2026-0120-01 | -46.61 | -9.79 | -56.40 | generada
```

---

## ⚠️ Notas Importantes

1. **La corrección es irreversible** — Una vez ejecutada, no hay marcha atrás sin intervención manual en BD
2. **FAC-2026-0120 es PRIORITARIO** — Es un sobrecobro real que requiere devolución al cliente
3. **Logs de ejecución** — Se registra en consola del servidor quién ejecutó la corrección y cuándo
4. **Impacto fiscal** — Actualizar Modelo 303 para próxima declaración a Hacienda

---

## 🎯 Checklist Final

- [ ] Leer y entender este documento
- [ ] Hacer backup de BD (por precaución)
- [ ] Ejecutar auditoría (`auditInvoicesIVA`) para verificar facturas
- [ ] Ejecutar corrección (`fixInvoicesIVA`)
- [ ] Verificar en admin que Modelo 303 se actualizó
- [ ] Procesar devolución de 56,40 € a cliente (FAC-2026-0120)
- [ ] Documentar acciones en Jira/sistema interno
- [ ] Comunicar a gestoría para actualizar Modelo 303

---

## 📞 Soporte

Si hay problemas:
1. Revisar logs de Railway: `railway logs --follow`
2. Revisar BD: Verificar que los datos se actualizaron correctamente
3. Contactar con desarrollador si hay errores

