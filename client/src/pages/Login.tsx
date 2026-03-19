/**
 * Login.tsx — Formulario de inicio de sesión local.
 *
 * Se usa cuando LOCAL_AUTH=true en el servidor.
 * Llama a POST /api/auth/login, obtiene la cookie JWT y redirige al destino.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, Mail, AlertCircle, Loader2 } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si ya hay sesión activa, redirigir al admin
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (meQuery.data) {
      const params = new URLSearchParams(window.location.search);
      navigate(params.get("returnTo") ?? "/admin");
    }
  }, [meQuery.data, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Credenciales incorrectas. Inténtalo de nuevo.");
        return;
      }

      // Invalidar caché de auth para que useAuth recargue el usuario
      await utils.auth.me.invalidate();

      // Redirigir al destino
      const params = new URLSearchParams(window.location.search);
      navigate(params.get("returnTo") ?? "/admin");
    } catch {
      setError("Error de conexión. Comprueba que el servidor está en marcha.");
    } finally {
      setLoading(false);
    }
  }

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d1b2a]">
        <Loader2 className="w-8 h-8 text-[#f5a623] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#0d1b2a]">
      {/* Panel izquierdo — imagen / marca */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        {/* Fondo con gradiente */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1b2a] via-[#1a2f4a] to-[#0d1b2a]" />
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 50%, #f5a623 0%, transparent 50%), radial-gradient(circle at 70% 20%, #3b82f6 0%, transparent 40%)"
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f5a623] flex items-center justify-center font-bold text-[#0d1b2a] text-lg">
            N
          </div>
          <div>
            <div className="text-white font-bold text-lg leading-tight">NÁYADE</div>
            <div className="text-[#f5a623] text-xs tracking-widest uppercase">Experiences</div>
          </div>
        </div>

        {/* Texto central */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Panel de<br />
            <span className="text-[#f5a623]">Administración</span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Gestiona reservas, experiencias, el hotel y el SPA desde un único lugar.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-slate-500 text-sm">
          Los Ángeles de San Rafael, Segovia · A 45 min de Madrid
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Logo móvil */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-[#f5a623] flex items-center justify-center font-bold text-[#0d1b2a] text-lg">
              N
            </div>
            <div>
              <div className="text-white font-bold text-lg leading-tight">NÁYADE</div>
              <div className="text-[#f5a623] text-xs tracking-widest uppercase">Experiences</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Iniciar sesión</h2>
            <p className="text-slate-400">Accede con tu email y contraseña de administrador.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300 text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@nayadeexperiences.es"
                  className="pl-10 bg-[#1a2f4a] border-[#2a4060] text-white placeholder:text-slate-600 focus:border-[#f5a623] focus:ring-[#f5a623]/20"
                />
              </div>
            </div>

            {/* Contraseña */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300 text-sm font-medium">
                Contraseña
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
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
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Botón */}
            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-[#f5a623] hover:bg-[#e09520] text-[#0d1b2a] font-semibold py-2.5 text-base transition-colors disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Iniciando sesión…
                </span>
              ) : (
                "Iniciar sesión"
              )}
            </Button>
          </form>

          {/* Enlace a la web pública */}
          <div className="mt-8 text-center">
            <a
              href="/"
              className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
            >
              ← Volver a la web pública
            </a>
          </div>

          {/* Nota de entorno */}
          <div className="mt-6 p-3 rounded-lg bg-[#1a2f4a]/50 border border-[#2a4060] text-slate-500 text-xs text-center">
            Modo de autenticación local activo
          </div>
        </div>
      </div>
    </div>
  );
}
