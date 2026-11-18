import type { PGlite } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import type {
  AuditEvent,
  Budget,
  Contact,
  Material,
  Supplier,
  Worksite,
} from "../../shared/src/index.js";

export const DEMO_TENANTS = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Horizonte Construções (demonstração)",
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Empresa B (teste de isolamento)",
  },
];
const catalog = [
  ["Cimento CP II 50 kg", "saco 50 kg", "Cimentos", "1000", "30.00"],
  ["Areia média", "m³", "Agregados", "120", "145.00"],
  ["Brita 1", "m³", "Agregados", "80", "180.00"],
  ["Vergalhão CA-50 10 mm 6 m", "barra 6 m", "Ferragens", "500", "42.00"],
  ["Bloco cerâmico 14 x 19 x 29 cm", "un", "Alvenaria", "10000", "3.20"],
  ["Argamassa AC II 20 kg", "saco 20 kg", "Argamassas", "300", "25.00"],
  ["Tubo PVC 25 mm 6 m", "barra 6 m", "Hidráulica", "120", "28.50"],
  ["Fio de cobre 2,5 mm²", "m", "Elétrica", "2000", "2.80"],
  ["Tinta acrílica branca 18 L", "lata 18 L", "Pintura", "40", "280.00"],
  ["Porcelanato 60 x 60 cm", "m²", "Revestimentos", "600", "69.90"],
] as const;

export async function seedDatabase(db: PGlite): Promise<void> {
  await db.transaction(async (tx) => {
    for (let index = 0; index < DEMO_TENANTS.length; index++) {
      const tenant = DEMO_TENANTS[index];
      const exists = await tx.query("SELECT id FROM tenants WHERE id=$1", [
        tenant.id,
      ]);
      if (exists.rows.length) continue;
      await tx.query("INSERT INTO tenants(id,name) VALUES ($1,$2)", [
        tenant.id,
        tenant.name,
      ]);
      const prefix = index === 0 ? "1" : "2";
      const id = (group: number, number: number) =>
        `${prefix}${String(group).padStart(7, "0")}-0000-4000-8000-${String(number).padStart(12, "0")}`;
      const worksite: Worksite = {
        id: id(1, 1),
        name: index === 0 ? "Residencial Aurora" : "Obra Jardim (empresa B)",
        address: "Rua das Acácias, 120 · endereço fictício",
        legalEntityName: "Construtora de demonstração Ltda.",
      };
      await tx.query(
        "INSERT INTO worksites(id,tenant_id,data) VALUES ($1,$2,$3)",
        [worksite.id, tenant.id, worksite],
      );
      const contacts: Contact[] = [
        {
          id: id(2, 1),
          name: "Marina · proprietária (fictício)",
          phone: `+551199000000${index + 1}`,
          role: "owner",
          worksiteIds: [worksite.id],
        },
        {
          id: id(2, 2),
          name: "João · encarregado (fictício)",
          phone: `+551199000001${index + 1}`,
          role: "site_requester",
          worksiteIds: [worksite.id],
        },
        {
          id: id(2, 3),
          name: "Ana · escritório (fictício)",
          phone: `+551199000002${index + 1}`,
          role: "operator_readonly",
          worksiteIds: [worksite.id],
        },
      ];
      for (const contact of contacts) {
        await tx.query(
          "INSERT INTO contacts(id,tenant_id,data) VALUES ($1,$2,$3)",
          [contact.id, tenant.id, contact],
        );
      }
      const materials: Material[] = catalog.map(
        ([name, unit, category], n) => ({
          id: id(3, n + 1),
          name,
          unit,
          category,
          aliases: [name.toLocaleLowerCase("pt-BR")],
        }),
      );
      for (const material of materials) {
        await tx.query(
          "INSERT INTO materials(id,tenant_id,data) VALUES ($1,$2,$3)",
          [material.id, tenant.id, material],
        );
      }
      const supplierNames = [
        "Casa Forte Materiais",
        "Depósito São Bento",
        "Construmais Atacado",
        "Hidráulica Central",
        "Acabamentos Horizonte",
      ];
      const categories = [
        ["Cimentos", "Agregados", "Alvenaria", "Argamassas"],
        ["Cimentos", "Agregados", "Ferragens", "Alvenaria"],
        ["Cimentos", "Ferragens", "Elétrica", "Argamassas"],
        ["Hidráulica", "Elétrica"],
        ["Pintura", "Revestimentos", "Argamassas"],
      ];
      for (let n = 0; n < supplierNames.length; n++) {
        const supplier: Supplier = {
          id: id(4, n + 1),
          name: supplierNames[n],
          phone: `+55119800000${index}${n + 1}`,
          categories: categories[n],
          leadDays: [2, 3, 8, 2, 5][n],
          consent: true,
          active: true,
        };
        await tx.query(
          "INSERT INTO suppliers(id,tenant_id,data) VALUES ($1,$2,$3)",
          [supplier.id, tenant.id, supplier],
        );
      }
      const now = new Date().toISOString();
      const items = catalog.map((row, n) => ({
        materialId: materials[n].id,
        quantity: row[3],
        unitPrice: row[4],
        total: new Decimal(row[3]).times(row[4]).toFixed(2),
      }));
      const budget: Budget = {
        id: id(5, 1),
        worksiteId: worksite.id,
        version: 1,
        status: "FROZEN",
        items,
        total: items
          .reduce((sum, item) => sum.plus(item.total), new Decimal(0))
          .toFixed(2),
        createdAt: now,
        frozenAt: now,
      };
      await tx.query(
        "INSERT INTO budgets(id,tenant_id,worksite_id,data) VALUES ($1,$2,$3,$4)",
        [budget.id, tenant.id, worksite.id, budget],
      );
      const audit: AuditEvent = {
        id: id(6, 1),
        action: "DEMO_SEEDED",
        entityId: worksite.id,
        actor: "Inicialização de demonstração",
        createdAt: now,
      };
      await tx.query(
        "INSERT INTO audit_events(id,tenant_id,data) VALUES ($1,$2,$3)",
        [audit.id, tenant.id, audit],
      );
    }
  });
}
