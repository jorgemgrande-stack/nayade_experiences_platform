/**
 * Concepto de un cobro tal y como se muestra en Contabilidad. Los cobros con tarjeta en la web se guardaban como
 * «Pago online Redsys — …»: se muestran como «Pago con tarjeta — …», sin el nombre de la pasarela.
 */
export function transactionDescription(d: string | null | undefined): string | null {
  if (d == null) return null;
  return d.replace(/^Pago online Redsys\b/, "Pago con tarjeta");
}
