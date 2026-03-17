# Configuración de Producción — Redsys Náyade Experiences

## Variables de Entorno Requeridas

Todas las variables están gestionadas desde el panel de Manus (Settings > Secrets).
**Nunca** añadir estas variables directamente en el código o en archivos `.env`.

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `REDSYS_MERCHANT_CODE` | Código de comercio Redsys (9 dígitos) | `123456789` |
| `REDSYS_MERCHANT_KEY` | Clave secreta SHA-256 (Base64, 32 bytes) | `Mk9m98IfEblmPfrpsawt7BmxObt98Jev` |
| `REDSYS_MERCHANT_TERMINAL` | Terminal de pago | `001` |
| `REDSYS_ENVIRONMENT` | Entorno (`test` o `production`) | `production` |

## URLs de Retorno (se construyen automáticamente)

Las URLs de retorno se generan dinámicamente desde el dominio del frontend.
**No hay URLs hardcodeadas** — el cambio de dominio es automático.

| URL | Ruta |
|-----|------|
| Notificación IPN (backend) | `https://[dominio]/api/redsys/notification` |
| Retorno OK (frontend) | `https://[dominio]/reserva/ok?order=[merchantOrder]` |
| Retorno KO (frontend) | `https://[dominio]/reserva/error?order=[merchantOrder]` |

## Configuración en el Panel de Comercio Redsys

1. **URL de Notificación Online** (IPN): `https://[dominio]/api/redsys/notification`
   - Método: POST
   - Formato: `application/x-www-form-urlencoded`
   - Esta URL recibe la confirmación real del pago — es la única fuente de verdad

2. **URL OK**: `https://[dominio]/reserva/ok`
   - Solo para mostrar la página de confirmación al usuario
   - **NO se marca el pago como confirmado por esta URL**

3. **URL KO**: `https://[dominio]/reserva/error`
   - Para mostrar la página de error al usuario

## Cambio de Dominio

Cuando el dominio definitivo esté configurado (ej: `nayadeexperiences.es`):

1. En el panel de Manus, ir a Settings > Domains y añadir el dominio personalizado
2. Actualizar la URL de Notificación Online en el panel de comercio Redsys
3. Las URLs OK/KO se actualizan automáticamente

**No hay ningún cambio de código necesario** — todo usa `window.location.origin` del frontend.

## Estados de Reserva

| Estado | Descripción |
|--------|-------------|
| `draft` | Reserva iniciada pero no confirmada |
| `pending_payment` | Pre-reserva creada, esperando pago |
| `paid` | Pago confirmado por IPN Redsys con firma válida |
| `failed` | Pago rechazado o firma inválida |
| `cancelled` | Reserva cancelada manualmente |

## Seguridad

- El importe se calcula **siempre en backend** desde el precio del producto en BD
- La firma se valida con `crypto.timingSafeEqual` para evitar timing attacks
- El `merchantOrder` es único (formato `NY[timestamp36][random]`, 12 chars)
- Una reserva solo pasa a `paid` tras validar la firma del IPN — nunca por la URL OK
- Los datos completos de la respuesta Redsys se guardan en `redsys_response` (JSON)

## Notificaciones Automáticas

Al confirmar un pago (IPN válido):
- **Notificación interna**: enviada al equipo Náyade vía Manus Notification Service
- **Email al cliente**: pendiente de configurar (ver `server/reservationEmails.ts`)
- **WhatsApp**: estructura preparada para integración futura

Para activar email al cliente, configurar en Settings > Secrets:
- `BREVO_API_KEY` (recomendado) o `SMTP_HOST` + `SMTP_PORT` + `SMTP_USER` + `SMTP_PASS`

## Panel de Administración

Acceso: Admin > Operaciones > Reservas Redsys

Funcionalidades:
- Listado paginado con filtros por estado, fecha y producto
- Vista de detalle con datos completos de la reserva
- Exportación CSV de reservas filtradas
- Columnas: fecha, producto, cliente, email, teléfono, personas, total, estado, merchantOrder
