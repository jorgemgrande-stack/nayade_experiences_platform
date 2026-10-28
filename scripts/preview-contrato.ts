/**
 * Vista previa LOCAL de la presentación corporativa del contrato (página de aceptación y PDF) con datos de ejemplo.
 * No toca ninguna base de datos ni envía nada.
 *
 *   pnpm exec tsx scripts/preview-contrato.ts [puerto]   → http://localhost:<puerto>/  y  /contrato.pdf
 */
import http from "node:http";
import { renderContract, sha256 } from "../server/external/document";
import { chargeInstant } from "../server/external/schedule";
import { CONTRACT_CSS, contractBodyHtml, contractView, renderContractPdf } from "../server/external/presentation";
import { fetchBrandLogo } from "../server/documents/brandPdf";

const CONDITIONS = `Objeto. Big Elephant presta a Nextair SL el servicio tecnológico gestionado SkiNet sobre la plataforma Skicenter, cuya infraestructura es externa a Elephant Source y propiedad o responsabilidad de Nextair SL en los términos acordados.

Servicio en curso. El servicio SkiNet ya está operativo y se viene prestando a la fecha de firma. Este contrato formaliza su prestación y establece su facturación mensual a partir de la mensualidad de noviembre de 2026; no se facturan periodos anteriores.

Alcance. Mantenimiento correctivo y evolutivo, soporte técnico y operación del servicio según lo acordado entre las partes.

Duración y baja. Duración indefinida desde la firma. Cualquiera de las partes puede resolverlo con un preaviso de 30 días naturales, por escrito; la baja surte efecto al final de la mensualidad en curso, sin devolución de la mensualidad ya facturada.

Pago. Cuota mensual por anticipado el día 1 de cada mes mediante el método de pago autorizado en Stripe. El impago no detiene por sí solo la infraestructura del cliente; las partes resolverán las incidencias de cobro de buena fe.`;

const external = { serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, billingDay: 1, billingHour: 8, timezone: "Europe/Madrid", graceDays: 5, firstChargeAt: chargeInstant("2026-11-01", 8, "Europe/Madrid"), externalRef: "skicenter:nextair" };
const text = renderContract({ contract: { id: 4, reference: "CT-2026-000004", version: 1, conditions: CONDITIONS }, company: { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031" } as never, external: external as never });
const declaration = "Yo, Victor Manuel Allen Perez, declaro que tengo poder suficiente para obligar al cliente y acepto el contrato anterior (versión y huella indicadas), incluido el cobro recurrente de 1000.00 EUR más IVA cada mes.";
const view = contractView(text, { sha256: sha256(text), reference: "CT-2026-000004", version: 1, external, signer: { name: "Victor Manuel Allen Perez", role: "Representante autorizado" }, declaration });

const form = `<section class="accept" id="aceptar"><h3>Aceptación y autorización de cobros recurrentes</h3>
<p>Firmante: <strong>Victor Manuel Allen Perez</strong> · Representante autorizado, en nombre de <strong>NEXTAIR SL</strong>.</p>
<form method="post" action="" onsubmit="return false">
<label>Nombre completo<input type="text" name="name" maxlength="160"></label>
<label>NIF del firmante (opcional)<input type="text" name="taxId" maxlength="32"></label>
<label class="check"><input type="checkbox" name="accept" value="1"><span>${declaration}</span></label>
<p class="muted">Aceptar el contrato no autoriza ningún cobro: después recibirás un enlace seguro de Stripe para autorizar el método de pago, sin cargo en ese momento. Los cobros recurrentes empezarán en la fecha indicada en el contrato.</p>
<div class="actions"><button class="btn" type="submit">Aceptar el contrato</button><a class="btn ghost" href="/contrato.pdf">Descargar PDF</a></div>
</form></section>`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aceptación del contrato (vista previa)</title><style>${CONTRACT_CSS}</style></head><body>${contractBodyHtml(view, { acceptance: form, raw: text })}<footer class="site">Big Elephant · IRON ELEPHANT CONSULTING, S.L. · VISTA PREVIA LOCAL</footer></body></html>`;

const port = Number(process.argv[2] ?? 4599);
http
  .createServer(async (req, res) => {
    if (req.url?.startsWith("/contrato.pdf")) {
      const pdf = await renderContractPdf(view, { logoPng: await fetchBrandLogo(), acceptance: { title: "Aceptación electrónica pendiente", lines: [declaration, "Aceptar el contrato no autoriza ningún cobro."] } });
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="CT-2026-000004-v1.pdf"' });
      return void res.end(Buffer.from(pdf));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  })
  .listen(port, "127.0.0.1", () => console.log(`Vista previa: http://localhost:${port}/`));
