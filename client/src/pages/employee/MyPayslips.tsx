/**
 * MyPayslips — Vista de mis nóminas (Fase 5 RRHH).
 *
 * Sólo lectura. Lista las nóminas del empleado autenticado en estados
 * 'registrada' y 'pagada'. No expone la SS empresa estimada (coste interno).
 */
import { Banknote, FileText, ExternalLink, Loader2, AlertCircle, TrendingUp, Wallet } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function fmtEur(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));
}
function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const mes = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][Number(m)];
  return `${mes} ${y}`;
}
const STATUS_CLASS: Record<string, string> = {
  registrada: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  pagada: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
};
const BONUS_TYPE_LABEL: Record<string, string> = {
  bonus: "Bonus",
  comision: "Comisión",
  prima: "Prima",
  gratificacion: "Gratificación",
  anticipo: "Anticipo",
  ajuste: "Ajuste",
};
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  payroll: "En nómina",
};

export default function MyPayslips() {
  const { data, isLoading } = trpc.hr.portal.myPayslips.useQuery();
  const { data: bonuses } = trpc.hr.portal.myBonuses.useQuery();

  return (
    <EmployeeLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Banknote className="w-5 h-5 text-[var(--portal-accent)]" />
            Mis nóminas
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tu histórico salarial. Solo aparecen nóminas oficiales. Las que tengan PDF se pueden descargar.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-[var(--portal-accent)] animate-spin" />
          </div>
        )}

        {!isLoading && (!data || data.length === 0) && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
            <Banknote className="w-10 h-10 mx-auto mb-3 text-slate-400" />
            <p className="text-sm text-slate-500">No tienes nóminas registradas todavía.</p>
          </div>
        )}

        {!isLoading && data && data.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Periodo</th>
                  <th className="px-4 py-3 text-right">Bruto</th>
                  <th className="px-4 py-3 text-right">IRPF</th>
                  <th className="px-4 py-3 text-right">SS empleado</th>
                  <th className="px-4 py-3 text-right">Neto</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {data.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800 capitalize">{periodLabel(p.period)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--portal-accent)] font-semibold">{fmtEur(p.grossSalary)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtEur(p.irpfAmount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtEur(p.ssEmployee)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-semibold">{fmtEur(p.netSalary)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border", STATUS_CLASS[p.status] ?? "")}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.pdfUrl ? (
                        <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--portal-accent)] hover:opacity-80 inline-flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Descargar <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-slate-500 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bonus e Incentivos (Fase 6) */}
        {bonuses && bonuses.length > 0 && (
          <div className="pt-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> Bonus e incentivos cobrados
            </h2>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Concepto</th>
                    <th className="px-4 py-3">Pago</th>
                    <th className="px-4 py-3 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {bonuses.map(b => (
                    <tr key={b.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {b.paidAt ? new Date(b.paidAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 border border-violet-500/30">
                          {BONUS_TYPE_LABEL[b.type] ?? b.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 text-xs max-w-xs truncate">{b.concept}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {b.paymentMethod === "cash" && <span className="inline-flex items-center gap-1"><Wallet className="w-3 h-3" />{METHOD_LABEL.cash}</span>}
                        {b.paymentMethod === "transfer" && <span className="inline-flex items-center gap-1"><Banknote className="w-3 h-3" />{METHOD_LABEL.transfer}</span>}
                        {b.paymentMethod === "payroll" && <span>{METHOD_LABEL.payroll}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--portal-accent)] font-semibold">{fmtEur(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500 flex gap-2">
          <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          Si echas en falta alguna nómina o bonus, contacta con Recursos Humanos.
        </div>
      </div>
    </EmployeeLayout>
  );
}
