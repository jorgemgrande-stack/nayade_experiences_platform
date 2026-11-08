/**
 * Contratos y firma electrónica · firma a distancia (`/contrato/<token>`, capacidad `contracts-esign` activa en la
 * empresa del dominio). Mismo patrón que la firma remota de Ski Net (./skiSign.ts): el enlace es de UN SOLO USO y caduca;
 * la página muestra el texto exacto que se firma con su huella SHA-256 y registra la firma (o el rechazo) con IP y
 * navegador. Los enlaces viven en su propia tabla (`esign_links`, server/contractsEsignDb.ts): `net_public_links` solo
 * admite sus tipos.
 */
import { getCapabilityAccess } from "../_core/capabilities/access";
import { ESIGN_CAPABILITY } from "../../shared/contractsEsign";

/** ¿Se puede firmar a distancia en esta empresa? Licencia activa (no solo lectura). Si no se sabe, no. */
export async function contractSigningAvailable(): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(ESIGN_CAPABILITY, { write: true })).allowed;
  } catch {
    return false;
  }
}

export { contractOfLink, rejectWithLink, resolveEsignLink, signWithLink, type PublicContract } from "../contractsEsignDb";
