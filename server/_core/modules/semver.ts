/** Versiones semánticas mínimas (major.minor.patch) y rangos `^`, `~`, `>=`, `*`, exacto. */
export type Version = [number, number, number];

const V_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string): Version | null {
  const m = V_RE.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** ¿Cumple `version` el rango? Un rango no válido nunca se cumple. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "*" || r === "") return true;
  if (r.startsWith(">=")) {
    const min = parseVersion(r.slice(2));
    return !!min && compareVersions(v, min) >= 0;
  }
  if (r.startsWith("^")) {
    const min = parseVersion(r.slice(1));
    if (!min) return false;
    const upper: Version = min[0] > 0 ? [min[0] + 1, 0, 0] : min[1] > 0 ? [0, min[1] + 1, 0] : [0, 0, min[2] + 1];
    return compareVersions(v, min) >= 0 && compareVersions(v, upper) < 0;
  }
  if (r.startsWith("~")) {
    const min = parseVersion(r.slice(1));
    if (!min) return false;
    return compareVersions(v, min) >= 0 && compareVersions(v, [min[0], min[1] + 1, 0]) < 0;
  }
  const exact = parseVersion(r);
  return !!exact && compareVersions(v, exact) === 0;
}
