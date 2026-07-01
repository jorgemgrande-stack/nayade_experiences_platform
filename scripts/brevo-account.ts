// Imprime el estado de la cuenta Brevo: plan, créditos restantes, sender.
// Útil para diagnosticar fallos silenciosos de entrega.
import "dotenv/config";

async function main() {
  const k = process.env.BREVO_API_KEY;
  if (!k) { console.error("Falta BREVO_API_KEY"); process.exit(1); }
  const res = await fetch("https://api.brevo.com/v3/account", {
    headers: { accept: "application/json", "api-key": k },
  });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  const d = await res.json() as Record<string, any>;
  console.log("Cuenta:", d.email, "—", d.firstName, d.lastName);
  console.log("Organization ID:", d.organization_id);
  console.log("Enterprise:", d.enterprise);
  console.log("\nPlanes:");
  for (const p of (d.plan ?? [])) {
    console.log(`  ${p.type.padEnd(20)} credits=${p.credits ?? "—"} (${p.creditsType ?? "—"}) startDate=${p.startDate ?? "—"} endDate=${p.endDate ?? "—"}`);
  }
  console.log("\nMarketing automation:", JSON.stringify(d.marketingAutomation ?? null));
  console.log("Relay SMTP:", JSON.stringify(d.relay ?? null));
}
main().catch(e => { console.error("ERR", e); process.exit(1); });
