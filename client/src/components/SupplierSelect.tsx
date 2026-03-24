import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SupplierSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SupplierSelect({ value, onChange, placeholder = "Sin proveedor asignado" }: SupplierSelectProps) {
  const { data: suppliers } = trpc.suppliers.list.useQuery();

  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger className="mt-1">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {(suppliers ?? []).map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            {s.fiscalName} {s.status !== "activo" ? `(${s.status})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
