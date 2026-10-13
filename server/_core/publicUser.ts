/**
 * Representación de un usuario apta para enviarse al navegador.
 * Elimina el hash de contraseña y los tokens de invitación, que nunca deben salir del servidor.
 */
const SERVER_ONLY_USER_FIELDS = ["passwordHash", "inviteToken", "inviteTokenExpiry"] as const;

export type PublicUser<T> = Omit<T, (typeof SERVER_ONLY_USER_FIELDS)[number]>;

export function toPublicUser<T extends Record<string, unknown>>(user: T): PublicUser<T>;
export function toPublicUser<T extends Record<string, unknown>>(user: T | null | undefined): PublicUser<T> | null;
export function toPublicUser<T extends Record<string, unknown>>(user: T | null | undefined): PublicUser<T> | null {
  if (!user) return null;
  const copy: Record<string, unknown> = { ...user };
  for (const f of SERVER_ONLY_USER_FIELDS) delete copy[f];
  return copy as PublicUser<T>;
}
