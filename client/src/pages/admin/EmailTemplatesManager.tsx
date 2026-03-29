import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Mail,
  Eye,
  Send,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Loader2,
  Monitor,
  Smartphone,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Category = "all" | "reservas" | "presupuestos" | "anulaciones" | "tpv" | "ticketing" | "sistema";

const CATEGORY_LABELS: Record<string, string> = {
  reservas: "Reservas",
  presupuestos: "Presupuestos",
  anulaciones: "Anulaciones",
  tpv: "TPV",
  ticketing: "Ticketing",
  sistema: "Sistema",
};

const CATEGORY_COLORS: Record<string, string> = {
  reservas: "bg-blue-100 text-blue-700 border-blue-200",
  presupuestos: "bg-amber-100 text-amber-700 border-amber-200",
  anulaciones: "bg-red-100 text-red-700 border-red-200",
  tpv: "bg-purple-100 text-purple-700 border-purple-200",
  ticketing: "bg-green-100 text-green-700 border-green-200",
  sistema: "bg-slate-100 text-slate-700 border-slate-200",
};

const RECIPIENT_LABELS: Record<string, string> = {
  cliente: "Cliente",
  admin: "Interno",
  ambos: "Ambos",
};

const RECIPIENT_COLORS: Record<string, string> = {
  cliente: "bg-sky-50 text-sky-700 border-sky-200",
  admin: "bg-orange-50 text-orange-700 border-orange-200",
  ambos: "bg-violet-50 text-violet-700 border-violet-200",
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function EmailTemplatesManager() {

  // State
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [testEmail, setTestEmail] = useState("reservas@nayadeexperiences.es");
  const [sendingAll, setSendingAll] = useState(false);
  const [allResults, setAllResults] = useState<{ id: string; name: string; ok: boolean; error?: string }[] | null>(null);

  // Queries
  const { data: templates, isLoading: loadingList } = trpc.emailTemplates.list.useQuery();
  const { data: preview, isLoading: loadingPreview } = trpc.emailTemplates.preview.useQuery(
    { templateId: selectedTemplateId! },
    { enabled: !!selectedTemplateId }
  );

  // Mutations
  const sendTestMutation = trpc.emailTemplates.sendTest.useMutation({
    onSuccess: (data) => {
      toast.success("Prueba enviada", { description: `"${data.templateName}" enviada a ${data.sentTo}` });
    },
    onError: (err) => {
      toast.error("Error al enviar", { description: err.message });
    },
  });

  const sendAllMutation = trpc.emailTemplates.sendAllTests.useMutation({
    onSuccess: (data) => {
      setAllResults(data.results);
      setSendingAll(false);
      if (data.failed > 0) {
        toast.error(`${data.sent}/${data.total} plantillas enviadas`, { description: `${data.failed} fallaron. Revisa los resultados.` });
      } else {
        toast.success(`${data.sent}/${data.total} plantillas enviadas`, { description: "Todas enviadas correctamente." });
      }
    },
    onError: (err) => {
      setSendingAll(false);
      toast.error("Error al enviar", { description: err.message });
    },
  });

  // Filtered templates
  const filtered = templates?.filter(t =>
    activeCategory === "all" || t.category === activeCategory
  ) ?? [];

  const categories: { id: Category; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: templates?.length ?? 0 },
    ...Object.keys(CATEGORY_LABELS).map(cat => ({
      id: cat as Category,
      label: CATEGORY_LABELS[cat],
      count: templates?.filter(t => t.category === cat).length ?? 0,
    })),
  ];

  const handleSendAll = () => {
    if (!testEmail) return;
    setSendingAll(true);
    setAllResults(null);
    sendAllMutation.mutate({ toEmail: testEmail });
  };

  return (
    <AdminLayout>
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Plantillas de Email</h1>
              <p className="text-xs text-muted-foreground">
                {templates?.length ?? 0} plantillas estandarizadas · Diseño unificado Náyade Experiences
              </p>
            </div>
          </div>
          {/* Send All */}
          <div className="flex items-center gap-2">
            <Input
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="email@destino.com"
              className="w-64 h-8 text-sm"
            />
            <Button
              size="sm"
              onClick={handleSendAll}
              disabled={sendingAll || !testEmail}
              className="gap-1.5"
            >
              {sendingAll ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
              ) : (
                <><SendHorizonal className="w-3.5 h-3.5" /> Enviar todas</>
              )}
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel — template list */}
          <div className="w-80 flex-shrink-0 border-r border-border flex flex-col min-h-0 bg-muted/20">
            {/* Category filter */}
            <div className="p-3 border-b border-border flex flex-wrap gap-1.5">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeCategory === cat.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {cat.label}
                  <span className="ml-1 opacity-70">({cat.count})</span>
                </button>
              ))}
            </div>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
                  <Mail className="w-8 h-8 mb-2 opacity-30" />
                  Sin plantillas en esta categoría
                </div>
              ) : (
                filtered.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors hover:bg-accent/50 ${
                      selectedTemplateId === tpl.id ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium text-foreground leading-tight">{tpl.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
                      {tpl.description}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${CATEGORY_COLORS[tpl.category] ?? ""}`}>
                        {CATEGORY_LABELS[tpl.category] ?? tpl.category}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RECIPIENT_COLORS[tpl.recipient] ?? ""}`}>
                        {RECIPIENT_LABELS[tpl.recipient] ?? tpl.recipient}
                      </span>
                      {/* Result badge if sendAll was run */}
                      {allResults && (() => {
                        const r = allResults.find(x => x.id === tpl.id);
                        if (!r) return null;
                        return r.ok
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto" />
                          : <XCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />;
                      })()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right panel — preview */}
          <div className="flex-1 flex flex-col min-h-0 bg-muted/10">
            {!selectedTemplateId ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <Eye className="w-12 h-12 opacity-20" />
                <p className="text-sm">Selecciona una plantilla para previsualizarla</p>
              </div>
            ) : (
              <>
                {/* Preview toolbar */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {preview?.name ?? "Cargando..."}
                    </span>
                    {preview && (
                      <>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${CATEGORY_COLORS[preview.category] ?? ""}`}>
                          {CATEGORY_LABELS[preview.category] ?? preview.category}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RECIPIENT_COLORS[preview.recipient] ?? ""}`}>
                          {RECIPIENT_LABELS[preview.recipient] ?? preview.recipient}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Desktop / Mobile toggle */}
                    <div className="flex items-center border border-border rounded-md overflow-hidden">
                      <button
                        onClick={() => setPreviewMode("desktop")}
                        className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                          previewMode === "desktop" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        Desktop
                      </button>
                      <button
                        onClick={() => setPreviewMode("mobile")}
                        className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                          previewMode === "mobile" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        Mobile
                      </button>
                    </div>
                    {/* Send test */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-7 text-xs"
                      disabled={sendTestMutation.isPending || !testEmail}
                      onClick={() => {
                        if (selectedTemplateId && testEmail) {
                          sendTestMutation.mutate({ templateId: selectedTemplateId, toEmail: testEmail });
                        }
                      }}
                    >
                      {sendTestMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      Enviar prueba
                    </Button>
                  </div>
                </div>

                {/* Preview frame */}
                <div className="flex-1 overflow-auto p-6 flex justify-center">
                  {loadingPreview ? (
                    <div className="flex items-center justify-center w-full">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : preview?.html ? (
                    <div
                      className={`transition-all duration-300 ${
                        previewMode === "mobile" ? "w-[390px]" : "w-full max-w-[680px]"
                      }`}
                    >
                      <div className="rounded-xl overflow-hidden shadow-lg border border-border bg-white">
                        <iframe
                          srcDoc={preview.html}
                          className="w-full border-0"
                          style={{ height: "700px" }}
                          title={`Preview: ${preview.name}`}
                          sandbox="allow-same-origin"
                        />
                      </div>
                      {preview.description && (
                        <p className="mt-3 text-xs text-muted-foreground text-center">
                          {preview.description}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Send All Results panel */}
        {allResults && (
          <div className="border-t border-border bg-background px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                Resultados del envío masivo —{" "}
                <span className="text-green-600">{allResults.filter(r => r.ok).length} enviadas</span>
                {allResults.filter(r => !r.ok).length > 0 && (
                  <span className="text-red-600 ml-1">· {allResults.filter(r => !r.ok).length} fallaron</span>
                )}
              </span>
              <button onClick={() => setAllResults(null)} className="text-xs text-muted-foreground hover:text-foreground">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allResults.map(r => (
                <div
                  key={r.id}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                    r.ok
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  }`}
                  title={r.error}
                >
                  {r.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {r.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
