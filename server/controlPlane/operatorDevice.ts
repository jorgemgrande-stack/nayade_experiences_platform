/**
 * Dispositivo de una sesión de operador a partir de su user-agent: familia de navegador y sistema operativo.
 * No usa la IP (cambia con frecuencia) ni la versión (se actualiza sola). Si el user-agent no permite
 * identificar ambos con fiabilidad (herramientas, robots, cadenas vacías o raras), devuelve null y no se
 * compara nada: es preferible no avisar a avisar de un «dispositivo nuevo» que no lo es.
 */
export interface DeviceFamily {
  browser: string;
  os: string;
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows (NT|Phone)\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

export function deviceOf(userAgent: string | null | undefined): DeviceFamily | null {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
  if (!ua.startsWith("Mozilla/")) return null;
  if (/bot|crawler|spider|headless/i.test(ua)) return null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  return browser && os ? { browser, os } : null;
}

export const sameDevice = (a: DeviceFamily, b: DeviceFamily) => a.browser === b.browser && a.os === b.os;

export const deviceLabel = (d: DeviceFamily) => `${d.browser} en ${d.os}`;
