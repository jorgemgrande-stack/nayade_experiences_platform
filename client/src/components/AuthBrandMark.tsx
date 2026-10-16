/**
 * Marca de las páginas de acceso: la de la empresa que sirve el dominio (en single, la de siempre).
 * Ver `shared/authBrand.ts`.
 */
import { trpc } from "@/lib/trpc";
import { authBrand, type AuthBrand } from "@shared/authBrand";

export function useAuthBrand(): AuthBrand {
  const { data } = trpc.public.getTheme.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  return authBrand(data);
}

/** Distintivo + nombre para el panel oscuro de login y recuperación de contraseña. */
export function AuthBrandMark({ brand, className = "" }: { brand: AuthBrand; className?: string }) {
  if (!brand.name && !brand.logoUrl) return null;
  const legacyBadge = brand.tagline !== "";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {brand.logoUrl && !legacyBadge ? (
        <img src={brand.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover bg-white" />
      ) : (
        <div className="w-10 h-10 rounded-xl bg-[#f5a623] flex items-center justify-center font-bold text-[#0d1b2a] text-lg" aria-hidden="true">
          {brand.initial}
        </div>
      )}
      <div>
        <div className="text-white font-bold text-lg leading-tight">{brand.name}</div>
        {brand.tagline && <div className="text-[#f5a623] text-xs tracking-widest uppercase">{brand.tagline}</div>}
      </div>
    </div>
  );
}
