/**
 * ForgotPassword.tsx — Página /recuperar-contrasena
 *
 * Muestra un formulario donde el usuario introduce su email.
 * Llama a POST /api/auth/forgot-password y muestra confirmación.
 */

import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          origin: window.location.origin,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Error al enviar el email. Inténtalo de nuevo.");
        return;
      }

      setSent(true);
    } catch {
      setError("Error de conexión. Comprueba que el servidor está en marcha.");
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
            ¿Olvidaste tu<br />
            <span className="text-[#f5a623]">contraseña?</span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            No te preocupes. Te enviaremos un enlace seguro para crear una nueva contraseña.
          </p>
        </div>
        <div className="relative z-10 text-slate-500 text-sm">
          Los Ángeles de San Rafael, Segovia · A 45 min de Madrid
        </div>
      </div>

      {/* Panel derecho — formulario */}
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

          {sent ? (
            /* Estado: email enviado */
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Revisa tu email</h2>
              <p className="text-slate-400 leading-relaxed mb-2">
                Si existe una cuenta con <strong className="text-slate-300">{email}</strong>, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
              </p>
              <p className="text-slate-500 text-sm mb-8">
                El enlace caduca en 60 minutos. Revisa también la carpeta de spam.
              </p>
              <Link href="/login">
                <Button variant="outline" className="border-[#2a4060] text-slate-300 hover:bg-[#1a2f4a] hover:text-white">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Volver al inicio de sesión
                </Button>
              </Link>
            </div>
          ) : (
            /* Estado: formulario */
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Recuperar contraseña</h2>
                <p className="text-slate-400">Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300 text-sm font-medium">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="tu@email.com"
                      className="pl-10 bg-[#1a2f4a] border-[#2a4060] text-white placeholder:text-slate-600 focus:border-[#f5a623] focus:ring-[#f5a623]/20"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-[#f5a623] hover:bg-[#e09520] text-[#0d1b2a] font-semibold py-2.5 text-base transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Enviando enlace…
                    </span>
                  ) : (
                    "Enviar enlace de recuperación"
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login">
                  <span className="text-slate-500 hover:text-slate-300 text-sm transition-colors cursor-pointer inline-flex items-center gap-1">
                    <ArrowLeft className="w-3 h-3" />
                    Volver al inicio de sesión
                  </span>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
