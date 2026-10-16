# Prueba autónoma de 15 días (Essential)

**Estado:** conectada de punta a punta en la rama `feat/elephant-licensing`, **apagada por defecto**:
- `server/trials/onboarding.ts` orquesta el flujo;
- `server/trials/api.ts` expone las rutas;
- la prueba completa por HTTP está en `server/controlPlane.trials.test.ts`.

**Qué hace:**
1. **Registro** público con antiabuso y respuesta genérica.
2. **Verificación** del correo.
3. **Aprovisionamiento** de la plataforma, con su usuario administrador.
4. **Empresa** en el CRM.
5. **Suscripción Essential en prueba** (sin tarjeta ni cobro: modo sombra).
6. **Licencias Essential** con caducidad al final de la prueba.
7. **Avisos** (3, 1 y 0 días antes): se calculan, y su envío es una acción explícita.
8. **Vencimiento:** solo lectura, los datos se conservan.
9. **Conversión:** termina la prueba, cambia de plan si se pide y aplica las licencias sin caducidad.

**Interruptores (todos apagados por defecto):**

| Variable | Efecto |
|---|---|
| `CP_PUBLIC_TRIAL_ENABLED=1` | Crea las rutas públicas `/cp/v1/public/trial` y `/verify` |
| `CP_TRIAL_AUTO_PROVISION=1` | La verificación activa la prueba en el acto. Si no, la activa un operador con `POST /cp/v1/trials/:id/activate` |

**Comunicaciones:** por defecto **no se envía nada**. El aviso solo deja constancia en el registro de arranque, sin correo ni token. Conectar un proveedor de correo requiere autorización.

**Lo que sigue sin ser automático:** suspender, vencer o eliminar. Lo decide una persona (`/cp/v1/trials/review`).

**Configuración guiada** (paso 8 del encargo): el alta deja la plataforma con su administrador invitado y la marca básica. El asistente de configuración dentro de la app **no existe todavía**: está pendiente.

---

*Diseño original (modelo de estados, datos y seguridad):*

## 1. Flujo previsto

```
Visitante (web) ──registro──▶ pending_verification ──verificación de correo──▶ verified
     ──solicitud de tenant──▶ provisioning ──aprovisionamiento correcto──▶ active (15 días)
                                   └─ fallo ─▶ verified (reintento; sin tenant a medias)
active ──(vence; una persona lo marca)──▶ expired
active | expired ──ampliación aprobada──▶ active      active | expired ──suspensión──▶ suspended ──reactivación──▶ active
active | expired | suspended ──contratación──▶ converted (suscripción v1)
pending_verification | verified ──rechazo──▶ rejected        no terminal ──cancelación──▶ cancelled
```

- **Estados terminales:** `converted`, `rejected` y `cancelled`.
- **Transiciones:** se declaran en `server/trials/machine.ts`. Cualquier otra se rechaza.

## 2. Datos (migración CRM 0007, aditiva)

**`trial_requests`** guarda:
- el correo normalizado y su dominio;
- la empresa y la configuración elegida (plan y complementos del catálogo publicado);
- el estado;
- **solo el hash** del token de verificación y su caducidad;
- el tenant;
- el inicio y el fin de la prueba;
- las ampliaciones (usadas y solicitada, con motivo);
- el motivo de la suspensión;
- la suscripción de conversión (FK);
- la clave de idempotencia;
- el hash de la IP;
- la versión.

**`trial_events`** guarda el historial de cada transición: acción, estado de origen y de destino, versión, actor y detalle.

**Restricciones en la propia BD:**
- **una prueba abierta por correo** (columna generada con `UNIQUE`);
- clave de idempotencia única;
- **un tenant, una prueba**.

## 3. Seguridad

| Riesgo | Medida | Prueba |
|---|---|---|
| Correo falso | Token aleatorio de 256 bits enviado por correo. Se guarda solo su SHA-256, se compara en tiempo constante, caduca a las 24 h y se borra al verificar | token incorrecto o caducado |
| Cuentas duplicadas | Una prueba abierta por correo, impuesta también por la BD. Sin revelar el estado de la existente | altas simultáneas con el mismo correo → 1 (MySQL) |
| Reenvíos y dobles clics | Alta idempotente por clave | misma clave a la vez → 1 alta (MySQL) |
| Abuso | Límites por dominio (3 en 30 días, salvo correos personales), por IP (5 en 24 h, guardada como hash) y de aprovisionamientos simultáneos (3) | límites |
| Aprovisionamiento repetido o a medias | Solicitud idempotente. Un fallo vuelve a `verified` sin tenant. Un tenant no puede pertenecer a dos pruebas | aprovisionamiento |
| Aislamiento de tenants | El aprovisionamiento usa el servicio existente (BD y usuario propios por tenant). La prueba solo guarda el identificador del tenant | — |
| Decisiones automáticas indebidas | **Ninguna transición es automática.** `dueForReview()` **solo informa** de las vencidas y de las ampliaciones pendientes | «nada vence solo» |
| Pisar el trabajo de otra persona | Versión optimista en cada transición y evento en la misma transacción | conflicto de versión (memoria y MySQL) |
| Fugas de datos | La vista pública (`TrialService.view`) no expone hash de token, IP ni clave | vista |
| Contratación incorrecta | La conversión exige una suscripción existente, no cancelada y del mismo tenant | conversión |

## 4. Dependencias para activarlo

**Requiere autorización:**

1. **API pública de registro** en la captación existente (`/cp/v1/public/*`), con su origen, ticket HMAC, *honeypot* y límites. Solo devolvería «revisa tu correo».
2. **Envío del correo de verificación** con el remitente configurado. Hoy el token se devuelve al llamador y no se envía.
3. **Aprovisionamiento:** conectar `requestProvisioning` con `ProvisioningService.run` (tenant en `trial`), con su límite de concurrencia.
4. **Pantalla en el CRM:** una cola de pruebas para revisar las vencidas, aprobar ampliaciones, suspender y convertir.
5. **Decisión de negocio:**
   - qué ocurre al vencer (solo aviso, suspensión manual…);
   - política de ampliaciones;
   - qué datos se conservan al cancelar.
6. **Multiempresa activa:** la prueba crea un tenant real. **No se activa sin autorización.**

## 5. Qué NO hace

- No suspende ni elimina tenants: no hay temporizadores ni tareas programadas.
- No envía correos ni WhatsApp.
- No cobra: la conversión enlaza con una suscripción v1 en modo sombra.
- No se conecta a Railway.

## 6. Pruebas

- **Unitarias:** 12 (`server/trials.test.ts`), que cubren la máquina de estados, el flujo completo con auditoría, la verificación, la idempotencia, los límites, el aprovisionamiento, el vencimiento solo informativo, las ampliaciones, la suspensión y reactivación, la conversión, la versión y la vista segura.
- **MySQL real:** 4 (`server/trials.mysql.test.ts`), que cubren altas simultáneas, la misma clave a la vez, la versión y los eventos en la misma transacción, un tenant por prueba y la migración de subida, bajada y nueva subida.
