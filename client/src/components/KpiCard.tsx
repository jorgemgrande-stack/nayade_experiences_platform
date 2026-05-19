/**
 * KpiCard — Tarjeta de KPI reutilizable.
 *
 * Extraída de AdminDashboard.tsx (Fase 2 RRHH) para reutilizar en
 * HRDashboard y futuros paneles del módulo Personal/RRHH.
 *
 * API:
 *   <KpiCard
 *     label="Empleados activos"
 *     value={12}
 *     icon={Users}
 *     color="emerald"
 *     subLabel="Total de empleados"
 *     href="/admin/personal/empleados"
 *   />
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const KPI_STYLES = {
  emerald: { bg: "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/80 dark:via-emerald-900/30 dark:to-[#080e1c]", border: "border-emerald-200 dark:border-emerald-500/30", glow: "bg-emerald-500/10", icon: "text-emerald-600 dark:text-emerald-400", number: "text-emerald-700 dark:text-emerald-300", label: "text-emerald-600/70 dark:text-emerald-300/70", dot: "bg-emerald-500 dark:bg-emerald-400" },
  blue:    { bg: "bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/80 dark:via-blue-900/30 dark:to-[#080e1c]",         border: "border-blue-200 dark:border-blue-500/30",     glow: "bg-blue-500/10",    icon: "text-blue-600 dark:text-blue-400",       number: "text-blue-700 dark:text-blue-300",       label: "text-blue-600/70 dark:text-blue-300/70",       dot: "bg-blue-500 dark:bg-blue-400" },
  violet:  { bg: "bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/80 dark:via-violet-900/30 dark:to-[#080e1c]",   border: "border-violet-200 dark:border-violet-500/30", glow: "bg-violet-500/10",  icon: "text-violet-600 dark:text-violet-400",   number: "text-violet-700 dark:text-violet-300",   label: "text-violet-600/70 dark:text-violet-300/70",   dot: "bg-violet-500 dark:bg-violet-400" },
  amber:   { bg: "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/80 dark:via-amber-900/30 dark:to-[#080e1c]",     border: "border-amber-200 dark:border-amber-500/30",   glow: "bg-amber-500/10",   icon: "text-amber-600 dark:text-amber-400",     number: "text-amber-700 dark:text-amber-300",     label: "text-amber-600/70 dark:text-amber-300/70",     dot: "bg-amber-500 dark:bg-amber-400" },
  orange:  { bg: "bg-gradient-to-br from-orange-50 to-white dark:from-orange-950/80 dark:via-orange-900/30 dark:to-[#080e1c]",   border: "border-orange-200 dark:border-orange-500/30", glow: "bg-orange-500/10",  icon: "text-orange-600 dark:text-orange-400",   number: "text-orange-700 dark:text-orange-300",   label: "text-orange-600/70 dark:text-orange-300/70",   dot: "bg-orange-500 dark:bg-orange-400" },
  rose:    { bg: "bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/80 dark:via-rose-900/30 dark:to-[#080e1c]",         border: "border-rose-200 dark:border-rose-500/30",     glow: "bg-rose-500/10",    icon: "text-rose-600 dark:text-rose-400",       number: "text-rose-700 dark:text-rose-300",       label: "text-rose-600/70 dark:text-rose-300/70",       dot: "bg-rose-500 dark:bg-rose-400" },
} as const;

export type KpiColor = keyof typeof KPI_STYLES;

export function useCountUp(target: number, duration = 900) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

export interface KpiCardProps {
  label: string;
  value: number;
  suffix?: string;
  change?: string;
  positive?: boolean;
  subLabel?: string;
  icon: React.ElementType;
  color: KpiColor;
  href?: string;
}

export function KpiCard({ label, value, suffix = "", change, positive, subLabel, icon: Icon, color, href }: KpiCardProps) {
  const s = KPI_STYLES[color];
  const animated = useCountUp(value);
  const inner = (
    <div className={cn("group relative flex flex-col justify-between p-4 rounded-xl border transition-all duration-300 overflow-hidden h-full", s.bg, s.border, href && "cursor-pointer hover:scale-[1.02] hover:brightness-110")}>
      <div className={cn("absolute -top-3 -right-3 w-14 h-14 rounded-full blur-xl opacity-50 group-hover:opacity-80 transition-opacity", s.glow)} />
      <div className="flex items-center justify-between mb-3 relative z-10">
        <span className={cn("text-[10px] font-semibold uppercase tracking-widest", s.label)}>{label}</span>
        <div className={cn("p-1.5 rounded-lg border", s.glow, s.border)}>
          <Icon className={cn("w-3.5 h-3.5", s.icon)} />
        </div>
      </div>
      <div className="relative z-10">
        <div className={cn("text-2xl font-black tabular-nums tracking-tight leading-none mb-1", s.number)}>{animated}{suffix}</div>
        {change && (
          <div className={cn("flex items-center gap-1 text-[10px] font-semibold mt-1", positive ? "text-emerald-400" : "text-rose-400")}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change} vs mes anterior
          </div>
        )}
        {subLabel && <p className={cn("text-[10px] mt-1", s.label)}>{subLabel}</p>}
      </div>
      <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 opacity-60", s.dot)} />
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default KpiCard;
