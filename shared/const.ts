export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
// El cliente compara UNAUTHED_ERR_MSG literalmente (client/src/main.tsx) para llevar al inicio de sesión:
// ambos lados usan esta constante y el código entre paréntesis se conserva como contrato.
export const UNAUTHED_ERR_MSG = 'Inicia sesión para continuar (10001)';
export const NOT_ADMIN_ERR_MSG = 'No tienes permiso para realizar esta acción (10002)';
