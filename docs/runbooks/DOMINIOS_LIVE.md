# Dominios definitivos del entorno `live` y cambios de DNS

**Estado (19/10/2026):** preparado. **No se ha aplicado nada:** ningún cambio de DNS, de dominios de Railway ni de variables.

- DNS de `bigelephant.es`: servidores `ns*.gestiondecuenta.com`.
- Lecturas hechas en el servidor autoritativo y en 1.1.1.1.

## 1. Situación actual

Todos los dominios definitivos están enganchados a servicios del entorno **`production`**, que hoy es la integración con el sandbox de Stripe:

| Dominio | Servicio (entorno) | Registro DNS actual | TTL | Responde |
|---|---|---|---|---|
| `bigelephant.es` | `web` (production) | A `69.46.46.118` (borde de Railway; Railway pide CNAME → `eaaoezsy.up.railway.app`) | 60 | 308 → `www` |
| `www.bigelephant.es` | `web` (production) | CNAME `kzwsznyi.up.railway.app` | 300 | 200, web comercial |
| `admin.bigelephant.es` | `crm` (production) | CNAME `4osc2ar7.up.railway.app` | 300 | 401, pasarela del CRM |
| `app.bigelephant.es` | `core-gateway` (production) | CNAME `g6qh4huy.up.railway.app` | 300 | 401, entrada de empresas |
| `*.app.bigelephant.es` | `core-gateway` (production) | CNAME `ybr4jh9i.up.railway.app` | 300 | Plataformas de empresa |
| `_acme-challenge.app.bigelephant.es` | certificado comodín | CNAME `ybr4jh9i.authorize.railwaydns.net` | 300 | — |

En `live`, los servicios solo tienen sus dominios de Railway:
- `elephant-source-web-live.up.railway.app`;
- `elephant-source-crm-live.up.railway.app`;
- `elephant-source-core-live.up.railway.app`.

**Condición de Railway:** un dominio propio solo puede estar en un servicio a la vez, y al añadirlo Railway genera un destino CNAME nuevo (`<código>.up.railway.app`).

Por tanto, no se puede preparar en `live` antes de quitarlo de `production`. El valor exacto del CNAME nuevo **solo se conoce en el momento de añadirlo**: es el único dato de este plan que no se puede fijar hoy. El resto de cada cambio sí está fijado:
- el nombre del registro;
- el tipo de registro;
- el valor que se sustituye;
- el procedimiento.

**Corte por dominio:** unos 5 minutos (TTL 300) más la emisión del certificado (de 1 a 5 minutos). Hacerlo en horario sin uso.

## 2. Fase A: web comercial y CRM a `live` (no depende del MFA)

**Requisitos:**
- Aprobación del propietario, con fecha y hora.
- Coordinación con la ventana de acceso y MFA: estos dominios los enganchó ella en `production`.

**Orden:** `admin` primero (afecta solo a operadores) y después `www` y el apex.

### A.1 `admin.bigelephant.es` → `crm` de `live`

1. Railway → `production` → `crm` → Settings → Domains → quitar `admin.bigelephant.es`.
2. Railway → `live` → `crm` → Settings → Domains → **Custom domain** → `admin.bigelephant.es`, puerto **8080**. Anotar el destino que muestra (`<nuevo>.up.railway.app`).
3. **DNS:**

   | Nombre | Tipo | Valor actual | Valor nuevo | TTL |
   |---|---|---|---|---|
   | `admin` | CNAME | `4osc2ar7.up.railway.app` | `<nuevo>.up.railway.app` del paso 2 | 300 |

4. Esperar a que Railway muestre el certificado válido.

### A.2 `www.bigelephant.es` y `bigelephant.es` → `web` de `live`

1. Railway → `production` → `web` → quitar `www.bigelephant.es` y `bigelephant.es`.
2. Railway → `live` → `web` → añadir `www.bigelephant.es` y `bigelephant.es`, puerto **8080**. Anotar los dos destinos.
3. **DNS:**

   | Nombre | Tipo | Valor actual | Valor nuevo | TTL |
   |---|---|---|---|---|
   | `www` | CNAME | `kzwsznyi.up.railway.app` | `<nuevo-www>.up.railway.app` | 300 |
   | `@` (apex) | CNAME, ALIAS o «CNAME flattening» si el proveedor lo admite | A `69.46.46.118` | `<nuevo-apex>.up.railway.app` | 60 |

   Si el proveedor solo admite un registro A en el apex:
   - mantener `69.46.46.118`, que es el borde de Railway y enruta por el nombre del host;
   - comprobar que Railway marca el dominio como verificado.

   Si no lo verifica, alternativa: redirigir el apex a `www` desde el panel del proveedor.

### A.3 Variables de `live` tras la fase A

Todas con `--skip-deploys`, y después `railway up` de los exports verificados. `crm` y `web` tienen valores que se fijan al compilar.

| Servicio | Variable | Valor nuevo |
|---|---|---|
| `controlplane` | `CP_ALLOWED_ORIGINS` | `https://elephant-source-crm-live.up.railway.app,https://admin.bigelephant.es` |
| `controlplane` | `CP_PUBLIC_ORIGINS` | `https://elephant-source-web-live.up.railway.app,https://www.bigelephant.es` |
| `controlplane` | `CP_RESET_URL` | `https://admin.bigelephant.es/#/restablecer` (hoy no existe en `live`) |
| `controlplane` | `CP_STRIPE_SUCCESS_URL` | `https://www.bigelephant.es/contratacion/estado` |
| `controlplane` | `CP_STRIPE_CANCEL_URL` | `https://www.bigelephant.es/contratacion/cancelada` |
| `controlplane` | `CP_STRIPE_PORTAL_RETURN_URL` | `https://www.bigelephant.es/` |
| `web` | `PUBLIC_ORIGIN` | `https://www.bigelephant.es` |
| `web` | `PUBLIC_INTAKE_URL` | `https://www.bigelephant.es/cp/v1/public` |
| `crm` | `VITE_CP_URL` | `https://admin.bigelephant.es` |
| `crm` | `VITE_WEB_URL` | `https://www.bigelephant.es` |

Las URL antiguas de Railway se mantienen en las listas de orígenes durante la transición.

**Stripe live:**
- Destino del webhook → URL `https://admin.bigelephant.es/cp/v1/stripe/webhook`. Se edita el destino existente: el secreto no cambia.
- Portal → `business_profile` con las URL de condiciones y privacidad de `www`, cuando estén publicadas.

**`production`** (lo ajusta la ventana de acceso y MFA): quitar `admin`/`www` de sus `CP_ALLOWED_ORIGINS`, `CP_PUBLIC_ORIGINS` y `CP_RESET_URL`, y volver a sus dominios de Railway.

### A.4 Aceptación

- `https://www.bigelephant.es/` responde 200.
- `https://bigelephant.es/` redirige a `www`.
- `/contratacion/estado` responde 200 sin autenticación.
- `https://admin.bigelephant.es/` responde 401 (pasarela) y, tras ella, el login del CRM de `live`.
- `POST /cp/v1/stripe/webhook` con firma falsa responde 400 cuando Stripe ya esté activado (`stripe-live.ts verificar`, ajustando su `CRM_ORIGIN`).
- Los dominios de Railway de `production` siguen funcionando para la integración.

**Marcha atrás:** quitar el dominio de `live`, volver a añadirlo en `production` y restaurar el CNAME anterior. Es posible que Railway asigne otro código: se usa el que muestre.

## 3. Fase B: `app` y `*.app` a `live` (depende del MFA y de #139)

**Requisitos:**
- La PR de arreglos del MFA revisada.
- El código de #139 (`APP_ENTRY_HOST`, entrada «Accede a tu empresa») desplegado en `live`.
- La 0012 del registro aplicada en `live`.

El código de `live` de hoy (`07670ba` + #143) **no** tiene `APP_ENTRY_HOST`.

1. Quitar `app.bigelephant.es` y `*.app.bigelephant.es` de `core-gateway` en `production`.
2. Añadirlos a `core-gateway` en `live`, puerto 8080. Anotar los destinos de los dos dominios y del reto ACME.
3. **DNS:**

   | Nombre | Tipo | Valor actual | Valor nuevo | TTL |
   |---|---|---|---|---|
   | `app` | CNAME | `g6qh4huy.up.railway.app` | `<nuevo-app>.up.railway.app` | 300 |
   | `*.app` | CNAME | `ybr4jh9i.up.railway.app` | `<nuevo-comodín>.up.railway.app` | 300 |
   | `_acme-challenge.app` | CNAME | `ybr4jh9i.authorize.railwaydns.net` | `<nuevo-comodín>.authorize.railwaydns.net` | 300 |

4. **Variables:**
   - `core-gateway`: `APP_ENTRY_HOST=app.bigelephant.es`.
   - `controlplane`: `CP_PLATFORM_DOMAIN=app.bigelephant.es` (hoy `up.railway.app`) y `CP_PLATFORM_TARGET=<nuevo-comodín>.up.railway.app`.
   - `core`: `APP_URL` según el diseño de #139.
5. **Antes de dar de alta empresas reales**, aplicar la cookie del Core con prefijo `__Host-` (MEDIO-8): `app.bigelephant.es` no está en la Public Suffix List.

## 4. Correo (independiente de las fases A y B)

El DKIM de Brevo (`brevo1`, `brevo2`) y el código de verificación ya están publicados.

| Nombre | Tipo | Valor actual | Valor nuevo | Cuándo |
|---|---|---|---|---|
| `@` | TXT (SPF) | `v=spf1 a mx ~all` | `v=spf1 a mx include:spf.brevo.com ~all` | Antes de `MAIL_MODE` distinto de `off` en `live` |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | Sin cambios ahora. Endurecer según `CORREO_BREVO.md` tras 2–4 semanas de informes | Más adelante |

**Reglas:**
- Un único registro `v=spf1`: se **sustituye**, no se añade otro.
- No tocar `MX`, `default._domainkey`, `brevo-code`, `brevo1` ni `brevo2`.

## 5. Comprobación de solo lectura (antes y después)

```powershell
foreach ($n in "bigelephant.es","www.bigelephant.es","admin.bigelephant.es","app.bigelephant.es") {
  Resolve-DnsName $n -Server ns.gestiondecuenta.com -DnsOnly | Where-Object Section -eq Answer
}
Resolve-DnsName bigelephant.es -Type TXT -Server 1.1.1.1 -DnsOnly
```

En Railway, la consulta de solo lectura `project → services → serviceInstances → domains.customDomains` muestra el dominio, el certificado y el estado DNS de cada entorno.
