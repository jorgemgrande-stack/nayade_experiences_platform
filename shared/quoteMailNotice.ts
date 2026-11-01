/**
 * Aviso que ve quien envía un presupuesto, según lo que ha pasado de verdad con el correo (crm.quotes.send,
 * crm.quotes.resend y crm.quotes.createDirect con envío). Durante la prueba gratuita los correos solo llegan a los
 * buzones de la propia empresa: decir «enviado al cliente» sería falso y el cliente nunca recibiría el presupuesto.
 */
export interface QuoteMailResult {
  emailSent?: boolean;
  trialMailBlocked?: boolean;
}

export type QuoteMailNotice = { kind: "success" | "warning"; message: string };

export function quoteMailNotice(r: QuoteMailResult | null | undefined, sentMessage: string): QuoteMailNotice {
  // Respuestas sin el dato (servidor anterior): se mantiene el mensaje de siempre
  if (!r || r.emailSent === undefined || r.emailSent) return { kind: "success", message: sentMessage };
  if (r.trialMailBlocked) {
    return {
      kind: "warning",
      message: "Presupuesto listo, pero no se ha enviado: durante la prueba gratuita los correos solo llegan a los buzones de tu empresa. Copia el enlace del presupuesto y envíaselo tú al cliente.",
    };
  }
  return {
    kind: "warning",
    message: "Presupuesto listo, pero el correo no ha podido salir. Copia el enlace del presupuesto y envíaselo al cliente, o inténtalo de nuevo más tarde.",
  };
}
