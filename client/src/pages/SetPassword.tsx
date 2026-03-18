import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Eye, EyeOff, Lock, AlertCircle, Loader2 } from "lucide-react";

// Náyade logo URL (blue version)
const LOGO_URL = "https://cdn-biz.manus.space/biz-file/c1/AV298FS8t5SaTurBBRqhgQ/1741956872-nayade_logo_azul.jpg";

export default function SetPassword() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [userName, setUserName] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);
  }, []);

  const setPasswordMutation = trpc.public.setPassword.useMutation({
    onSuccess: (data) => {
      setUserName(data.name ?? "");
      setDone(true);
    },
    onError: () => {},
  });

  const passwordStrength = (pw: string): { level: number; label: string; color: string } => {
    if (pw.length === 0) return { level: 0, label: "", color: "" };
    if (pw.length < 6) return { level: 1, label: "Muy corta", color: "bg-red-500" };
    if (pw.length < 8) return { level: 2, label: "Débil", color: "bg-orange-400" };
    const hasUpper = /[A-Z]/.test(pw);
    const hasNumber = /[0-9]/.test(pw);
    const hasSpecial = /[^A-Za-z0-9]/.test(pw);
    const score = [hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
    if (score >= 2 && pw.length >= 10) return { level: 4, label: "Fuerte", color: "bg-green-500" };
    if (score >= 1) return { level: 3, label: "Media", color: "bg-yellow-400" };
    return { level: 2, label: "Débil", color: "bg-orange-400" };
  };

  const strength = passwordStrength(password);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");

    if (!token) {
      setValidationError("Token inválido. Usa el enlace del email.");
      return;
    }
    if (password.length < 6) {
      setValidationError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setValidationError("Las contraseñas no coinciden.");
      return;
    }

    setPasswordMutation.mutate({ token, password });
  };

  // Success screen
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            ¡Contraseña establecida!
          </h1>
          <p className="text-gray-600 mb-6">
            {userName ? `Bienvenido, ${userName}. ` : ""}Tu cuenta está lista. Ya puedes acceder al panel de administración.
          </p>
          <Button
            onClick={() => setLocation("/admin")}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white"
          >
            Ir al panel de administración
          </Button>
        </div>
      </div>
    );
  }

  // No token
  if (token === null && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("token")) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace inválido</h1>
            <p className="text-gray-600">
              Este enlace no es válido o ha expirado. Contacta con el administrador para solicitar un nuevo enlace.
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-md w-full">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900 to-blue-700 px-8 py-6 text-center">
          <img src={LOGO_URL} alt="Náyade Experiences" className="h-14 w-14 rounded-full mx-auto mb-3 object-cover border-2 border-white/30" />
          <div className="text-white font-bold text-lg tracking-wide">NÁYADE</div>
          <div className="text-blue-200 text-xs tracking-widest uppercase">Experiences</div>
        </div>

        {/* Form */}
        <div className="px-8 py-7">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-5 h-5 text-blue-700" />
            <h2 className="text-xl font-bold text-gray-900">Establece tu contraseña</h2>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Crea una contraseña segura para acceder al panel de Náyade Experiences.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Nueva contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Strength bar */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1 h-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-full transition-colors ${
                          i <= strength.level ? strength.color : "bg-gray-200"
                        }`}
                      />
                    ))}
                  </div>
                  {strength.label && (
                    <p className="text-xs text-gray-500">Seguridad: <span className="font-medium">{strength.label}</span></p>
                  )}
                </div>
              )}
            </div>

            {/* Confirm */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirmar contraseña</Label>
              <div className="relative">
                <Input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repite la contraseña"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={`pr-10 ${confirm && confirm !== password ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirm && confirm !== password && (
                <p className="text-xs text-red-500">Las contraseñas no coinciden</p>
              )}
            </div>

            {/* Errors */}
            {(validationError || setPasswordMutation.error) && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">
                  {validationError || setPasswordMutation.error?.message}
                </p>
              </div>
            )}

            <Button
              type="submit"
              disabled={setPasswordMutation.isPending}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white h-11 text-base font-semibold mt-2"
            >
              {setPasswordMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </span>
              ) : (
                "Establecer contraseña"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
