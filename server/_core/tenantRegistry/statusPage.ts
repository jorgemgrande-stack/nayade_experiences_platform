/**
 * Página HTML de estado (empresa suspendida, archivada, dirección desconocida o servicio no disponible) con la
 * identidad de Big Elephant, para quien llega con un navegador. Sin ningún dato de la empresa: la misma página para
 * todas, así no revela qué empresas existen. Las peticiones de API siguen recibiendo el texto plano de siempre.
 */
import { BIG_ELEPHANT } from "../../../shared/loginBrand";

const TEXT: Record<number, { title: string; body: string }> = {
  404: { title: "Dirección no encontrada", body: "Esta dirección no corresponde a ninguna página disponible. Comprueba el enlace." },
  410: { title: "Este sitio ya no está disponible", body: "La empresa ha cerrado este servicio. Si eres su administrador, contacta con soporte." },
  403: { title: "Operación no permitida", body: "Esta operación no está disponible ahora mismo para esta empresa." },
  503: { title: "Servicio no disponible temporalmente", body: "Esta página no está disponible en este momento. Si eres su administrador, puedes entrar en tu panel." },
};

export function wantsHtml(accept: string | undefined): boolean {
  return /text\/html/i.test(accept ?? "");
}

export function statusPageHtml(status: number, o: { adminLink?: boolean } = {}): string {
  const t = TEXT[status] ?? TEXT[503];
  const link = o.adminLink ? `<p><a class="btn" href="/login">Entrar en el panel</a></p>` : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t.title}</title>
<style>
  :root { --red: ${BIG_ELEPHANT.red}; --red-ink: ${BIG_ELEPHANT.redInk}; --ink: ${BIG_ELEPHANT.ink}; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #f7f5f1; color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 440px; width: 100%; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(23,29,40,.08); text-align: center; }
  img { height: 40px; width: auto; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #4b5668; line-height: 1.5; margin: 0 0 20px; }
  .btn { display: inline-block; background: var(--red-ink); color: #fff; text-decoration: none; font-weight: 600; padding: 12px 24px; border-radius: 10px; }
  .btn:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
  @media (prefers-color-scheme: dark) { body { background: var(--ink); } main { background: #222a38; color: #fff; } p { color: #c9ced8; } }
</style>
</head>
<body>
<main>
  <img src="${BIG_ELEPHANT.logoUrl}" alt="Big Elephant">
  <h1>${t.title}</h1>
  <p>${t.body}</p>
  ${link}
</main>
</body>
</html>`;
}
