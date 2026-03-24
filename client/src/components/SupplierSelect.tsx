import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SupplierSelectProps {
  value: number | string | null | undefined;
  onChange: (value: number | null) => void;
  placeholder?: string;
}

export default function SupplierSelect({ value, onChange, placeholder = "Sin proveedor asignado" }: SupplierSelectProps) {
  const { data: suppliers } = trpc.suppliers.list.useQuery();
  const strValue = value != null && value !== "" ? String(value) : "none";

  return (
    <Select value={strValue} onValueChange={(v) => onChange(v === "none" ? null : parseInt(v, 10))}>
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
