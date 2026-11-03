# Prueba real de extremo a extremo de los dominios propios (production)

**Estado (04/11/2026):** preparada, **sin ejecutar**. No se ha registrado ni modificado ningún dominio ni creado ninguna empresa.

Lo que ya está en production y comprobado:

- Pasarela con dominios propios activos públicos (PR #629, merge `0a7f8530`) en `core-gateway`, `core` y `controlplane`.
- `CP_RAILWAY_DOMAIN_TOKEN` en `controlplane`: token de proyecto del entorno production; la API responde y lista los
  dominios de `core-gateway` con sus registros DNS (acción de solo lectura `dominios-estado`). El alta
  (`customDomainCreate`) no se ha ejercitado todavía: esta prueba es la primera.

## 1. Decisiones previas (Jorge)

| Decisión | Por qué | Ejemplo |
|---|---|---|
| **Subdominio de ensayo** | Debe colgar de un dominio que controléis **y que no sea `bigelephant.es`**: el panel rechaza `bigelephant.es`, `railway.app` y los dominios de la plataforma (`RESERVED_SUFFIXES` en `server/controlPlane/customDomains.ts`). | `prueba-dominio.<dominio-vuestro>.es` |
| **Empresa de ensayo** | Aislada y propia (nunca Skibox ni un cliente real). Ver § 1.1: cómo habilitar el dominio propio sin cobro. | «PRUEBA dominios 2026-11» |
| **Quién toca el DNS** | Los registros se crean a mano en el proveedor del dominio (no hay acceso por API). | Jorge, en el panel del proveedor |

## 1.1 Empresa de ensayo y dominio propio sin cobro

**Qué exige el alta** (`customDomainAllowance` en `server/controlPlane/api.ts`, reglas en `server/commercialState.ts`):

- primer pago confirmado **o** empresa exenta (`customDomainDecision`);
- si la empresa tiene licencias, la licencia `cms-domain` activa (salvo exenta);
- un tope de 3 dominios propios (`DEFAULT_MAX_CUSTOM_DOMAINS`) sin motor de suscripciones.

**Vías que contempla el código:**

| Vía | Qué deja registrado | ¿Para la prueba? |
|---|---|---|
| Exención explícita `TRIAL_RESTRICTIONS_EXEMPT_TENANTS` (lista de tenants separada por comas) | Una variable de entorno; ningún registro comercial | **Sí: es el mecanismo administrativo previsto y el mínimo** |
| Pedido del orquestador con confirmación `admin_approval` | Un pedido en el historial comercial | No: altera el historial comercial |
| Licencia de pago sin caducidad (alta asistida) | Una licencia en Elephant Control | No: equivale a dar de alta un plan |
| Simular un pago o tocar facturas | — | **Prohibido** |

**Procedimiento mínimo (Jorge):**

1. Crear la empresa de ensayo por el alta normal de prueba gratuita, con un nombre inequívoco (p. ej. «PRUEBA dominios 2026-11») y un correo vuestro. Anotar su identificador de tenant (lo muestra el CRM).
2. En Railway → production → servicio `controlplane` → Variables: `TRIAL_RESTRICTIONS_EXEMPT_TENANTS=t5-skibox,<tenant-de-ensayo>` y redesplegar. **Hay que incluir `t5-skibox`:** si la variable existe, manda exactamente su contenido y deja fuera la lista por defecto.
3. Solo en `controlplane`: así la exención afecta al dominio propio (y a la cuota y vencimiento de la prueba de esa empresa en el plano de control), pero no a las restricciones del Core (correo e integraciones de la prueba siguen activas para la empresa de ensayo).
4. Claude comprueba que el panel de la empresa de ensayo ofrece «Paso 1 · Escribe tu dominio» sin el aviso de primer pago.

**Al terminar:** quitar el tenant de ensayo de la variable (dejar `t5-skibox` o borrar la variable para volver a la lista por defecto) y añadir la empresa a la purga controlada de empresas de prueba (`PURGE_TARGETS` en `server/_core/ops/purgeTestCompanies.ts`, lista cerrada) para eliminarla con su simulación previa.

## 2. Procedimiento

Cada paso indica quién lo hace. «Claude» = comprobaciones y acciones de solo lectura desde la sesión;
nada de esto modifica DNS ni variables.

| # | Quién | Acción | Resultado esperado |
|---|---|---|---|
| 0 | Claude | `dominios-estado` (production) y `dig` del subdominio en el servidor autoritativo y en 1.1.1.1 | Token operativo; el subdominio no existe todavía (NXDOMAIN) |
| 1 | Jorge o Claude con sesión de la empresa | Panel de la empresa → **Web → Dominio propio** (`/admin/configuracion/dominios`) → «Paso 1 · Escribe tu dominio» → el subdominio | Estado **Pendiente de verificación**; el panel muestra el TXT `_elephant-verify.<subdominio>` con su valor |
| 2 | Jorge | Crear el TXT en el proveedor del dominio (TTL 300) | `dig TXT _elephant-verify.<subdominio>` devuelve el valor |
| 3 | Panel | «Ya lo he creado: comprobar» | Estado **Verificado**; el plano de control da de alta el dominio en `core-gateway` (Railway, puerto 8080) |
| 4 | Claude | `dominios-estado` | El subdominio aparece en `core-gateway` con sus registros (CNAME y, si Railway lo pide, `_acme-challenge`) |
| 5 | Jorge | Crear en el proveedor **exactamente** los registros que muestra el panel (los da la API de Railway; nunca uno inventado) | `dig` los devuelve propagados |
| 6 | Railway | Emite el certificado | `dominios-estado`: certificado `VALID` |
| 7 | Panel / automático | «Comprobar ahora» (o la comprobación cada 5 min) | `https://<subdominio>/.well-known/elephant-domain-check` responde el valor de la empresa → estado **Activo** |

## 3. Comprobaciones tras la activación (Claude)

- `https://<subdominio>/` → 200 con la web pública de la empresa de ensayo (título y contenido suyos).
- `http://<subdominio>/` → redirección a https.
- `https://<subdominio>/admin` → pide iniciar sesión (no expone el panel).
- `https://<subdominio>/_ops/public-host` → 404 (ruta interna, no pública).
- Otro host inventado apuntando a la pasarela → 404; los dominios técnicos de Railway siguen con 401.
- Cabeceras falsificadas (`X-Forwarded-Host`, `Host` de otra empresa) no cambian la empresa servida.
- Skibox, `app.bigelephant.es`, CRM y web corporativa siguen respondiendo igual.
- Opcional: «Usar como dominio principal» y comprobar que los enlaces y el mapa del sitio usan el subdominio; después, volver a
  dejar como principal la dirección de la plataforma.

## 4. Limpieza y marcha atrás

1. Panel → **Desconectar** el subdominio: queda deshabilitado y el plano de control lo retira de Railway
   (`customDomainDelete`). Si era el principal, la dirección de la plataforma vuelve a serlo antes.
2. Claude: `dominios-estado` → el subdominio ya no figura en `core-gateway`.
3. Jorge: borrar el TXT y el CNAME del proveedor.
4. Si algo falla a mitad: desconectar desde el panel deja de servirlo en el acto; los demás dominios no se tocan.

## 5. Qué no hacer

- No usar dominios comerciales existentes (`bigelephant.es`, dominios de clientes) ni conectar dominios de clientes
  sin su autorización.
- No crear registros DNS distintos de los que devuelve el panel.
- No dar por buena la prueba sin el paso 7 (activo solo con la comprobación HTTPS superada).
