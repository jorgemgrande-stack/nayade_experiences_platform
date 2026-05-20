// Fase 9 — Verificación de integridad de datos del módulo Personal/RRHH.
// Solo lectura. Detecta filas huérfanas e inconsistencias.

const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection(process.env.MYSQL_PUBLIC_URL);
  let issues = 0;
  const check = async (label, sql) => {
    const [[r]] = await c.query(sql);
    const n = Number(r.n);
    if (n > 0) { issues++; console.log(`  ✗ ${label}: ${n}`); }
    else console.log(`  ✓ ${label}`);
  };

  console.log("=== INTEGRIDAD MÓDULO PERSONAL / RRHH ===\n");

  console.log("[1] Referencias a empleados (monitors):");
  await check("hr_time_clock con employee_id inexistente",
    "SELECT COUNT(*) n FROM hr_time_clock t LEFT JOIN monitors m ON m.id=t.employee_id WHERE m.id IS NULL");
  await check("hr_payslips con employee_id inexistente",
    "SELECT COUNT(*) n FROM hr_payslips p LEFT JOIN monitors m ON m.id=p.employee_id WHERE m.id IS NULL");
  await check("hr_bonus con employee_id inexistente",
    "SELECT COUNT(*) n FROM hr_bonus b LEFT JOIN monitors m ON m.id=b.employee_id WHERE m.id IS NULL");
  await check("hr_leave_requests con employee_id inexistente",
    "SELECT COUNT(*) n FROM hr_leave_requests l LEFT JOIN monitors m ON m.id=l.employee_id WHERE m.id IS NULL");
  await check("hr_leave_balance con employee_id inexistente",
    "SELECT COUNT(*) n FROM hr_leave_balance b LEFT JOIN monitors m ON m.id=b.employee_id WHERE m.id IS NULL");

  console.log("\n[2] Vínculos con remesas / gastos:");
  await check("hr_payslips con batch_id inexistente",
    "SELECT COUNT(*) n FROM hr_payslips p LEFT JOIN hr_payroll_batches b ON b.id=p.batch_id WHERE p.batch_id IS NOT NULL AND b.id IS NULL");
  await check("hr_bonus pagado con expense_id inexistente",
    "SELECT COUNT(*) n FROM hr_bonus b LEFT JOIN expenses e ON e.id=b.expense_id WHERE b.expense_id IS NOT NULL AND e.id IS NULL");

  console.log("\n[3] Portal del empleado (users):");
  await check("monitors.user_id apuntando a user inexistente",
    "SELECT COUNT(*) n FROM monitors m LEFT JOIN users u ON u.id=m.user_id WHERE m.user_id IS NOT NULL AND u.id IS NULL");
  await check("users role=employee sin monitor vinculado",
    "SELECT COUNT(*) n FROM users u LEFT JOIN monitors m ON m.user_id=u.id WHERE u.role='employee' AND m.id IS NULL");

  console.log("\n[4] Coherencia de estados:");
  await check("hr_payslips status registrada/pagada con net negativo",
    "SELECT COUNT(*) n FROM hr_payslips WHERE status IN ('registrada','pagada') AND net_salary < 0");
  await check("hr_leave_requests aprobada sin approved_by",
    "SELECT COUNT(*) n FROM hr_leave_requests WHERE status='aprobada' AND approved_by IS NULL");
  await check("hr_bonus pagado sin payment_method",
    "SELECT COUNT(*) n FROM hr_bonus WHERE status='pagado' AND payment_method IS NULL");
  await check("hr_time_clock cerrado con salida anterior a entrada",
    "SELECT COUNT(*) n FROM hr_time_clock WHERE clock_out_at IS NOT NULL AND clock_out_at < clock_in_at");

  console.log("\n[5] Conteo de filas por tabla:");
  for (const t of ["monitors", "hr_time_clock", "hr_payslips", "hr_payroll_batches",
    "hr_bonus", "hr_leave_requests", "hr_leave_balance", "hr_irpf_ledger", "hr_ss_ledger"]) {
    const [[r]] = await c.query(`SELECT COUNT(*) n FROM \`${t}\``);
    console.log(`  ${t}: ${r.n}`);
  }

  await c.end();
  console.log(`\n=== RESULTADO: ${issues === 0 ? "✓ SIN INCIDENCIAS" : `✗ ${issues} INCIDENCIA(S)`} ===`);
  if (issues > 0) process.exit(1);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
