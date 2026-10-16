# Rendimiento de Essential: medidas reproducibles

Medidas tomadas **en una sola máquina de desarrollo**, con MySQL en Docker. No indican la capacidad máxima de producción ni deben leerse así. Sirven para detectar regresiones, bloqueos, fugas y errores con concurrencia moderada.

- Prueba: `server/rendimiento.perf.mysql.test.ts`. Es opcional: solo se ejecuta con `PERF=1` y `REGISTRY_TEST_DATABASE_URL`, y el CI no la lanza. Usa la misma pila que la E2E (`server/elephantStack.testkit.ts`): el plano de control y la aplicación multiempresa reales, con aprovisionamiento real.
- Máquina: Intel i7-12700H (14 núcleos), 32 GB de RAM, Windows 11, Node 22.23, Docker 29.8 y `mysql:8.4` con la configuración por defecto. Todo corre en un único proceso Node y la red es local.
- Tamaños (configurables): `PERF_TENANTS=10`, `PERF_LOGINS=50`, `PERF_CLIENTS=1000`, `PERF_DOCS=100`.

```bash
PERF=1 NODE_ENV=test LOCAL_AUTH=true REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3418/registry_test \
  pnpm vitest run server/rendimiento.perf.mysql.test.ts
```

## Resultados (2026-10-16, después de los arreglos)

Tiempos en ms por petición HTTP completa, medidos desde el cliente de la prueba.

| Medida | N | Concurrencia | p50 | p95 | máx. | Total | Errores |
|---|---:|---:|---:|---:|---:|---:|---:|
| Registro público (`POST /public/trial`) | 10 | 10 | 103 | 107 | 107 | 111 | 0 |
| Verificación + aprovisionamiento real de la BD | 10 | 10 | 7.130 | 7.169 | 7.169 | 7.170 | 0 |
| Login (`/api/auth/login`, bcrypt con coste 12) | 50 | 50 | 12.266 | 12.267 | 12.268 | 12.269 | 0 |
| Alta de cliente (`crm.clients.create`) | 1.000 | 10 | 32 | 44 | 59 | 3.338 | 0 |
| Listado de clientes (50 por página, en serie, 1.000 clientes) | 40 | 1 | 9 | 10 | 14 | 356 | 0 |
| Listado de clientes (20 a la vez) | 100 | 20 | 93 | 98 | 117 | 464 | 0 |
| Búsqueda de clientes (`LIKE %texto%`) | 40 | 10 | 46 | 55 | 56 | 188 | 0 |
| Presupuesto (`crm.quotes.createDirect`) | 100 | 10 | 62 | 83 | 104 | 654 | 0 |
| Venta con factura (`crm.reservations.createManual`) | 100 | 10 | 100 | 123 | 135 | 1.053 | 0 |
| Contratación completa (pedido → firma → pago de prueba → licencias) | 10 | 10 | 602 | 613 | 613 | 614 | 0 |
| Renovación (`/orders/:id/renew` + pago firmado) | 10 | 10 | 121 | 126 | 126 | 126 | 0 |

### Comprobaciones (todas en verde)

- **Duplicados:** se comprueba que cada empresa tiene una sola BD, una sola empresa en el CRM y una sola suscripción. Las 1.000 altas de clientes dan 1.000 correos distintos. Los 100 presupuestos tienen 100 números distintos. Las 100 facturas tienen números **correlativos sin huecos** (0001–0100). No hay pagos de prueba duplicados por pedido.
- **Cruces entre empresas:** cada empresa ve solo lo suyo. La 0 ve 1.000 clientes; la 1 ve 200, porque sus presupuestos y ventas dan de alta a sus clientes; las demás no ven ninguno. Las 100 facturas aparecen solo en la empresa 1, y la sesión de una empresa recibe 401 en otra.
- **Errores no controlados:** ninguna respuesta 5xx ni ninguna promesa rechazada sin controlar.
- **Bloqueos:** hubo 154 esperas de bloqueo de fila en InnoDB y la más larga duró 14 ms. Ninguna consulta pasó de 200 ms (registro de consultas lentas), salvo el borrado final de las BD de prueba.
- **Fugas de conexiones:** se partía de 2 conexiones y el máximo observado fue 129. Al cerrar la pila se vuelve a 2.
- **N+1:** consultas SQL por petición, incluidas la sesión y los ajustes: `crm.clients.list` (50 filas) hace 5, `setupWizard.status` 7 y `subscription.overview` 3. No hay N+1.
- **Licencias:** las 10 empresas quedan con todas sus licencias activas y sin caducidad. Las 10 suscripciones renuevan y avanzan de periodo, y la revisión `/orders/review` tarda 23 ms con 10 pedidos.

## Problemas encontrados y corregidos

1. **Bloqueo indefinido del registro público con concurrencia** (grave). `MysqlTrialStore.insert` retenía su conexión de la transacción y, después del `COMMIT`, pedía **otra** al pool para releer la fila. Con tantas altas simultáneas como conexiones tenga el pool (10 por defecto), cada alta se queda esperando una conexión que no suelta nadie. En la primera medida, los 10 registros se colgaron más de 20 minutos. Ahora la relectura usa la misma conexión. Hay una prueba de regresión en `server/trials.mysql.test.ts` (6 altas con un pool de 2), y el sabotaje lo confirma: sin el arreglo falla por bloqueo. En la búsqueda del mismo patrón en los almacenes salió un caso parecido en el camino de error de `MysqlWebStore` (`server/web/store.ts`), también corregido.
2. **Aprovisionamientos serializados en todo el servidor.** El esquema de cada empresa se aplicaba bajo `GET_LOCK('es_provision_schema')`, y ese nombre es global al servidor MySQL: las empresas se aprovisionaban de una en una. Con 10 a la vez, el p95 era de 22,3 s, y a partir de unas 13 simultáneas se habría superado la espera de 30 s del bloqueo, haciendo fallar el aprovisionamiento. Ahora el bloqueo es por BD (`MD5('es_provision_schema:' + DATABASE())`, el mismo patrón que `documentNumbers`). Dos ejecuciones sobre la misma BD siguen excluyéndose y las empresas distintas van en paralelo. Resultado: p95 de **7,2 s** (antes, 22,3 s).

No hacía falta ningún índice nuevo: no apareció ninguna consulta lenta y no se ha preparado ninguna migración.

## Riesgos detectados (sin corregir aquí)

- **El login está limitado por la CPU.** `bcryptjs` (JavaScript puro, coste 12) tarda unos 250 ms por verificación y comparte el hilo del proceso, así que 50 logins simultáneos tardan unos 12 s todos (p50 ≈ p95). Da unos 4 logins por segundo y por proceso, y además retrasa el resto de peticiones mientras dura. Hay dos opciones: el módulo nativo `bcrypt` o un pool de *workers* para el hash. Las dos cambian dependencias o el arranque, así que necesitan autorización y un commit aislado.
- **Conexiones por empresa.** Cada empresa activa abre un pool de hasta 10 conexiones (`dbRegistry`, hasta 50 pools). Con 10 empresas activas se llegó a 129 conexiones. Por defecto MySQL admite 151 (`max_connections`), de modo que con unas 15 empresas activas a la vez podría rechazar conexiones. Antes de abrir el registro hay que dimensionar `max_connections` o reducir el pool por empresa.
- **Límite del registro público:** `/public/trial` admite 20 peticiones por hora e IP, contando registro y verificación. Esta medida usa exactamente 20 desde una sola IP.
- **Aprovisionamiento:** son unos 2,2 s por empresa en esta máquina (BD, baseline y migraciones), y en paralelo están limitados por `concurrentProvisioning`.
