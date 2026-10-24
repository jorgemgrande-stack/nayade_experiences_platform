/**
 * SetPassword.tsx — /establecer-contrasena?token=xxx (invitación de un usuario).
 *
 * Mismo armazón que el inicio de sesión y la recuperación (AuthShell): identidad de la empresa, o la de Big Elephant
 * mientras no configure la suya. Al establecer la contraseña se inicia sesión por el inicio de sesión normal y se entra
 * directamente en el panel (sin pasar por «Acceso restringido»).
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthAlert, AuthLoading, AuthShell, AuthSubmit, authInputClass, authLinkClass, useLoginLook } from "@/components/auth/AuthShell";
import { homeForRole } from "./Login";

function PasswordInput({ id, label, value, onChange, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-slate-800 text-sm font-medium">
        {label}
      </Label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          className={`pl-10 pr-12 ${authInputClass}`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={show}
          aria-controls={id}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--auth-link)]"
        >
          {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** Misma escala que la recuperación de contraseña (colores funcionales: rojo, ámbar, verde). */
export function passwordStrength(password: string): { level: "weak" | "medium" | "strong"; label: string; color: string } | null {
  if (password.length === 0) return null;
  if (password.length < 8) return { level: "weak", label: "Muy corta (mínimo 8 caracteres)", color: "bg-red-600" };
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return { level: "medium", label: "Aceptable", color: "bg-amber-500" };
  return { level: "strong", label: "Segura", color: "bg-emerald-600" };
}

export default function SetPassword() {
  const { look } = useLoginLook();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string | null; signedIn: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);
  useEffect(() => {
    if (look?.brand.fullName) document.title = `Establecer contraseña · ${look.brand.fullName}`;
  }, [look?.brand.fullName]);

  const setPasswordMutation = trpc.public.setPassword.useMutation();
  const strength = passwordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) return setError("El enlace no es válido. Usa el enlace del correo de invitación.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    try {
      const r = await setPasswordMutation.mutateAsync({ token, password });
      // Inicio de sesión normal con la contraseña recién elegida: así se entra directamente en el panel
      let signedIn = false;
      if (r.email) {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: r.email.trim().toLowerCase(), password }),
        }).catch(() => null);
        signedIn = !!res?.ok;
      }
      setDone({ name: r.name ?? null, signedIn });
      if (signedIn) {
        await utils.auth.me.invalidate();
        const me = await utils.auth.me.fetch().catch(() => null);
        setTimeout(() => navigate(homeForRole((me as { role?: string } | null)?.role)), 1500);
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "No se ha podido establecer la contraseña. El enlace puede haber caducado.");
    } finally {
      setLoading(false);
    }
  }

  if (!look || token === undefined) return <AuthLoading />;

  return (
    <AuthShell look={look} title="Establece tu contraseña" titleHighlight="contraseña" message={`Crea una contraseña segura para acceder al panel de ${look.brand.fullName || "tu empresa"}.`}>
      {!token && (
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-red-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Enlace no válido</h2>
          <p className="text-slate-600 leading-relaxed mb-8">Este enlace de invitación no es válido. Pide al administrador de tu empresa que te reenvíe la invitación.</p>
          <Link href="/login" className={authLinkClass}>
            Ir al inicio de sesión
          </Link>
        </div>
      )}

      {token && done && (
        <div className="text-center" role="status">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Contraseña establecida</h2>
          <p className="text-slate-600 leading-relaxed mb-2">{done.name ? `Te damos la bienvenida, ${done.name}. ` : ""}Tu cuenta está lista.</p>
          {done.signedIn ? (
            <p className="text-slate-500 text-sm">Entrando en tu panel…</p>
          ) : (
            <>
              <p className="text-slate-500 text-sm mb-8">Inicia sesión con tu correo y la contraseña que acabas de elegir.</p>
              <Link href="/login" className={authLinkClass}>
                Ir al inicio de sesión
              </Link>
            </>
          )}
        </div>
      )}

      {token && !done && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Crea tu contraseña</h2>
            <p className="text-slate-600">Elige una contraseña segura de al menos 8 caracteres.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <PasswordInput id="password" label="Nueva contraseña" value={password} onChange={setPassword} describedBy={strength ? "strength" : undefined} />
              {strength && (
                <div className="space-y-1 mt-2" id="strength">
                  <div className="h-1 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full transition-all ${strength.color}`} style={{ width: strength.level === "weak" ? "33%" : strength.level === "medium" ? "66%" : "100%" }} />
                  </div>
                  <p className="text-xs text-slate-600">Seguridad: {strength.label}</p>
                </div>
              )}
            </div>
            <div>
              <PasswordInput id="confirm" label="Repite la contraseña" value={confirm} onChange={setConfirm} describedBy={confirm ? "match" : undefined} />
              {confirm && (
                <p id="match" className={`mt-2 text-xs flex items-center gap-1 ${password === confirm ? "text-emerald-700" : "text-red-700"}`}>
                  {password === confirm ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> : <AlertCircle className="w-3 h-3" aria-hidden="true" />}
                  {password === confirm ? "Las contraseñas coinciden" : "Las contraseñas no coinciden"}
                </p>
              )}
            </div>
            <div aria-live="assertive">{error && <AuthAlert>{error}</AuthAlert>}</div>
            <AuthSubmit loading={loading} loadingLabel="Guardando contraseña…" disabled={!password || !confirm}>
              Establecer contraseña
            </AuthSubmit>
          </form>
        </>
      )}
    </AuthShell>
  );
}
