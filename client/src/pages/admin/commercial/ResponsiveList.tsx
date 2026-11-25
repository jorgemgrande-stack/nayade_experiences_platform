/**
 * Listado para tablas anchas (muchas columnas): tarjetas hasta 1279 px (la barra lateral deja poco ancho incluso en
 * tableta) y tabla compacta desde 1280 px. Mismas filas y mismas columnas que `PanelDataList`; solo cambia el punto
 * de corte para que la página nunca desborde en horizontal.
 */
import type { ReactNode } from "react";
import { PanelDataList, type PanelColumn } from "@/components/admin/PanelUi";

export function ResponsiveList<T>({ rows, columns, rowKey, caption, card }: {
  rows: T[];
  columns: PanelColumn<T>[];
  rowKey: (row: T) => string | number;
  caption: string;
  /** Contenido de la tarjeta de cada fila (por debajo de 1280 px). */
  card: (row: T) => ReactNode;
}) {
  return (
    <>
      <ul aria-label={caption} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card xl:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="p-4 text-sm">{card(r)}</li>
        ))}
      </ul>
      <div className="hidden xl:block">
        <PanelDataList rows={rows} columns={columns} rowKey={rowKey} caption={caption} />
      </div>
    </>
  );
}
