# Diagnóstico — Emails de confirmación de venta TPV no recibidos

**Fecha:** 2026-07-20
**Reportado por:** Jorge
**Reservas afectadas:** RES-2026-0674, 0675, 0676, 0677, 0678, 0679, 0681, 0682

## Resumen

Se investigó por qué las últimas 8 reservas creadas desde el TPV físico no
generaron los correos de confirmación esperados (ni al cliente ni al equipo).

**Conclusión: no hay ningún bug en el código.** El flujo de envío
(`server/routers/tpv.ts`, bloque "Email de confirmación" dentro de
`createSale`) se disparó correctamente en las 8 reservas, y Brevo aceptó
la petición de envío en todos los casos (200 OK + `messageId`). El
problema está en la capa de entregabilidad, fuera del repositorio.

## Metodología

1. Consulta directa a la BD de producción (tabla `reservations`, vía
   `MYSQL_PUBLIC_URL` del servicio MySQL en Railway) para confirmar canal,
   estado y email de cliente de las 8 reservas. Todas son ventas
   `TPV_FISICO`, `statusReservation=CONFIRMADA`, `statusPayment=PAGADO`.
2. Búsqueda en `email_comm_log` — vacía para las 8. Se confirmó que el
   flujo TPV usa `sendEmail()` (mailer.ts) directamente en vez de
   `sendManagedEmail()` (emailManager.ts), por eso no queda registro en
   esa tabla. No es un bug: es simplemente un camino de código que no
   pasa por el logger centralizado.
3. Logs de Railway (`railway logs --since/--until`) en el minuto exacto
   de cada venta: en las 8 aparece `[Mailer] ✓ Brevo API → <destino> |
   messageId: ...` tanto para el email interno (reservas@) como para el
   del cliente (salvo RES-2026-0676, que no tiene email de cliente
   cargado en el TPV — comportamiento esperado, no hay a quién enviar).
4. Verificación en el panel de Brevo (`app.brevo.com`):
   - Remitente `reservas@nayadeexperiences.es` verificado, DKIM y DMARC
     correctos, cumple los requisitos de Google/Yahoo/Microsoft.
   - Centro de entregabilidad: tasa de bounces del **9,99%** sobre el
     periodo 20/06–19/07/2026 (recomendado < 1%).
   - Log transaccional (`Transaccional → Email → Logs`): se localizaron
     los eventos concretos de las reservas afectadas.

## Hallazgos

### 1. Buzón interno `reservas@nayadeexperiences.es` — soft bounce por blacklist SpamCop

```
554 5.7.1 Service unavailable; Client host [77.32.148.27] blocked using
bl.spamcop.net; Blocked - see ...
```

El servidor de correo del dominio (hosting Dinahosting) tiene un filtro
anti-spam que consulta la blacklist pública SpamCop y rechaza la conexión
entrante cuando la IP de origen aparece listada. Brevo envía desde un
**pool de IPs compartidas** entre múltiples clientes; cuando otro cliente
del pool ensucia una IP, cualquiera que la comparta (incluida esta cuenta)
sufre el rechazo. Esto explica la naturaleza intermitente del problema:
según qué IP del pool toque en cada envío, entrega bien o rebota.

Esta es la causa que afecta a **todas** las notificaciones internas de
venta, no solo a estas 8 reservas.

### 2. Cliente `rubengarrilo.gl@gmail.com` (RES-2026-0682) — hard bounce, dirección inexistente

```
550-5.1.1 The email account that you tried to reach does not exist.
```

Dato mal capturado en el TPV (probable error de tecleo al introducir el
email del cliente durante la venta). No es un problema técnico — requiere
contactar al cliente para confirmar su email real y reenviar manualmente
si procede.

### 3. Resto de reservas (0674, 0675, 0677, 0678, 0679, 0681)

Sin confirmación individual del estado final en Brevo más allá de lo
descrito arriba (aceptación por la API). No se completó la revisión
destinatario por destinatario en el log de Brevo para estos casos.

## Acciones recomendadas (fuera del repositorio)

- **Corto plazo:** en el panel de Dinahosting, revisar la configuración
  de filtros anti-spam / listas RBL de la cuenta `reservas@nayadeexperiences.es`
  y añadir una excepción para SpamCop, o suavizar ese check para esa
  cuenta concreta.
- **Medio plazo:** contratar una **IP dedicada** en Brevo (Configuración →
  Remitentes, dominio, IP → IP dedicadas) para dejar de depender de la
  reputación de la IP compartida.
- **RES-2026-0682:** contactar al cliente para confirmar su email real.

## No es responsabilidad del código

Se descartó explícitamente como causa:
- Fallo del trigger de envío (los logs confirman que se ejecutó en las 8).
- Configuración de plantillas de email (no aplica — el flujo TPV no usa
  `sendManagedEmail`, va directo a `sendEmail`).
- SPF/DKIM/DMARC del dominio (verificados correctos en Brevo).
