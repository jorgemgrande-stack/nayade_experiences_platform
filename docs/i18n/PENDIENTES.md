# i18n del panel: cobertura y pendientes (21/11/2026)

> Cobertura **parcial**: está traducido lo que usa Quantum Soulrise. Este documento no debe leerse como «panel completo en alemán».

## Cubierto (es / de)

Menú (227 etiquetas), cabecera, notificaciones, ayuda contextual, roles; Inicio, Mi cuenta, Suscripción y Ayuda; CRM: Clientes, Tareas, Etiquetas, Embudo, Propuestas, Seguimiento comercial, Oportunidades, Presupuestos, Reservas/Pedidos, Facturas, Anulaciones, Cobros pendientes; Catálogo: Productos y servicios, Convocatorias, Variantes y precios, Reglas de precios, Inventario, Categorías, Lugares, Descuentos; Pedidos de la tienda; Agenda y reservas; Formación (administración), Elephant Studio, CMS; Ajustes, Usuarios y permisos, Connect, Contratos, Plantillas de email/PDF, Reseñas; componentes comunes (estados, errores, diálogos) y 202 mensajes de servidor frecuentes.

## Sin traducir (fase posterior)

### Módulos que Quantum no usa
Hotel, Spa, Restaurantes, Ski Net, TPV y caja, contabilidad general, bancos y TPV, RR. HH. (Personal), fiscal/gestoría, marketing avanzado (campañas, Brevo, GEO, SEO, Ads), multicanal, proveedores y liquidaciones, REAV, Care/Life/Social Token Net, fidelización.

### Pestañas con texto español dentro de pantallas alemanas
`CommunicationsMap`, `TemplateRulesTab`, `PendingJobsTab`, `LegacyAutomationsTab`, `EmailAuditTab`, `EmailInbox`, `WhatsAppCloud`, `WhatsAppGHLInbox`, `ReceptionAi`, `VapiAgente`, `VoiceSetup`; `TimeSlotsPanel`, `SupplierSelect`, `marketing/CuponesManager`, `components/connect/*` (ProductCard, RequestDialog, marketplace).

### Textos que genera el servidor o `shared/` y se muestran en español
- Validaciones de `shared/`: `clientProfile` (`validateClientForm`, `duplicateMessage`), `validateTaskForm`, `validateTagForm`, `validateStageForm`, `clientImportTexts`, `creditNoteForm`, `pricingRules`, `enrollmentCommerce`, `formValidation`, `translationEditor`, `setupWizard`, `sites`, `imageUpload`, `learningMaterials`, `learningRules`, `pageBlocks.pageSlugProblem`.
- Presentación de planes y suscripción: `subscriptionHeader`, `subscriptionRecovery`, `planPresentation`, `subscriptionPlans`, `subscriptionCheckout`, `connectMarketplace`, `connectShowcase`, `connectCard`, `netOffer`, `contractsEsign`, `integrationsPanel` (la mayor parte del texto de Integraciones).
- Historial de la ficha de cliente (`buildClientActivity`), etiquetas de estado de factura (`inv.status`), `h.actor` del historial de pedidos, historial de inventario (`sourceLabel`).
- `e.message` de los avisos de error de los routers; los mensajes con `${…}` y los de `server/*Db.ts` y zod no están en el mapa de 202.
- Los avisos de la campana llegan del servidor: solo se traducen los encabezados de sección.

### Vocabulario por tipo de negocio (`voc.*`)
Frases con concordancia de género o plural («marcado/a», «este/esta {voc.order}») siguen en español; unos 25 avisos de `CRMDashboard.tsx` y fragmentos de `revisionDeFacturacionHay`, `mostrandoDe`, `paginaDe`, `estaAccionEsIrreversible`. Requiere diseño propio (formas por género).

### Otros
- Calendario de `ui/calendar.tsx` (meses con `toLocaleString("default")`); `formatDayEs` (2 usos) con dd/mm/aaaa fijo.
- Etiquetas con el estado en bruto del servidor (filtros de estado de facturas).
- Claves dinámicas `t(\`x.${v}\`)` solo las valida la paridad es↔de, no la prueba de claves literales.
- Studio/CMS usan el texto español como clave (`tx("…")`, `shared/i18n/studioLabels/`): si se cambia ese texto, la traducción deja de aplicarse.
- Traducciones indexadas por texto español en cliente (`STEP_LABELS`, `BUSINESS_ACTIVITIES`, `paymentLabel`, `scheduleErrors`): si se cambia el texto en `shared/`, cae al español sin avisar.
- Posibles desbordes de botones y cabeceras en alemán (no se añadió `truncate`/`flex-wrap` salvo donde era evidente): revisar en pantalla Inspector de Studio, editor de curso, cabeceras de propuestas y seguimiento, `VariantsManager`, `Inventory`, `DailyActivities`, pestañas de Plan y uso.

## Revisión lingüística nativa (posterior)
Términos dudosos señalados por los agentes: «Anfrage» (oportunidad/lead), «Leistung» (servicio), «Freigeben» (validar/aprobar), «Einheit»/«Termin»/«Durchführung» (sesión/convocatoria/edición), «Kopf-/Fußbereich», «Geschäftsdaten» frente a «Unternehmensdaten», abreviaturas de columnas («Unterl. ausst.», «Bearb.-Status», «Erinn.»), textos con valor jurídico (desistimiento, condiciones del checkout, exportación de datos), «Mitarbeiter(*in)» frente a «Vertrieb».

## Lo que NO se ha hecho
Comprobación visual en navegador (responsive, textos largos) y prueba de dos usuarios reales: ver el informe final para el estado de la publicación a production.
