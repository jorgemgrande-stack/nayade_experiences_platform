# Contratación B2B y B2C con Stripe: perfil fiscal del comprador (19/10/2026)

**Para:** el equipo técnico (Ventanas 1, 2 y 3) y el propietario.

Elephant Source puede contratarlo una **empresa o profesional** (B2B) o un **particular** (B2C).

Este documento describe:
- cómo se identifica a cada comprador;
- cómo se decide si se le puede cobrar;
- qué se registra del consentimiento;
- el contrato técnico que deben usar el CRM y la web.

**No contiene ninguna regla fiscal ni texto legal.** El impuesto lo calcula Stripe Tax con los registros que tenga la cuenta, y cada escenario lo aprueba el propietario con su asesor.

Código:
- `server/stripe/buyerProfile.ts`
- `server/stripe/checkout.ts`
- `server/stripe/selfService.ts`
- `server/stripe/api.ts`
- Migración: `db/crm/migrations/0014_stripe_buyer_profiles.sql`

## 1. Cuatro conceptos separados

| Concepto | Valores | De dónde sale |
|---|---|---|
| **Tipo de cliente** | `business` (empresa o profesional) / `consumer` (particular) | Lo declara el comprador o el operador |
| **Territorio** | `es_mainland` (península y Baleares), `es_canarias`, `es_ceuta`, `es_melilla`, `eu`, `eu_special` (territorios de Estados miembros excluidos del IVA comunitario, p. ej. DOM franceses, Büsingen, Livigno, Monte Athos, Åland), `non_eu` | País y código postal. Sin código postal válido, no se deduce |
| **Escenario fiscal** | Tipo × grupo de territorio: 10 escenarios (`business:es_mainland` … `consumer:non_eu`) | Calculado |
| **Consentimiento** | Versiones de condiciones, privacidad e información precontractual, más el reconocimiento sobre el desistimiento, con fecha y huella | Lo acepta el comprador (web) o lo registra el operador (venta asistida) |

**El identificador fiscal nunca se da por válido por su formato.** Se guarda como `unverified`. La validez (por ejemplo VIES, para la inversión del sujeto pasivo) es un proceso fiscal aparte.

## 2. Qué exige cada tipo

| | Empresa o profesional | Particular |
|---|---|---|
| Nombre | Razón social o nombre profesional (`legalName`) | Nombre y apellidos |
| Identificador fiscal | **Obligatorio** (NIF, CIF o VAT ID). También en la página de pago de Stripe: `tax_id_collection.required = if_supported` | Opcional (nunca se pide CIF ni razón social) |
| País y código postal | Obligatorios (código postal obligatorio en España y en la UE) | Obligatorios |
| Correo de facturación | Opcional (si no, el del contacto principal) | El del contacto |
| Condiciones de contratación | Versión vigente (`CP_TERMS_VERSION`) | Versión vigente |
| Privacidad | Versión vigente si existe `CP_PRIVACY_VERSION` | Versión vigente si existe `CP_PRIVACY_VERSION` |
| Información precontractual | — | **Obligatoria** (`CP_PRECONTRACT_VERSION`) |
| Desistimiento | — | **Bloqueado** mientras `CP_CONSUMER_WITHDRAWAL=pending`. Con `immediate_execution_ack`, casilla **propia**, distinta de la de condiciones |

Una versión aceptada distinta de la vigente se rechaza: el comprador debe ver y aceptar la vigente.

## 3. Cuándo se puede cobrar (solo en `live`)

Checkout se abre únicamente si se cumple todo esto:

1. Política fiscal decidida (`CP_STRIPE_TAX_POLICY`). Hoy no lo está: `tax_policy_pending`.
2. El pedido tiene un **perfil fiscal** guardado.
3. El escenario de ese perfil está **aprobado** en `CP_STRIPE_FISCAL_SCENARIOS`, una lista separada por comas. Sin la variable, ningún escenario lo está. Un valor desconocido impide arrancar.

En pruebas (sandbox) no se exigen los puntos 2 y 3, para no romper la integración.

**Después del primer cobro**, el procesador compara la factura de Stripe con el perfil declarado y **avisa** en dos casos:
- la dirección de la factura no corresponde al territorio declarado: `stripe.buyer_territory_mismatch`;
- es una empresa y la factura no lleva identificador fiscal: `stripe.buyer_tax_id_missing`.

El pago ya está cobrado, así que no se deshace nada: qué hacer es una decisión del equipo.

## 4. Contrato técnico para las otras ventanas

### Ventana 1 (CRM): venta asistida

- `GET /cp/v1/stripe/orders/:id/buyer` (`orders:read`): devuelve `{ buyer, approved }`, o 404 si no hay perfil.
- `PUT /cp/v1/stripe/orders/:id/buyer` (`orders:write`): cuerpo `{ buyer, consent }`.
  - `buyer` para una empresa: `{ type: "business", legalName, taxId, country, postalCode?, billingEmail?, contactName? }`.
  - `buyer` para un particular: `{ type: "consumer", firstName, lastName, country, postalCode?, taxId? }`.
  - `consent`: `{ terms: true, termsVersion, privacy?, privacyVersion?, precontractVersion?, immediateExecution? }`.
- Solo antes de confirmar el pago (pedido `requested`, `quoted` o `contracted`, sin confirmación y que no sea un cambio). Cada corrección crea una versión nueva con su instantánea en el historial.
- Errores:
  - 409 `consumer_pending`: particulares bloqueados por decisión legal;
  - 422 `territory_unknown`: falta el código postal;
  - 422 `consent_missing`: versión no vigente o casilla que falta;
  - 409 `invalid_state`.
- `GET /cp/v1/stripe/status` incluye `fiscal: { approved, pending, consumerWithdrawal }` para mostrar qué está aprobado.

**Pantalla necesaria en el CRM** (Contrataciones → pedido):
- formulario de perfil fiscal con selector empresa/particular;
- casillas de consentimiento con las versiones vigentes;
- el escenario resultante y si está aprobado.

### Web comercial: contratación en línea

`POST /cp/v1/public/checkout/start` admite `buyer` (el mismo esquema) y `consents` ampliados (`privacyVersion`, `precontractVersion`, `immediateExecution`).
- Con `buyer`, la ficha del CRM sale del perfil: un particular no da razón social.
- En `live`, `buyer` es obligatorio. Sin él responde 400 `buyer_required`.
- Particular sin decisión legal: 503 `consumer_unavailable`.
- Textos no vigentes o casilla que falta: 409 `consent_outdated`.
- Sin código postal válido: 400 `territory_unknown`.

Todo se valida **antes** de crear nada.

**Formulario necesario en la web:**
- selector empresa/particular;
- país y código postal;
- campos propios de cada tipo;
- enlaces a las versiones vigentes;
- para particulares, la casilla propia del desistimiento cuando exista la decisión legal.

## 5. Configuración (nada activado hoy)

| Variable | Hoy | Para activar |
|---|---|---|
| `CP_STRIPE_FISCAL_SCENARIOS` | ausente: ningún escenario aprobado | Lista aprobada por el propietario y el asesor (p. ej. `business:es_mainland`) |
| `CP_CONSUMER_WITHDRAWAL` | ausente (`pending`): particulares bloqueados | `immediate_execution_ack`, tras la decisión legal |
| `CP_PRECONTRACT_VERSION` | ausente | Versión publicada de la información precontractual |
| `CP_PRIVACY_VERSION` | ausente | Versión publicada de la política de privacidad |
| `CP_TERMS_VERSION` | ausente | Versión publicada de las condiciones |

**Despliegue en `live`:**
1. Aplicar la migración `0014` (copia previa, simulación y ejecución).
2. Desplegar el código. Es una operación que requiere aprobación.
3. Mientras falten las variables, el comportamiento es el de hoy: no se cobra.
