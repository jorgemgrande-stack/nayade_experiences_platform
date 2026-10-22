/**
 * ResetPassword.tsx — Página /nueva-contrasena?token=xxx
 *
 * Valida el token al cargar, muestra el formulario de nueva contraseña
 * y llama a POST /api/auth/reset-password. Aspecto: el de la empresa (AuthShell).
 */

import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { AuthAlert, AuthLoading, AuthShell, AuthSubmit, authInputClass, authLinkClass, useLoginLook } from "@/components/auth/AuthShell";

function PasswordInput({ id, label, value, onChange, autoComplete, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-slate-800 text-sm font-medium">{label}</Label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
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

export default function ResetPassword() {
  const { look } = useLoginLook();
  const [, navigate] = useLocation();

  const [token, setToken] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null); // null = validando
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extraer token de la URL y validarlo
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setTokenValid(false);
      return;
    }
    setToken(t);

    // Validar token en el servidor
    fetch(`/api/auth/validate-reset-token?token=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((data) => setTokenValid(data.valid === true))
      .catch(() => setTokenValid(false));
  }, []);

  const passwordStrength = (() => {
    if (password.length === 0) return null;
    if (password.length < 8) return { level: "weak", label: "Muy corta (mínimo 8 caracteres)", color: "bg-red-600" };
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return { level: "medium", label: "Aceptable", color: "bg-amber-500" };
    }
    return { level: "strong", label: "Segura", color: "bg-emerald-600" };
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "No se ha podido cambiar la contraseña. El enlace puede haber caducado.");
        return;
      }

      setDone(true);
      // Redirigir al login tras 3 segundos
      setTimeout(() => navigate("/login"), 3000);
    } catch {
      setError("No hay conexión con el servidor. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (!look) return <AuthLoading />;

  return (
    <AuthShell look={look} title="Crea tu nueva contraseña" titleHighlight="nueva contraseña" message="Elige una contraseña segura para proteger tu cuenta.">
      {/* Validando token */}
      {tokenValid === null && (
        <div className="text-center py-12" role="status">
          <span className="mx-auto mb-4 block h-10 w-10 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" aria-hidden="true" />
          <p className="text-slate-600">Comprobando el enlace…</p>
        </div>
      )}

      {/* Token inválido o expirado */}
      {tokenValid === false && (
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-red-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Enlace no válido</h2>
          <p className="text-slate-600 leading-relaxed mb-8">
            Este enlace de recuperación ha caducado o ya se ha utilizado. Los enlaces son válidos durante 60 minutos.
          </p>
          <Link href="/recuperar-contrasena" className={authLinkClass}>Solicitar nuevo enlace</Link>
        </div>
      )}

      {/* Contraseña cambiada con éxito */}
      {done && (
        <div className="text-center" role="status">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-700" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Contraseña actualizada</h2>
          <p className="text-slate-600 leading-relaxed mb-2">Tu contraseña se ha cambiado correctamente.</p>
          <p className="text-slate-500 text-sm mb-8">Te llevamos al inicio de sesión en unos segundos…</p>
          <Link href="/login" className={authLinkClass}>Ir al inicio de sesión</Link>
        </div>
      )}

      {/* Formulario de nueva contraseña */}
      {tokenValid === true && !done && (
        <>
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Nueva contraseña</h2>
            <p className="text-slate-600">Elige una contraseña segura de al menos 8 caracteres.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <PasswordInput id="password" label="Nueva contraseña" value={password} onChange={setPassword} autoComplete="new-password" describedBy={passwordStrength ? "strength" : undefined} />
              {passwordStrength && (
                <div className="space-y-1 mt-2" id="strength">
                  <div className="h-1 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                    <div
                      className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                      style={{ width: passwordStrength.level === "weak" ? "33%" : passwordStrength.level === "medium" ? "66%" : "100%" }}
                    />
                  </div>
                  <p className="text-xs text-slate-600">Seguridad: {passwordStrength.label}</p>
                </div>
              )}
            </div>

            <div>
              <PasswordInput id="confirm" label="Repite la contraseña" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" describedBy={confirmPassword ? "match" : undefined} />
              {confirmPassword && (
                <p id="match" className={`mt-2 text-xs flex items-center gap-1 ${password === confirmPassword ? "text-emerald-700" : "text-red-700"}`}>
                  {password === confirmPassword ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Las contraseñas coinciden
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3" aria-hidden="true" /> Las contraseñas no coinciden
                    </>
                  )}
                </p>
              )}
            </div>

            <div aria-live="assertive">{error && <AuthAlert>{error}</AuthAlert>}</div>

            <AuthSubmit loading={loading} loadingLabel="Guardando contraseña…" disabled={!password || !confirmPassword}>
              Guardar nueva contraseña
            </AuthSubmit>
          </form>
        </>
      )}
    </AuthShell>
  );
}
