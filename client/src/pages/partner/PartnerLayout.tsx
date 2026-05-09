import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Building2, Plus, LogOut, Loader2, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login?returnTo=" + encodeURIComponent(location)); return; }
    const role = (user as any).role as string;
    if (role !== "partner_admin" && role !== "partner_user") {
      navigate("/admin");
    }
  }, [user, loading, navigate, location]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const role = (user as any).role as string;
  if (role !== "partner_admin" && role !== "partner_user") return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navbar */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/partner/dashboard" className="flex items-center gap-2 font-semibold text-gray-800">
              <Building2 className="w-5 h-5 text-orange-500" />
              Portal Colaboradores
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              <Link href="/partner/dashboard">
                <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  location === "/partner/dashboard"
                    ? "bg-orange-50 text-orange-600 font-medium"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}>
                  <LayoutDashboard className="w-4 h-4" />
                  Inicio
                </button>
              </Link>
              <Link href="/partner/leads/nuevo">
                <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  location.startsWith("/partner/leads")
                    ? "bg-orange-50 text-orange-600 font-medium"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}>
                  <Plus className="w-4 h-4" />
                  Nuevo lead
                </button>
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{(user as any).name ?? (user as any).email}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-500 hover:text-gray-800"
              onClick={() => logout().then(() => navigate("/login"))}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
