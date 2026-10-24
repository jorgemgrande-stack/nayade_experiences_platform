# Cuarto overnight — Big Elephant Admin (fase 4)

**Inicio:** 24/10/2026, 23:20 (hora de Madrid), al terminar el encargo de Postmark y los accesos de Skibox.
**Encargo:** resolver el máximo del 22 % pendiente tras la fase 3 ([INFORME_RESULTADOS_OVERNIGHT_FASE_3.md](INFORME_RESULTADOS_OVERNIGHT_FASE_3.md)) y preparar las pruebas humanas.
**Informe final:** [INFORME_RESULTADOS_OVERNIGHT_FASE_4.md](INFORME_RESULTADOS_OVERNIGHT_FASE_4.md).
**Guía de pruebas humanas:** [GUIA_PRUEBAS_HUMANAS.md](GUIA_PRUEBAS_HUMANAS.md).

**Reglas de la fase:**
- bloques pequeños: CI → live → production;
- aislamiento y pruebas negativas;
- no se toca Stripe ni los cobros, ni el correo comercial, ni Náyade;
- no se cambia `MAIL_MODE` ni el ámbito del correo sin autorización;
- no se crean bloqueos automáticos;
- solo se piden aprobaciones para lo protegido.

## Punto de partida

| Elemento | Estado |
|---|---|
| Production | Core, plano de control y pasarela en `55451c2d`. Medición `es_erm` activa con datos de 7 empresas |
| Integraciones | Configuración sin secretos. Conexión siempre «no comprobada»: no se registraba ninguna comprobación |
| Módulos | Licencias completas; sin estado técnico (versión, migraciones, errores de carga) |
| Resource Manager | Métricas, cuotas, tendencia y coste estimado. Tarifas solo por variable de entorno. Sin anomalías, recolectores ni exportación |
| Correo de acceso de Skibox | Token de Postmark de production creado por el propietario. Activación limitada pendiente de aprobación |

## Registro

| Hora | Área | Cambio | PR | Estado |
|---|---|---|---|---|
| 23:20 | Correo de acceso | Activación solo para `t5-skibox`, solo invitación y recuperación | — | Pendiente de aprobación protegida |
| 23:40 | Integraciones | Comprobación real de solo lectura. Estado registrado en la base de cada empresa (0015). Incidencias, capacidades y «Comprobar ahora» desde la ficha. Lectura de buzones registrada como sincronización | #350, CRM #63 | En CI |
| 00:10 | Estabilidad | La prueba de informes calculaba «hoy» en UTC (fallaba entre las 00:00 y las 02:00 de Madrid) | #351 | En CI |
| 00:30 | Módulos | Estado técnico real por empresa y cuatro capas: instalado, habilitado, contratado y comercializable | #352 | En CI |
| 01:00 | Resource Manager | Tarifas editables y auditadas (registro 0014), anomalías, recolectores, exportación CSV y política de exceso. Almacenamiento y correo calculados por empresa | #353 | En CI |
| 01:20 | Ciclo de vida | Prueba real en live (empresa de prueba): prueba → gracia → activa → suspendida → activa → archivada → activa y una transición prohibida (409). **Fallo encontrado:** con la empresa suspendida, el panel no cargaba porque sus ficheros y las pantallas de acceso respondían 503. Corregido; además, suspender, archivar o borrar exige motivo | #354 | Fusionado |
| 01:35 | Ficha 360° | Esquema: al día o cuántas migraciones faltan. Pantallas del estado técnico de módulos y de la gestión del Resource Manager | CRM #64 | Fusionado |
| 01:45 | Comercial | Circuito completo en live con datos de prueba (lead → empresa → contacto → oportunidad → tarea → contrato en borrador → informe): 19/20 pasos correctos. **Fallo encontrado:** los informes calculaban la medianoche de Madrid con el desfase del mediodía; el día del cambio de hora perdían lo creado entre las 00:00 y las 01:00 | #355 | En CI |
| 01:55 | Web y autoservicio | 58 productos publicados: 0 «disponible», 29 «parcial» y 29 «previsto», marcados «Próximamente» en la web. Los planes se ofrecen como «Solicitar activación», sin cobro. La prueba pública está desactivada en live, como corresponde | — | Verificado en live |
| 02:00 | Integraciones | Los webhooks válidos de GHL y VAPI cuentan como última sincronización | #356 | En CI |
| 02:05 | Huérfanos | Live: ninguna empresa sin base ni usuarios sueltos. Quedan bases de pruebas de restauración (18–21/10), que no son datos de clientes | — | Verificado en live |
| 02:10 | Guía | [GUIA_PRUEBAS_HUMANAS.md](GUIA_PRUEBAS_HUMANAS.md): recorrido completo con empresa de prueba, consulta segura de Skibox, comprobaciones por pantalla y registro de incidencias | — | Redactada |

**Bloqueo operativo (01:30):** la activación del correo de Skibox espera la aprobación del propietario y retiene la cola de production. Mientras tanto no se publica nada en live: cada fusión dispara una CI que termina con la publicación ordinaria en production y queda en espera detrás de esa aprobación.
