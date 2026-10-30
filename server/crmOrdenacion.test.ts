/**
 * Ordenación en el servidor de los listados del CRM y de los tickets: lista blanca de `sort`,
 * validación de `dir`, mapeo a campos fijos, desempate por id, nulos al final y paginación.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CrmService } from "./crm/service";
import { MemoryCrmStore } from "./crm/store";
import { applySort, COMPANY_SORT, CONTRACT_SORT, LEAD_SORT, sortComparator, sortKeys } from "./crm/sorting";
import { companiesListQuery, contactsListQuery, contractsListQuery, leadsListQuery } from "./crm/api";
import { listQuery as ticketsListQuery } from "./controlPlane/tickets";
import { MemoryTicketStore, ticketComparator, ticketOrderBy, type Ticket } from "./_core/support/tickets";

describe("validación de sort y dir", () => {
  it("admite solo las claves de la lista blanca de cada listado", () => {
    expect(sortKeys(COMPANY_SORT)).toEqual(["name", "createdAt", "updatedAt", "city", "lifecycle", "status"]);
    expect(sortKeys(LEAD_SORT)).toEqual(["name", "createdAt", "updatedAt", "status", "priority", "source"]);
    expect(contactsListQuery.parse({ sort: "name", dir: "desc" })).toMatchObject({ sort: "name", dir: "desc" });
    expect(contractsListQuery.parse({ sort: "amount" })).toMatchObject({ sort: "amount" });
    expect(companiesListQuery.parse({ sort: "lifecycle", dir: "asc" })).toMatchObject({ sort: "lifecycle", dir: "asc" });
    expect(leadsListQuery.parse({ sort: "priority" })).toMatchObject({ sort: "priority" });
  });

  it("rechaza claves fuera de la lista, columnas crudas, inyección y direcciones no válidas", () => {
    expect(() => companiesListQuery.parse({ sort: "taxId" })).toThrow();
    expect(() => leadsListQuery.parse({ sort: "email" })).toThrow();
    expect(() => contactsListQuery.parse({ sort: "created_at" })).toThrow();
    expect(() => contractsListQuery.parse({ sort: "amountCents" })).toThrow();
    expect(() => leadsListQuery.parse({ sort: "name; DROP TABLE leads" })).toThrow();
    expect(() => leadsListQuery.parse({ sort: "name", dir: "DESC" })).toThrow();
    expect(() => leadsListQuery.parse({ sort: ["name", "id"] })).toThrow();
  });

  it("sin sort no cambia nada y la paginación conserva sus valores por defecto", () => {
    const f = leadsListQuery.parse({});
    expect(f.sort).toBeUndefined();
    expect(f.dir).toBeUndefined();
    expect(f).toMatchObject({ limit: 200, offset: 0 });
  });
});

describe("mapeo de ordenación", () => {
  const rows = [
    { id: 1, name: "beta", amountCents: 500, status: "active", reference: null },
    { id: 2, name: "Álvaro", amountCents: null, status: "draft", reference: "CT-2" },
    { id: 3, name: "alfa", amountCents: 500, status: "cancelled", reference: "CT-1" },
    { id: 4, name: "Beta", amountCents: 100, status: "signed", reference: "" },
  ];

  it("sin sort (o con una clave ajena) devuelve null y applySort conserva el orden", () => {
    expect(sortComparator(LEAD_SORT, {})).toBeNull();
    expect(sortComparator(LEAD_SORT, { sort: "constructor" })).toBeNull();
    expect(sortComparator(LEAD_SORT, { sort: "__proto__" })).toBeNull();
    expect(applySort(rows, LEAD_SORT, { dir: "desc" })).toBe(rows);
  });

  it("texto sin distinguir mayúsculas ni acentos, con desempate por id en la misma dirección", () => {
    expect(applySort(rows, LEAD_SORT, { sort: "name" }).map((r) => r.id)).toEqual([3, 2, 1, 4]);
    expect(applySort(rows, LEAD_SORT, { sort: "name", dir: "desc" }).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });

  it("`amount` se mapea a amountCents y los nulos van al final en ambas direcciones", () => {
    expect(applySort(rows, CONTRACT_SORT, { sort: "amount" }).map((r) => r.id)).toEqual([4, 1, 3, 2]);
    expect(applySort(rows, CONTRACT_SORT, { sort: "amount", dir: "desc" }).map((r) => r.id)).toEqual([3, 1, 4, 2]);
    expect(applySort(rows, CONTRACT_SORT, { sort: "reference" }).map((r) => r.id)).toEqual([3, 2, 1, 4]);
  });

  it("los enumerados siguen su orden lógico, no el alfabético", () => {
    expect(applySort(rows, CONTRACT_SORT, { sort: "status" }).map((r) => r.status)).toEqual(["draft", "signed", "active", "cancelled"]);
    const leads = [
      { id: 1, priority: "urgent" },
      { id: 2, priority: "low" },
      { id: 3, priority: "high" },
      { id: 4, priority: "normal" },
    ];
    expect(applySort(leads, LEAD_SORT, { sort: "priority", dir: "desc" }).map((r) => r.priority)).toEqual(["urgent", "high", "normal", "low"]);
  });

  it("no muta el array original", () => {
    const copy = rows.map((r) => r.id);
    applySort(rows, LEAD_SORT, { sort: "name", dir: "desc" });
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("listados del servicio con sort", () => {
  let crm: CrmService;
  let now = Date.UTC(2026, 9, 1);
  beforeEach(() => {
    now = Date.UTC(2026, 9, 1);
    crm = new CrmService({ store: new MemoryCrmStore(), now: () => (now += 1000) });
  });

  it("ordena antes de paginar y el total no cambia", async () => {
    for (const n of ["Carla", "ana", "Bea", "david", "Elena"]) await crm.createLead({ name: n, email: `${n.toLowerCase()}@x.example` }, "t");
    const def = await crm.listLeads({ limit: 2 });
    expect(def.items.map((l) => l.name)).toEqual(["Elena", "david"]);
    const p1 = await crm.listLeads({ sort: "name", dir: "asc", limit: 2, offset: 0 });
    const p2 = await crm.listLeads({ sort: "name", dir: "asc", limit: 2, offset: 2 });
    const p3 = await crm.listLeads({ sort: "name", dir: "asc", limit: 2, offset: 4 });
    expect([...p1.items, ...p2.items, ...p3.items].map((l) => l.name)).toEqual(["ana", "Bea", "Carla", "david", "Elena"]);
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    const q = await crm.listLeads({ q: "a", sort: "name", dir: "desc" });
    expect(q.items.map((l) => l.name)).toEqual(["Elena", "david", "Carla", "Bea", "ana"].filter((n) => n.toLowerCase().includes("a")));
    expect(q.total).toBe(q.items.length);
  });

  it("empresas por ciudad con nulos al final; sin sort, el orden por defecto", async () => {
    await crm.createCompany({ name: "Uno", city: "Zaragoza" }, "t");
    await crm.createCompany({ name: "Dos" }, "t");
    await crm.createCompany({ name: "Tres", city: "Ávila" }, "t");
    expect((await crm.listCompanies({ sort: "city" })).items.map((c) => c.name)).toEqual(["Tres", "Uno", "Dos"]);
    expect((await crm.listCompanies({ sort: "city", dir: "desc" })).items.map((c) => c.name)).toEqual(["Uno", "Tres", "Dos"]);
    expect((await crm.listCompanies({})).items.map((c) => c.name)).toEqual(["Tres", "Dos", "Uno"]);
  });
});

describe("tickets: sort y dir", () => {
  it("valida la lista blanca y la dirección", () => {
    expect(ticketsListQuery.parse({ sort: "priority", dir: "asc" })).toMatchObject({ sort: "priority", dir: "asc" });
    expect(() => ticketsListQuery.parse({ sort: "title" })).toThrow();
    expect(() => ticketsListQuery.parse({ sort: "updated_at" })).toThrow();
    expect(() => ticketsListQuery.parse({ dir: "up" })).toThrow();
  });

  it("ORDER BY fijo por clave, con desempate por id y el orden de siempre por defecto", () => {
    expect(ticketOrderBy({})).toBe("updated_at DESC, id DESC");
    expect(ticketOrderBy({ dir: "asc" })).toBe("updated_at DESC, id DESC");
    expect(ticketOrderBy({ sort: "createdAt", dir: "asc" })).toBe("created_at ASC, id ASC");
    expect(ticketOrderBy({ sort: "updatedAt" })).toBe("updated_at DESC, id DESC");
    expect(ticketOrderBy({ sort: "priority", dir: "desc" })).toBe("FIELD(priority, 'low', 'normal', 'high', 'urgent') DESC, id DESC");
    expect(ticketOrderBy({ sort: "status", dir: "asc" })).toBe("FIELD(status, 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed') ASC, id ASC");
    expect(ticketOrderBy({ sort: "x; DROP TABLE support_tickets" as never })).toBe("updated_at DESC, id DESC");
  });

  it("el almacén en memoria ordena igual y mantiene total y paginación", async () => {
    const store = new MemoryTicketStore();
    const base: Omit<Ticket, "id" | "priority" | "status" | "createdAt" | "updatedAt"> = {
      tenantId: "t1", title: "t", description: "d", category: "c", requester: null, assignee: null, createdBy: "a", resolvedAt: null,
    };
    await store.insert({ ...base, priority: "high", status: "open", createdAt: 1, updatedAt: 30 });
    await store.insert({ ...base, priority: "low", status: "closed", createdAt: 2, updatedAt: 10 });
    await store.insert({ ...base, priority: "urgent", status: "in_progress", createdAt: 3, updatedAt: 20 });
    await store.insert({ ...base, priority: "high", status: "resolved", createdAt: 4, updatedAt: 40 });
    expect((await store.list({})).items.map((t) => t.id)).toEqual([4, 1, 3, 2]);
    expect((await store.list({ sort: "priority", dir: "desc" })).items.map((t) => t.id)).toEqual([3, 4, 1, 2]);
    expect((await store.list({ sort: "status", dir: "asc" })).items.map((t) => t.id)).toEqual([1, 3, 4, 2]);
    const p = await store.list({ sort: "createdAt", dir: "asc", limit: 2, offset: 2 });
    expect(p.items.map((t) => t.id)).toEqual([3, 4]);
    expect(p.total).toBe(4);
    expect(ticketComparator({ sort: "createdAt" })({ id: 1, createdAt: 5 } as Ticket, { id: 2, createdAt: 5 } as Ticket)).toBeGreaterThan(0);
  });
});
