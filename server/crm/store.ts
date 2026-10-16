/** Puerto de persistencia del CRM + implementación en memoria (pruebas/desarrollo). */
import type { Activity, Company, Contact, Contract, ContractVersion, Lead, Opportunity } from "./types";

export interface CrmStore {
  insert<T extends keyof Tables>(table: T, row: Omit<Tables[T], "id">): Promise<Tables[T]>;
  get<T extends keyof Tables>(table: T, id: number): Promise<Tables[T] | null>;
  update<T extends keyof Tables>(table: T, id: number, patch: Partial<Omit<Tables[T], "id">>): Promise<Tables[T]>;
  list<T extends keyof Tables>(table: T, filter?: Partial<Tables[T]>, opts?: { limit?: number; orderBy?: "createdAt" | "id"; desc?: boolean }): Promise<Tables[T][]>;
  remove(table: keyof Tables, id: number): Promise<void>;
}

export interface Tables {
  companies: Company;
  contacts: Contact;
  leads: Lead;
  opportunities: Opportunity;
  contracts: Contract;
  contractVersions: ContractVersion;
  activities: Activity;
}

export class MemoryCrmStore implements CrmStore {
  private data: { [K in keyof Tables]: Map<number, Tables[K]> } = {
    companies: new Map(),
    contacts: new Map(),
    leads: new Map(),
    opportunities: new Map(),
    contracts: new Map(),
    contractVersions: new Map(),
    activities: new Map(),
  };
  private seq = 0;

  async insert<T extends keyof Tables>(table: T, row: Omit<Tables[T], "id">): Promise<Tables[T]> {
    const id = ++this.seq;
    const full = { ...row, id } as Tables[T];
    (this.data[table] as Map<number, Tables[T]>).set(id, full);
    return { ...full };
  }
  async get<T extends keyof Tables>(table: T, id: number) {
    const r = (this.data[table] as Map<number, Tables[T]>).get(id);
    return r ? { ...r } : null;
  }
  async update<T extends keyof Tables>(table: T, id: number, patch: Partial<Omit<Tables[T], "id">>) {
    const m = this.data[table] as Map<number, Tables[T]>;
    const cur = m.get(id);
    if (!cur) throw new Error("not found");
    const next = { ...cur, ...patch } as Tables[T];
    m.set(id, next);
    return { ...next };
  }
  async list<T extends keyof Tables>(table: T, filter: Partial<Tables[T]> = {}, opts: { limit?: number; desc?: boolean } = {}) {
    let rows = Array.from((this.data[table] as Map<number, Tables[T]>).values()).filter((r) =>
      Object.entries(filter).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
    );
    rows.sort((a, b) => (a as { id: number }).id - (b as { id: number }).id);
    if (opts.desc) rows.reverse();
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows.map((r) => ({ ...r }));
  }
  async remove(table: keyof Tables, id: number) {
    this.data[table].delete(id);
  }
}
