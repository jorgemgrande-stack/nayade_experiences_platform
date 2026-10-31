/**
 * Validación por campo de los formularios de alta del CRM (oportunidad, pedido, presupuesto y cliente).
 * Mensajes en español y sin tecnicismos; el servidor vuelve a validar.
 */
import { validateEmail, validatePhone } from "./formValidation";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface ContactFields {
  name: string;
  email: string;
  phone?: string;
}

/** Nombre obligatorio, correo obligatorio o no según el formulario, teléfono opcional pero válido. */
export function validateContact(f: ContactFields, opts: { emailRequired?: boolean } = {}): FieldErrors<"name" | "email" | "phone"> {
  const errors: FieldErrors<"name" | "email" | "phone"> = {};
  if (!f.name.trim()) errors.name = "Indica el nombre.";
  const email = validateEmail(f.email, opts.emailRequired ?? true);
  if (email) errors.email = email;
  const phone = f.phone ? validatePhone(f.phone) : null;
  if (phone) errors.phone = phone;
  return errors;
}

export interface OrderFields extends ContactFields {
  productId: number | null;
  bookingDate: string;
  amount: number;
}

/** Alta manual de pedido o reserva. `labels.date` viene del vocabulario del modo. */
export function validateOrder(
  f: OrderFields,
  labels: { date: string },
): FieldErrors<"name" | "email" | "phone" | "product" | "date" | "amount"> {
  const errors: FieldErrors<"name" | "email" | "phone" | "product" | "date" | "amount"> = validateContact(f, { emailRequired: true });
  if (!f.productId) errors.product = "Selecciona un elemento del catálogo.";
  if (!f.bookingDate) errors.date = `Indica la ${labels.date.toLowerCase()}.`;
  if (!Number.isFinite(f.amount) || f.amount < 0) errors.amount = "Indica un importe válido (0 o más).";
  return errors;
}

export interface QuoteFields extends ContactFields {
  hasLines: boolean;
}

export function validateQuote(f: QuoteFields): FieldErrors<"name" | "email" | "phone" | "lines"> {
  const errors: FieldErrors<"name" | "email" | "phone" | "lines"> = validateContact(f, { emailRequired: true });
  if (!f.hasLines) errors.lines = "Añade al menos una línea con concepto e importe.";
  return errors;
}

export function hasErrors(e: Record<string, string | undefined>): boolean {
  return Object.values(e).some(Boolean);
}
