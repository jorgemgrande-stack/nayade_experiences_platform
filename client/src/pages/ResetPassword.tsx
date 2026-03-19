/**
 * ResetPassword.tsx — Página /nueva-contrasena?token=xxx
 *
 * Valida el token al cargar, muestra el formulario de nueva contraseña
 * y llama a POST /api/auth/reset-password.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, Loader2, XCircle } from "lucide-react";

export default function ResetPassword() {
  const [, navigate] = useLocation();

  const [token, setToken] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null); // null = validando
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
      .then(r => r.json())
      .then(data => setTokenValid(data.valid === true))
      .catch(() => setTokenValid(false));
  }, []);

  const passwordStrength = (() => {
    if (password.length === 0) return null;
    if (password.length < 8) return { level: "weak", label: "Muy corta (mín. 8 caracteres)", color: "bg-red-500" };
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return { level: "medium", label: "Aceptable", color: "bg-amber-500" };
    }
    return { level: "strong", label: "Segura", color: "bg-emerald-500" };
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error al cambiar la contraseña. El enlace puede haber expirado.");
        return;
      }

      setDone(true);
      // Redirigir al login tras 3 segundos
      setTimeout(() => navigate("/login"), 3000);
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[#0d1b2a]">
      {/* Panel izquierdo — marca */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1b2a] via-[#1a2f4a] to-[#0d1b2a]" />
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 50%, #f5a623 0%, transparent 50%), radial-gradient(circle at 70% 20%, #3b82f6 0%, transparent 40%)"
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f5a623] flex items-center justify-center font-bold text-[#0d1b2a] text-lg">N</div>
          <div>
            <div className="text-white font-bold text-lg leading-tight">NÁYADE</div>
            <div className="text-[#f5a623] text-xs tracking-widest uppercase">Experiences</div>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Nueva<br />
            <span className="text-[#f5a623]">contraseña</span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Elige una contraseña segura para proteger tu cuenta de administración.
          </p>
        </div>
        <div className="relative z-10 text-slate-500 text-sm">
          Los Ángeles de San Rafael, Segovia · A 45 min de Madrid
        </div>
      </div>

      {/* Panel derecho */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Logo móvil */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-[#f5a623] flex items-center justify-center font-bold text-[#0d1b2a] text-lg">N</div>
            <div>
              <div className="text-white font-bold text-lg leading-tight">NÁYADE</div>
              <div className="text-[#f5a623] text-xs tracking-widest uppercase">Experiences</div>
            </div>
          </div>

          {/* Validando token */}
          {tokenValid === null && (
            <div className="text-center py-12">
              <Loader2 className="w-10 h-10 text-[#f5a623] animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Verificando enlace…</p>
            </div>
          )}

          {/* Token inválido o expirado */}
          {tokenValid === false && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Enlace no válido</h2>
              <p className="text-slate-400 leading-relaxed mb-8">
                Este enlace de recuperación ha expirado o ya ha sido utilizado. Los enlaces son válidos durante 60 minutos.
              </p>
              <Button
                onClick={() => navigate("/recuperar-contrasena")}
                className="bg-[#f5a623] hover:bg-[#e09520] text-[#0d1b2a] font-semibold"
              >
                Solicitar nuevo enlace
              </Button>
            </div>
          )}

          {/* Contraseña cambiada con éxito */}
          {done && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">¡Contraseña actualizada!</h2>
              <p className="text-slate-400 leading-relaxed mb-2">
                Tu contraseña ha sido cambiada correctamente.
              </p>
              <p className="text-slate-500 text-sm mb-8">
                Serás redirigido al inicio de sesión en unos segundos…
              </p>
              <Button
                onClick={() => navigate("/login")}
                className="bg-[#f5a623] hover:bg-[#e09520] text-[#0d1b2a] font-semibold"
              >
                Ir al inicio de sesión
              </Button>
            </div>
          )}

          {/* Formulario de nueva contraseña */}
          {tokenValid === true && !done && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Nueva contraseña</h2>
                <p className="text-slate-400">Elige una contraseña segura de al menos 8 caracteres.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Nueva contraseña */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300 text-sm font-medium">Nueva contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="pl-10 pr-10 bg-[#1a2f4a] border-[#2a4060] text-white placeholder:text-slate-600 focus:border-[#f5a623] focus:ring-[#f5a623]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Indicador de fortaleza */}
                  {passwordStrength && (
                    <div className="space-y-1">
                      <div className="h-1 rounded-full bg-[#2a4060] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                          style={{ width: passwordStrength.level === "weak" ? "33%" : passwordStrength.level === "medium" ? "66%" : "100%" }}
                        />
                      </div>
                      <p className="text-xs text-slate-500">{passwordStrength.label}</p>
                    </div>
                  )}
                </div>

                {/* Confirmar contraseña */}
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="text-slate-300 text-sm font-medium">Confirmar contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="confirm"
                      type={showConfirm ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repite la contraseña"
                      className="pl-10 pr-10 bg-[#1a2f4a] border-[#2a4060] text-white placeholder:text-slate-600 focus:border-[#f5a623] focus:ring-[#f5a623]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Indicador de coincidencia */}
                  {confirmPassword && (
                    <p className={`text-xs flex items-center gap-1 ${password === confirmPassword ? "text-emerald-400" : "text-red-400"}`}>
                      {password === confirmPassword
                        ? <><CheckCircle2 className="w-3 h-3" /> Las contraseñas coinciden</>
                        : <><AlertCircle className="w-3 h-3" /> Las contraseñas no coinciden</>
                      }
                    </p>
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !password || !confirmPassword || password !== confirmPassword}
                  className="w-full bg-[#f5a623] hover:bg-[#e09520] text-[#0d1b2a] font-semibold py-2.5 text-base transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando contraseña…
                    </span>
                  ) : (
                    "Guardar nueva contraseña"
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
