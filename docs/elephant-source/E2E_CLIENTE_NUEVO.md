# Prueba E2E: una empresa nueva con Essential

Prueba reproducible, de punta a punta, de una empresa **nueva** (sin datos heredados) que descubre Elephant Source, se registra, prueba Essential 15 días, opera, vence, contrata con un pago de **prueba** firmado y cancela. Una segunda empresa comprueba el aislamiento.

- Fichero: `server/clienteNuevo.e2e.mysql.test.ts` (opt-in con `REGISTRY_TEST_DATABASE_URL`).
- Montaje: `server/elephantStack.testkit.ts`. Levanta el plano de control (catálogo oficial publicado, CRM, prueba pública con aprovisionamiento **real** de la BD de cada empresa, suscripciones, licencias por capacidad, orquestador y proveedor de pagos de PRUEBAS) y la aplicación multiempresa, montada como el arranque real (`installTenantResolution` + `installTenantBinding`, `CAPABILITY_ENFORCEMENT=on`). Los correos van a buzones en memoria y la salida de red está bloqueada: no se cobra ni se envía nada real.
- No usa cuentas privilegiadas para ocultar permisos. La propietaria y la empleada son usuarias de su empresa creadas por el propio flujo. El operador solo actúa a través de la API del plano de control, con un token de prueba.
- Si una operación esencial falla, la prueba falla. Ningún error se rebaja a aviso.

```bash
docker run -d --name be_e2e -e MYSQL_ROOT_PASSWORD=ci_only -e MYSQL_DATABASE=registry_test -p 3418:3306 mysql:8.4
NODE_ENV=test LOCAL_AUTH=true REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3418/registry_test \
  pnpm vitest run server/clienteNuevo.e2e.mysql.test.ts
```

Al terminar, la prueba imprime la evidencia de cada paso (bloque «EVIDENCIA E2E»).

## Resultado (2026-10-16, Windows + MySQL 8.4 en Docker): 25/25 en verde (~30 s)

| Paso | Qué se comprueba | Resultado |
|---|---|---|
| 1–4 | Catálogo público: `GET /cp/v1/public/site` publica Essential a 29 €/mes y 279 €/año (EUR) sin datos internos; el cotizador `POST /cp/v1/public/site/quote` devuelve 2.900 y 27.900 céntimos | OK |
| 5–7 | Registro (`/public/trial`, respuesta genérica sin token), correo de verificación en el buzón en memoria, token falso → 403 y verificación correcta → plataforma `t1-empresa-demo-elephant-01` | OK |
| 8 | BD propia vacía (0 clientes, productos, presupuestos, pedidos, facturas y leads), la propietaria como única usuaria `admin` y la empresa en el CRM | OK |
| 9 | Prueba de 15 días: 29 licencias Essential activas hasta +15 días, suscripción `trialing` e invitación de bienvenida en **su** host. La propietaria define su contraseña e inicia sesión | OK |
| 10 | Asistente: empresa (se rechaza si está incompleta) y actividad. Los pasos 11–17 completan el resto: 100 % al final del paso 17 | OK |
| 11 | Cliente (`crm.clients.create`) | OK |
| 12 | Producto con categoría, ubicación, precio e IVA | OK |
| 13 | Presupuesto de 121 € sin enviar correo al cliente | OK |
| 14 | Presupuesto → pedido (`crm.quotes.convertToReservation`): reserva confirmada con el pago pendiente. Repetir la conversión **no** duplica el pedido | OK (tras arreglo 1) |
| 15 | Checkout del escaparate con la pasarela en modo pruebas (cuenta ficticia guardada como credencial de la empresa, `sis-t`). Precio calculado en el servidor. Una firma falsa se rechaza; la notificación firmada deja el pedido pagado | OK |
| 16 | Factura automática `FAC-AAAA-0001` de 50 €. La vista REST muestra el NIF de **esta** empresa sintética y ninguna marca heredada | OK (tras arreglo 2) |
| 17 | Empleada con rol `agente`: invitación por correo en su host. No puede entrar antes de activar; después define su contraseña e inicia sesión | OK |
| 18 | Permisos de la empleada: opera el CRM (consultar y crear clientes, presupuestos). Recibe 403 `FORBIDDEN` en 7 operaciones de administración (usuarios, ajustes, asistente, plazas, integraciones, catálogo) | OK |
| 19–20 | `subscription.overview`: Essential, estado `trial`, 15 días, usuarios 2/3. `setupWizard.seats` = `{used: 2, limit: 3, available: 1}` | OK (tras arreglo 3) |
| 02 | «Empresa Demo Elephant 02» registrada igual, con una plataforma distinta y vacía | OK |
| 02 | tRPC (16 consultas): listados vacíos; los ids de cliente, presupuesto, pedidos y factura de la 01 dan `NOT_FOUND`; usuarios, ajustes, asistente y licencias propios. Ninguna respuesta contiene datos de la 01 | OK |
| 02 | REST y sesiones: la vista de la factura de la 01, la cookie de la 01 (propietaria y empleada) en el host de la 02 y al revés, el login con credenciales de la 01 y la notificación de pago de la 01 en el host de la 02 se rechazan; las licencias van separadas en el registro | OK |
| 21 | Vencimiento simulado: reloj +16 días y prueba `expired` por la API del operador | OK |
| 22 | Solo lectura: 5 lecturas → 200; 5 mutaciones (propietaria y empleada) → 403 con estado `expired`; el panel muestra `trial_expired`; recuentos intactos | OK (tras arreglo 3) |
| 23 | Contratación por el orquestador (`POST /cp/v1/orders`, `trial_conversion`): cotiza con el catálogo (3.509 céntimos el primer mes, 29 € + 21 % de IVA) y se firma. La aplicación sigue en solo lectura | OK |
| 24 | Pago de prueba: firma falsa y `livemode` → 400 sin activar nada. El evento firmado válido da `applied`: pedido `active`, 29 licencias sin caducidad, prueba `converted` y suscripción `active` | OK (tras corregir el montaje) |
| 25 | Escritura recuperada para la propietaria y la empleada; el panel muestra `active` | OK |
| 26 | Se conservan todos los datos: clientes, producto, presupuesto, factura, usuarias, NIF y la misma plataforma | OK |
| 27 | Cancelación: `cancel_scheduled` hasta el fin del periodo pagado; tras el periodo, `/orders/review` la cancela | OK |
| 28 | Estado final: pedido `cancelled`, suscripción `canceled` y 29 licencias `cancelled`. Regla de acceso: se mantienen la sesión y el estado de la suscripción para poder volver a contratar, pero lo licenciado se rechaza al leer y al escribir con 403 `cancelled`. No se borra ningún dato y la 02 no se ve afectada. Ninguna salida de red real | OK |

## Fallos encontrados y corregidos (cambio mínimo en el servidor)

1. **Pedido duplicado al convertir dos veces un presupuesto** (doble clic o reintento). `crm.quotes.convertToReservation` creaba una reserva nueva cada vez. Ahora es idempotente: si el presupuesto ya tiene un pedido no cancelado, devuelve ese pedido (`server/routers/crm.ts`).
2. **Factura sin emisor (sin nombre ni NIF) en una empresa de alta autoservicio.** En multiempresa, el emisor sale de la entidad fiscal del registro, y la prueba pública no crea ninguna. Los datos fiscales que guarda el asistente («Primeros pasos», en los ajustes de la empresa) no se usaban. Ahora la factura los toma cuando falta la entidad fiscal (`server/invoiceHtml.ts`). En `single` (Náyade) no cambia nada.
3. **El panel mostraba la prueba como suscripción «activa».** La prueba pública aplica las licencias con origen `subscription:<id>` y caducidad, pero el resumen solo reconocía `trial:`. Además, `subscription.overview` usaba `Date.now()` en lugar del reloj del motor de licencias. Ahora la prueba se identifica por la caducidad y se usa el mismo reloj (`server/subscriptionOverview.ts`, `server/routers/subscriptionRouter.ts`, con una prueba unitaria en `server/panelEssential.test.ts`).

Durante el desarrollo, el paso 24 falló porque el montaje de la prueba creaba el CRM sin la activación de contratos. El arranque real (`controlPlane/main.ts`) sí la configura, así que se corrigió el montaje y no el servidor.

## Decisiones y límites

- «Pedido» es la reserva del Core: así se llama en el CRM de Essential. El checkout del paso 15 se hace desde el escaparate (`reservations.createAndPay`) con la pasarela en modo pruebas, como en `essential.commerce`. El pedido del paso 14 queda con el pago pendiente: cobrarlo con el enlace de pago del presupuesto es otro flujo, que no entra en este recorrido.
- El vencimiento lo marca el operador (`/trials/:id/expire`): por diseño, nada vence la prueba automáticamente. Las licencias, en cambio, caducan solas por fecha.
- La conversión la confirma un evento firmado del proveedor de **pruebas** (`SignedTestProvider`). Essential está como «bajo solicitud» en el catálogo, así que la firma exige un motivo de aprobación.
- Lo que sigue pendiente, sin cubrir aquí: el registro público continúa cerrado por configuración (`publicEnabled`) y no hay pasarela real.
