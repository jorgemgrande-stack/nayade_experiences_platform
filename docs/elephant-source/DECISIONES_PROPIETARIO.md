# Decisiones pendientes del propietario (hoja breve)

Ninguna se da por aprobada por silencio. Hasta que se decida, el sistema **bloquea** lo afectado.

| # | Decisión | Opciones / propuesta | Quién | Bloquea |
|---|---|---|---|---|
| 1 | **Territorios y tipos de cliente que se abren** | Propuesta inicial: empresas de España (todos sus territorios), de la UE (con VIES) y de una lista de países fuera de la UE; particulares de la Península y Baleares y de la UE cuando se resuelvan el 3 y el 9. Matriz: `MATRIZ_FISCAL_INTERNACIONAL.md` | Asesor fiscal y propietario | Cobro de cada escenario |
| 2 | **IVA español en Stripe Tax** | Registrar España (régimen general) | Propietario, en Stripe, tras el visto bueno del asesor | Todo cobro con IVA |
| 3 | **Particulares de la UE** | IVA español hasta 10.000 €/año, o OSS desde el inicio (registro OSS y tipo de cada país) | Asesor fiscal | `consumer:eu` |
| 4 | **Canarias, Ceuta y Melilla** | Empresas: no sujeto a IVA (con mención). Particulares: bloqueados hasta analizar IGIC e IPSI | Asesor fiscal | `*:es_special` |
| 5 | **Reino Unido y terceros países** | Empresas: no sujeto, por lista de países. Particulares del Reino Unido: alta en HMRC; resto, caso a caso | Asesor fiscal | `*:non_eu` |
| 6 | **Factura legal** (DF-2) | Stripe Invoicing (si encaja con el reglamento de facturación y VERI\*FACTU) o un programa certificado | Asesor fiscal | Validez legal de las facturas; rectificativas |
| 7 | **Series y rectificativas** (DF-4) | Una serie por régimen y otra de rectificativas; notas de crédito de Stripe al reembolsar | Asesor fiscal | Rectificativas |
| 8 | **VERI\*FACTU** | Fecha de obligación y software | Asesor fiscal | — |
| 9 | **Condiciones B2C y desistimiento** | Borradores en el PR #186: precontractual, ejecución inmediata, botón de desistimiento ya implementado, reembolso proporcional | Jurídico | Particulares |
| 10 | **Política de reembolso del desistimiento** | Plazo (14 días), medio (el mismo), cálculo por días y momento de la baja. Hoy, a mano | Jurídico | Ejecución de desistimientos |
| 11 | **Privacidad y encargo del tratamiento** | Borradores en el PR #186; subencargados y región de Railway y de las copias | Jurídico | Publicación de textos |
| 12 | **Datos mercantiles** | Registro Mercantil (tomo, folio, hoja) para el aviso legal | Propietario | Aviso legal |
| 13 | **Web a publicar** | `42741e2` (actual) o `5ea5be6` (diseño comercial con las páginas legales, cuando se aprueben) | Propietario | Web pública |
| 14 | **Proveedor de correo** | Postmark (recomendado; `CORREO_PROVEEDOR.md`) o Brevo con IP dedicada | Propietario | Envíos reales |
