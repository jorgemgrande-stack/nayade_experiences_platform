import React, { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, BookOpen, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CatalogProduct = {
  id: number;
  title: string;
  basePrice: string;
  fiscalRegime: string | null;
  taxRate: string | null;
  category: string | null;
  productType: string;
};

export type SourceType = "manual" | "experience" | "legoPack";

type FilterType = "all" | "experience" | "legoPack";

// ─── CatalogModal ─────────────────────────────────────────────────────────────

function CatalogModal({
  onSelect,
  onClose,
}: {
  onSelect: (product: CatalogProduct) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: results, isLoading } = trpc.crm.products.search.useQuery(
    { q: search || undefined, limit: 50, sourceType: filter }
  );

  const TYPE_LABELS: Record<string, string> = {
    experience: "Experiencia",
    legoPack: "Lego Pack",
  };

  const FILTER_OPTS: { value: FilterType; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "experience", label: "Experiencias" },
    { value: "legoPack", label: "Lego Packs" },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[80vh] flex flex-col bg-[#0d1526] border-foreground/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-orange-400" />
            Buscar en catálogo de productos
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
            <Input
              autoFocus
              placeholder="Buscar por nombre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40"
            />
          </div>

          {/* Filtros */}
          <div className="flex gap-2 flex-wrap">
            {FILTER_OPTS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filter === opt.value
                    ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                    : "border-foreground/20 text-foreground/50 hover:border-foreground/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Resultados */}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
              </div>
            ) : !results?.length ? (
              <div className="text-center py-8 text-foreground/30 text-sm">
                {search ? `No se encontraron productos para "${search}"` : "No hay productos en el catálogo"}
              </div>
            ) : (
              results.map((p) => (
                <button
                  key={`${p.productType}-${p.id}`}
                  type="button"
                  onClick={() => { onSelect(p as CatalogProduct); onClose(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-foreground/[0.08] transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{p.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        p.productType === "experience"
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-purple-500/20 text-purple-300"
                      }`}>
                        {TYPE_LABELS[p.productType] ?? p.productType}
                      </span>
                      {p.category && p.category !== "experience" && p.category !== "legoPack" && (
                        <span className="text-[10px] text-foreground/40 capitalize">{p.category}</span>
                      )}
                      {p.fiscalRegime === "reav" && (
                        <span className="text-[10px] text-amber-400/70">REAV</span>
                      )}
                      {p.taxRate && p.fiscalRegime !== "reav" && (
                        <span className="text-[10px] text-foreground/40">IVA {p.taxRate}%</span>
                      )}
                    </div>
                  </div>
                  <div className="text-orange-400 text-sm font-semibold shrink-0">
                    {Number(p.basePrice) > 0 ? `${Number(p.basePrice).toFixed(2)} €` : "—"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── CatalogConceptSelector ───────────────────────────────────────────────────

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSelectProduct: (product: CatalogProduct) => void;
  sourceType?: SourceType;
  sourceId?: number;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  showBadge?: boolean;
};

export function CatalogConceptSelector({
  value,
  onChange,
  onSelectProduct,
  sourceType,
  sourceId,
  className = "",
  inputClassName = "",
  placeholder = "Descripción o busca un producto...",
  showBadge = true,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: suggestions } = trpc.crm.products.search.useQuery(
    { q: q || undefined, limit: 8 },
    { enabled: dropdownOpen && q.length >= 2 }
  );

  // Cierra dropdown al hacer clic fuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const BADGE_CONFIG: Record<SourceType, { label: string; cls: string }> = {
    experience: { label: "Experiencia", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    legoPack: { label: "Lego Pack", cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    manual: { label: "Manual", cls: "bg-foreground/10 text-foreground/50 border-foreground/20" },
  };

  const badge = sourceType ? BADGE_CONFIG[sourceType] : null;

  return (
    <>
      <div ref={containerRef} className={`relative ${className}`}>
        {/* Input principal */}
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setQ(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => {
            setDropdownOpen(true);
            if (value) setQ(value);
          }}
          placeholder={placeholder}
          className={inputClassName}
        />

        {/* Botón catálogo */}
        <button
          type="button"
          title="Buscar en catálogo"
          onClick={() => { setDropdownOpen(false); setCatalogOpen(true); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-orange-400 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
        </button>

        {/* Dropdown autocomplete */}
        {dropdownOpen && suggestions && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.12] rounded-lg shadow-xl max-h-48 overflow-y-auto">
            {suggestions.map((p: any) => (
              <button
                key={`${p.productType}-${p.id}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectProduct(p as CatalogProduct);
                  setDropdownOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-foreground/[0.08] text-sm text-white flex justify-between items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="truncate block">{p.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    p.productType === "experience"
                      ? "bg-blue-500/20 text-blue-300"
                      : "bg-purple-500/20 text-purple-300"
                  }`}>
                    {p.productType === "experience" ? "Experiencia" : "Lego Pack"}
                  </span>
                </div>
                <span className="text-orange-400 text-xs shrink-0">
                  {Number(p.basePrice) > 0 ? `${Number(p.basePrice).toFixed(2)} €` : "—"}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Badge de fuente (debajo del input) */}
        {showBadge && badge && (
          <div className="absolute -bottom-4 left-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
        )}
      </div>

      {/* Modal catálogo */}
      {catalogOpen && (
        <CatalogModal
          onSelect={(p) => onSelectProduct(p)}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </>
  );
}
