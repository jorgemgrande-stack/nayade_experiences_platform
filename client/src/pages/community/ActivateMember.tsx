/**
 * /comunidad/activar?token=…&c=<comunidad> — la persona invitada crea la contraseña de su cuenta (la invitación de un
 * solo uso de las cuentas del Core, `public.setPassword`), entra con el inicio de sesión normal y llega a la comunidad.
 * No es un segundo sistema de autenticación: la cuenta es la del Core (rol de cliente).
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalLook } from "../employee/usePortalLook";

export default function ActivateMember() {
  const look = usePortalLook();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [params, setParams] = useState<{ token: string | null; slug: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setPasswordMutation = trpc.public.setPassword.useMutation();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const slug = sp.get("c");
    setParams({ token: sp.get("token"), slug: slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null });
  }, []);

  const target = params?.slug ? `/comunidad/${params.slug}` : "/comunidad";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!params?.token) return setError("El enlace no es válido. Usa el enlace del correo de invitación.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    try {
      const r = await setPasswordMutation.mutateAsync({ token: params.token, password });
      let signedIn = false;
      if (r.email) {
        // Inicio de sesión normal del Core (REST de autenticación)
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: r.email.trim().toLowerCase(), password }) }).catch(() => null);
        signedIn = !!res?.ok;
      }
      await utils.auth.me.invalidate();
      navigate(signedIn ? target : `/login?returnTo=${encodeURIComponent(target)}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "No se ha podido crear la contraseña. El enlace puede haber caducado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" style={look.style}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          {look.logoUrl ? <img src={look.logoUrl} alt={look.name || ""} className="h-9 w-auto max-w-[160px] object-contain" /> : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--portal-accent)] text-[var(--portal-accent-fg)]" aria-hidden="true"><Users className="h-5 w-5" /></span>
          )}
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Únete a la comunidad</h1>
            {look.name && <p className="text-xs text-slate-500">{look.name}</p>}
          </div>
        </div>
        {!params ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" aria-label="Cargando" /> : !params.token ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Este enlace de invitación no es válido. Pide a la empresa que te reenvíe la invitación.</p>
            <Link href={`/login?returnTo=${encodeURIComponent(target)}`} className="underline">Ya tengo cuenta: iniciar sesión</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <p className="text-sm text-slate-600">Crea tu contraseña para entrar. La usarás después con tu correo en el inicio de sesión.</p>
            <label className="block text-sm font-medium text-slate-800" htmlFor="am-pass">Contraseña</label>
            <Input id="am-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            <label className="block text-sm font-medium text-slate-800" htmlFor="am-confirm">Repite la contraseña</label>
            <Input id="am-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
            <Button type="submit" className="w-full bg-[var(--portal-accent)] text-[var(--portal-accent-fg)] hover:opacity-90" disabled={loading}>
              {loading ? "Entrando…" : "Crear contraseña y entrar"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
