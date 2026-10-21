/**
 * Validación de los formularios de acceso (lógica pura, mensajes en español). La comprobación real de las
 * credenciales sigue en el servidor: esto solo evita envíos vacíos o mal escritos y explica qué falta.
 */
export interface LoginErrors {
  email?: string;
  password?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  const e = email.trim();
  if (!e) return "Escribe tu correo electrónico.";
  if (!EMAIL.test(e) || e.length > 254) return "Revisa el correo: debe tener el formato nombre@dominio.es.";
  return undefined;
}

export function validateLogin(email: string, password: string): LoginErrors {
  const out: LoginErrors = {};
  const e = validateEmail(email);
  if (e) out.email = e;
  if (!password) out.password = "Escribe tu contraseña.";
  return out;
}

/** Mensaje de error del servidor al iniciar sesión, en lenguaje llano y sin detalles internos. */
export function loginErrorMessage(status: number, serverMessage: unknown): string {
  if (status === 429) return "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  if (status >= 500) return "No hemos podido iniciar sesión por un problema del servicio. Inténtalo de nuevo en unos minutos.";
  if (typeof serverMessage === "string" && serverMessage.trim() && serverMessage.length <= 200) return serverMessage;
  return "El correo o la contraseña no son correctos.";
}
