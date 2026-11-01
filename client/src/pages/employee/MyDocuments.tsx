/**
 * MyDocuments — Lista de documentos propios del empleado (Fase 3 RRHH).
 *
 * Solo lectura. Los documentos los sube el admin desde la ficha del empleado
 * en /admin/personal/empleados/:id (versión clásica).
 */
import { FileText, ExternalLink, Loader2, Calendar } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";

const DOC_TYPE_LABELS: Record<string, string> = {
  dni: "DNI / NIE",
  contrato: "Contrato",
  certificado: "Certificado",
  prl: "Prevención de Riesgos",
  formacion: "Formación",
  nomina_pdf: "Nómina (PDF)",
  baja_medica: "Baja médica",
  finiquito: "Finiquito",
  otro: "Otro",
};

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MyDocuments() {
  const { data: docs, isLoading } = trpc.hr.portal.myDocuments.useQuery();

  return (
    <EmployeeLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--portal-accent)]" />
            Mis documentos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Documentos asociados a tu expediente. Solo lectura — para subir nuevos contacta con RR.HH.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-[var(--portal-accent)] animate-spin" />
          </div>
        )}

        {!isLoading && (!docs || docs.length === 0) && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-slate-400" />
            <p className="text-sm text-slate-500">No tienes documentos disponibles todavía.</p>
          </div>
        )}

        {!isLoading && docs && docs.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3 hidden md:table-cell">Vencimiento</th>
                  <th className="px-4 py-3 hidden md:table-cell">Subido</th>
                  <th className="px-4 py-3 text-right">Archivo</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => {
                  const isExpiringSoon = d.expiresAt &&
                    new Date(d.expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000 &&
                    new Date(d.expiresAt).getTime() > Date.now();
                  const isExpired = d.expiresAt && new Date(d.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] border border-[var(--portal-accent-line)]">
                          {DOC_TYPE_LABELS[d.type] ?? d.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-800">{d.name}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {d.expiresAt ? (
                          <span className={`inline-flex items-center gap-1 text-xs ${
                            isExpired ? "text-rose-700" : isExpiringSoon ? "text-amber-700" : "text-slate-600"
                          }`}>
                            <Calendar className="w-3 h-3" />
                            {fmtDate(d.expiresAt)}
                            {isExpired && <span className="text-[10px] uppercase ml-1">(vencido)</span>}
                            {!isExpired && isExpiringSoon && <span className="text-[10px] uppercase ml-1">(próximo)</span>}
                          </span>
                        ) : <span className="text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-600 text-xs">
                        {fmtDate(d.createdAt) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--portal-accent)] hover:opacity-80 inline-flex items-center gap-1"
                        >
                          Abrir <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </EmployeeLayout>
  );
}
