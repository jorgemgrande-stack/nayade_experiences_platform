# Stripe en la cuenta real: preparación sin activación (18/10/2026)

**Estado:** diseño y catálogo preparados. **Ningún cobro, Checkout ni suscripción real está activo**, y el código de Elephant Source sigue funcionando **solo en modo pruebas**. Activar la cuenta real exige los cambios y las decisiones del §6.

| | Sandbox (hoy) | Real (preparado) |
|---|---|---|
| Cuenta Stripe | `acct_1URULO5wMYhQ9O0d` («Entorno de prueba de Iron Elephant Consulting») | `acct_1URULE9RzfmCBuai` (Iron Elephant Consulting) |
| Catálogo | `STRIPE_FASE_B.md` §2 | §2 de este documento |
| Customer Portal | `bpc_1URoSX5wMYhQ9O0dlC4viuZQ` | §3 |
| Webhook | `…/cp/v1/stripe/webhook` del CRM, activo | §4: creado **desactivado** y sin secreto guardado |
| Railway | `controlplane` del entorno `production`, BD `es_crm` | §5: entorno propio, **no creado** |

## 1. Por qué la configuración real no puede compartir servicio ni base

El modo pruebas se impone en tres capas, a propósito:

1. **Configuración** (`server/stripe/config.ts`): solo admite `CP_STRIPE_MODE=test` y claves `rk_test_`/`sk_test_`. Si existe **cualquier** variable `CP_STRIPE_*LIVE*` o `STRIPE_LIVE*`, el servicio **no arranca**.
2. **Acceso a Stripe** (`gateway.ts`): `assertTestObject` rechaza todo objeto con `livemode` distinto de `false`.
3. **Base de datos** (migración `0012`): las 6 tablas que guardan objetos de Stripe tienen `CHECK (livemode = 0)`. Lo mismo hace `commercial_payments.mode`, que solo admite `test`.

**Consecuencia:** ninguna variable de la cuenta real se añade a `controlplane` ni a ningún servicio actual. Si se añadiera, el servicio dejaría de arrancar.

## 2. Catálogo real

Mismos productos, importes, `lookup_key` y metadatos que en el sandbox. El código busca los precios por `lookup_key`, y la separación la garantizan la cuenta, la clave y la base de datos. Los **identificadores** (`prod_…`, `price_…`) son distintos en cada cuenta y nunca se mezclan.

| Producto | Precio | `lookup_key` | Importe | Periodicidad | `tax_behavior` |
|---|---|---|---|---|---|
| Elephant Core Essential | mensual | `es:essential:monthly:eur:v1` | 29,00 € | mes | `exclusive` |
| Elephant Core Essential | anual | `es:essential:yearly:eur:v2` | 279,00 € | año | `exclusive` |
| Elephant Core Business | mensual | `es:business:monthly:eur:v3` | 79,00 € | mes | `exclusive` |
| Elephant Core Business | anual | `es:business:yearly:eur:v4` | 759,00 € | año | `exclusive` |

**Metadatos:**
- Productos: `es_product_key`, `es_catalog: elephant-source`.
- Precios: `es_product_key`, `es_web_price_id` (1 a 4) y `es_kind`.

**Creados el 18/10/2026** con el MCP oficial, tras comprobar `acct_1URULE9RzfmCBuai` con `livemode=true`. Antes de crearlos, la cuenta no tenía productos, precios, configuraciones del Portal, webhooks ni suscripciones.

| Plan | Product (real) | Periodicidad | Price (real) | `lookup_key` |
|---|---|---|---|---|
| Essential | `prod_VSqwbFbHJBJT4a` | mensual | `price_1URvF69RzfmCBuaiFWdFedMo` | `es:essential:monthly:eur:v1` |
| Essential | `prod_VSqwbFbHJBJT4a` | anual | `price_1URvF69RzfmCBuaiO4hmktlD` | `es:essential:yearly:eur:v2` |
| Business | `prod_VSqwCAsTiDICLp` | mensual | `price_1URvF79RzfmCBuaiZEzlexLf` | `es:business:monthly:eur:v3` |
| Business | `prod_VSqwCAsTiDICLp` | anual | `price_1URvF79RzfmCBuaixUnQ3Pj6` | `es:business:yearly:eur:v4` |

**Stripe Tax en la cuenta real:** ya estaba **activo** (`status: active`, sede en Madrid y código por defecto `txcd_10103001`). No se ha cambiado. Los precios llevan `tax_behavior: exclusive`, y ningún Checkout real existe todavía. La política fiscal del §6 decidirá si se usa `automatic_tax`.

**Riesgo:** crear productos y precios no cobra nada. Un precio no puede cambiar de importe; si se aprueba otro, se crea otra `lookup_key`.

## 3. Customer Portal real

Las mismas reglas que en el sandbox:
- historial de facturas activado;
- cambio del método de pago activado;
- cancelación a final de periodo, sin prorrateo y preguntando el motivo (las 8 opciones de Stripe);
- cambios de plan, edición de datos del cliente, pausa y página de acceso pública **desactivados**.

`business_profile` queda sin las URL de condiciones y privacidad hasta que se publiquen los textos legales. Antes de activar la cuenta real hay que añadirlas.

## 4. Webhook real

- **Creación:** lo crea el propietario en el Dashboard de la cuenta **real**, con los mismos 18 eventos, carga snapshot y API `2026-09-30.endive`, y lo **desactiva** nada más crearlo.
- **URL:** la del servicio de producción real (§5). Mientras ese servicio no exista, la URL del CRM actual con el destino desactivado. Al activarlo se cambiará.
- **Secreto:** **no** se guarda en ningún sitio. Al activar la cuenta se rotará («Roll secret») y el nuevo se introducirá directamente en la variable del entorno real.
- **Por qué desactivado:** el `controlplane` actual rechazaría los eventos live (firma con otro secreto y `livemode=true`). Stripe reintentaría durante días y enviaría avisos de fallo.

## 5. Railway: configuración real independiente (diseño, no creada)

**Recomendación:** un **entorno de Railway propio** (por ejemplo, `live`) dentro del proyecto Elephant Source, con sus servicios, su MySQL y sus variables. No hay nada compartido con `production`, que hoy aloja la integración del sandbox.

| Pieza | Sandbox (`production`) | Real (`live`, futuro) |
|---|---|---|
| Base de datos del CRM | `es_crm` del MySQL actual | MySQL propio del entorno `live` |
| Clave | `CP_STRIPE_API_KEY` = `rk_test_…` | `CP_STRIPE_API_KEY` = `rk_live_…`, con los mismos permisos mínimos, solo en `live` |
| Secreto del webhook | `whsec_` del destino del sandbox | `whsec_` del destino real, rotado al activar |
| Modo | `CP_STRIPE_MODE=test` | `CP_STRIPE_MODE=live` (**requiere el cambio de código del §6**) |
| Prefijo | `CP_STRIPE_NAMESPACE=beta` | `CP_STRIPE_NAMESPACE=live` |
| Dominios | `*.up.railway.app` actuales | dominio propio |
| Copias | `backup-job` del entorno actual | `backup-job` propio, con su propio llavero `BACKUP_KEYS` |

**Por qué un entorno y no un servicio más:**
- **Variables:** las de cada entorno son independientes, así que es imposible confundir claves.
- **Base de datos:** un MySQL propio permite levantar el `CHECK (livemode = 0)` solo allí.
- **Despliegues:** se despliega cada uno sin tocar el otro.

### 5.1 Servicios del entorno `live`

| Servicio | Función | Necesario en `live` |
|---|---|---|
| `MySQL` | `es_registry`, `es_crm` y una base por empresa | Sí, propio, con volumen |
| `controlplane` | API de operador, pública y webhook de Stripe | Sí |
| `core` | Aplicación de las empresas | Sí |
| `crm` | Pasarela y SPA del CRM, con la excepción del webhook | Sí |
| `web` | Web comercial y contratación | Sí |
| `core-gateway` + una pasarela por empresa | Entrada a `core` por `Host` | Con un dominio propio y comodín, **una sola** pasarela para todas las empresas (hoy hay una por empresa porque Railway da un dominio por servicio) |
| `backup-job` | Copias cada 15 min (tarea programada) | Sí, con su bucket y su llavero propios |
| `restore-drill` | Ensayos y operaciones puntuales | Sí, sin coste mientras no se ejecuta |
| Bucket de copias | Almacenamiento de copias, dentro de Railway | Sí, **propio** (no un prefijo del actual) |
| Bucket de ficheros | Ficheros de las empresas | Sí, propio |

### 5.2 Coste mensual estimado

**Base del cálculo:**
- **Tarifas oficiales de Railway** (`docs.railway.com/reference/pricing/plans`, leídas el 18/10/2026): RAM a 10 $/GB-mes, CPU a 20 $/vCPU-mes, volumen a 0,15 $/GB-mes y salida de red a 0,05 $/GB. Los buckets no figuran en esa página; se estiman como almacenamiento S3 (céntimos por GB).
- **Consumo:** el **medido** en el entorno actual durante las últimas 24 h (`railway metrics -a -S 1d`), con 4 empresas de demostración.

| Servicio | Memoria medida | Coste de RAM | CPU (< 0,01 vCPU) |
|---|---|---|---|
| MySQL (con `innodb-buffer-pool-size=1G`) | 1,13 GB | 11,3 $ | ~0,2 $ |
| `core` | 172 MB | 1,7 $ | ~0,2 $ |
| `controlplane` | 78 MB | 0,8 $ | ~0,2 $ |
| `web` | 54 MB | 0,5 $ | ~0,2 $ |
| `crm` | 40 MB | 0,4 $ | ~0,2 $ |
| `core-gateway` (una sola, con comodín) | 38 MB | 0,4 $ | ~0,2 $ |
| `backup-job` (solo mientras se ejecuta) | 56 MB, unos 30 min al día | < 0,1 $ | < 0,1 $ |
| Volumen MySQL | 1,27 GB | 0,2 $ | — |
| Buckets y salida de red | MB | < 0,5 $ | — |
| **Total `live` en reposo** | | **≈ 16–18 $/mes** | |

**Variantes:**
- **Ajuste recomendado** (`innodb-buffer-pool-size=256M`, suficiente para decenas de empresas pequeñas): MySQL baja a unos 0,4 GB y el total, a **≈ 9–11 $/mes**.
- **Con clientes reales:** el coste crece sobre todo con la memoria de `core` y de MySQL. Como referencia, con 50 empresas activas (1 GB de buffer, 0,5 GB en `core` y 0,1 vCPU sostenida) serían **≈ 25–35 $/mes**.
- **Plan de Railway:** las cuotas del plan (Hobby 5 $ o Pro 20 $ al mes, con ese mismo importe de uso incluido) son por espacio de trabajo y ya las cubren los proyectos actuales. El coste adicional real es el uso que supere lo incluido.

### 5.3 Qué se puede compartir sin perder el aislamiento

| Se comparte | Por qué es seguro |
|---|---|
| Espacio de trabajo y plan de Railway | Facturación, no datos |
| Repositorios, CI y commits desplegados | Mismo código, desplegado por separado en cada entorno |
| Proyecto de Railway «Elephant Source» | Las variables, servicios, volúmenes y redes privadas son **por entorno** |
| Cuenta de Brevo (cuando se active el correo) | Con una clave de API y un dominio de envío propios del entorno real |

| **No** se comparte | Motivo |
|---|---|
| MySQL, volúmenes y bases | Datos de clientes reales; el `CHECK (livemode = 0)` debe poder levantarse solo en `live` |
| Buckets de copias y ficheros | Una restauración o una retención nunca deben alcanzar el otro entorno |
| `REGISTRY_KEYS`, `BACKUP_KEYS`, `INTEGRATION_KEYS`, `CP_SESSION_SECRET`, `JWT_SECRET`, `SUPPORT_JWT_SECRET`, `CP_TOKENS` y tokens de pasarela | Una clave filtrada de un entorno no debe abrir el otro |
| Clave y secreto del webhook de Stripe | Cuentas distintas |
| Dominios | Cada entorno con los suyos |

**Riesgo al crear el entorno:** Railway permite **duplicar** un entorno, y eso copia **todas** sus variables, incluidas la clave del sandbox y `BACKUP_KEYS`. El entorno `live` debe crearse **vacío** y con secretos generados de nuevo, nunca como copia de `production`.

**Coste y autorización:** duplica servicios y base de datos (§5.2). **No se ha creado ningún recurso.** Requiere autorización.

## 6. Antes de activar la cuenta real (pendiente)

1. **Código (fase de activación):**
   - modo `live` explícito y separado del de pruebas;
   - `assertTestObject` según el modo;
   - migración del carril CRM solo para el entorno real que permita `livemode = 1`;
   - `commercial_payments.mode = 'live'`;
   - sustituir el tratamiento `test_net_no_tax` por el fiscal definitivo.

   Todo con pruebas. Hoy **no existe**.
2. **Fiscal:** política de IVA, Stripe Tax (sede, registros), emisor y numeración de facturas. Ver `FISCALIDAD_STRIPE.md`.
3. **Legal:** condiciones y privacidad publicadas (`CP_TERMS_VERSION`), y las URL en el Portal y en Checkout.
4. **Cuenta real:** activación completa en Stripe (datos de la empresa, cuenta bancaria, verificación).
5. **Infraestructura:** entorno `live` en Railway, dominio propio y copias.
6. **Autorización expresa del propietario** para cada paso.

## 7. Qué hace falta del propietario ahora

- ~~Conectar la cuenta real al MCP de Stripe~~. **Hecho el 18/10/2026**: catálogo y Portal creados (§2 y §3).
- **Crear el webhook real desactivado** (§4), sin guardar su secreto. Opcional: puede esperar a la activación.
- **Decidir sobre el entorno `live`** de Railway (§5.2).
