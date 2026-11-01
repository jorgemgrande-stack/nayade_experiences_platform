/**
 * Importe escrito a mano en la caja (efectivo contado al cerrar): en España se escribe con coma decimal.
 * Admite «125,50», «125.50», «1.234,50», «1 234,50» y el símbolo «€». Devuelve null si no es un importe válido
 * (vacío, letras, negativo o más de dos decimales).
 */
export function parseCashInput(raw: string | null | undefined): number | null {
  let v = (raw ?? "").replace(/[\s €]/g, "");
  if (!v) return null;
  if (!/^[\d.,]+$/.test(v)) return null;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal; el otro, el de millares
    const dec = lastComma > lastDot ? "," : ".";
    const thousands = dec === "," ? "." : ",";
    v = v.split(thousands).join("");
    if (v.split(dec).length > 2) return null;
    v = v.replace(dec, ".");
  } else if (lastComma >= 0) {
    if (v.split(",").length > 2) return null;
    v = v.replace(",", ".");
  } else if (lastDot >= 0 && v.split(".").length > 2) {
    // «1.234.567»: solo millares
    if (!/^\d{1,3}(\.\d{3})+$/.test(v)) return null;
    v = v.split(".").join("");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(v) && !/^\d+\.$/.test(v) && !/^\.\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
