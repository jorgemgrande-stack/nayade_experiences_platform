// scripts/cleanup-tpv-duplicates-v2.cjs
//
// Limpia duplicados de card_terminal_operations causados por la fórmula vieja
// de duplicate_key (commerce|terminal|op|amount|datetime_HH:MM). Reemplaza el
// trabajo previsto en drizzle/0099_fix_tpv_operations_duplicates.sql, que tenía
// dos bugs: nombre de columna en camelCase y heurística de ganador inválida
// para fechas almacenadas en UTC.
//
// Heurística de ganador (por grupo de mismo operation_number):
//   1. Candidatos: duplicate_key NO termina en 'T00:00' (i.e., trae hora real).
//   2. Si hay candidatos, ganador = id más bajo entre ellos.
//   3. Si no hay candidatos (todas con T00:00), ganador = id más bajo absoluto.
//
// Batch_operations referencias:
//   - Si batch X ya tiene una batch_op apuntando al ganador, las que apunten
//     a perdedores se BORRAN (evita inflar importes del batch).
//   - Si no, se REASIGNAN del perdedor al ganador.
//
// Luego: DELETE perdedores y UPDATE duplicate_key de TODAS las filas con
// la fórmula nueva: UPPER(terminal_code) | UPPER(operation_number).
//
// Run with: railway run --service MySQL node scripts/cleanup-tpv-duplicates-v2.cjs

const mysql = require("mysql2/promise");
const readline = require("readline");

const [DB_URL, DB_VAR_USED] =
  process.env.MYSQL_PUBLIC_URL ? [process.env.MYSQL_PUBLIC_URL, "MYSQL_PUBLIC_URL"] :
  process.env.DATABASE_URL     ? [process.env.DATABASE_URL,     "DATABASE_URL"]     :
  process.env.MYSQL_URL        ? [process.env.MYSQL_URL,        "MYSQL_URL"]        :
  [null, null];

if (!DB_URL) {
  console.error("ABORTADO: no se encontró MYSQL_PUBLIC_URL, DATABASE_URL ni MYSQL_URL.");
  process.exit(1);
}

function hr() { console.log("=".repeat(70)); }

(async () => {
  hr();
  console.log("LIMPIEZA DUPLICADOS card_terminal_operations (v2)");
  console.log(`Conectando vía: ${DB_VAR_USED}`);
  hr();

  const conn = await mysql.createConnection({ uri: DB_URL });

  // 1. Detectar grupos duplicados
  const [groups] = await conn.query(
    `SELECT operation_number, COUNT(*) AS c
     FROM card_terminal_operations
     GROUP BY operation_number
     HAVING COUNT(*) > 1
     ORDER BY operation_number`
  );

  if (groups.length === 0) {
    console.log("\nNo hay grupos duplicados. Nada que hacer.");
    await conn.end();
    return;
  }

  console.log(`\nGrupos duplicados detectados: ${groups.length}`);
  console.table(groups);

  // 2. Calcular plan: ganador y perdedores por grupo
  const plan = [];
  for (const g of groups) {
    const [rows] = await conn.query(
      `SELECT id, duplicate_key, operation_datetime, status
       FROM card_terminal_operations
       WHERE operation_number = ?
       ORDER BY id`,
      [g.operation_number]
    );

    const candidates = rows.filter((r) => !String(r.duplicate_key).endsWith("T00:00"));
    const winner = candidates.length > 0 ? candidates[0] : rows[0];
    const losers = rows.filter((r) => r.id !== winner.id);

    plan.push({
      operation_number: g.operation_number,
      winner_id: winner.id,
      winner_key: winner.duplicate_key,
      loser_ids: losers.map((r) => r.id).join(","),
      loser_keys: losers.map((r) => r.duplicate_key).join(" || "),
    });
  }

  console.log("\nPLAN POR GRUPO (ganador / perdedores):");
  console.table(plan);

  const allLoserIds = plan.flatMap((p) => p.loser_ids.split(",").map(Number));
  const winnerByOp = Object.fromEntries(plan.map((p) => [p.operation_number, p.winner_id]));

  // 3. Detectar batch_ops afectadas y decidir REASSIGN vs DELETE
  const [loserBatchOps] = await conn.query(
    `SELECT bo.id AS batch_op_id, bo.batch_id, bo.card_terminal_operation_id AS op_id,
            o.operation_number, bo.amount, bo.operation_type
     FROM card_terminal_batch_operations bo
     JOIN card_terminal_operations o ON o.id = bo.card_terminal_operation_id
     WHERE bo.card_terminal_operation_id IN (?)
     ORDER BY bo.batch_id, bo.id`,
    [allLoserIds]
  );

  const batchActions = [];
  for (const bo of loserBatchOps) {
    const winnerId = winnerByOp[bo.operation_number];
    const [existing] = await conn.query(
      `SELECT id FROM card_terminal_batch_operations
       WHERE batch_id = ? AND card_terminal_operation_id = ? AND id <> ?`,
      [bo.batch_id, winnerId, bo.batch_op_id]
    );
    if (existing.length > 0) {
      batchActions.push({
        batch_op_id: bo.batch_op_id,
        batch_id: bo.batch_id,
        action: "DELETE",
        op_id_from: bo.op_id,
        reason: `batch ${bo.batch_id} ya apunta al ganador ${winnerId} via batch_op ${existing[0].id}`,
      });
    } else {
      batchActions.push({
        batch_op_id: bo.batch_op_id,
        batch_id: bo.batch_id,
        action: "REASSIGN",
        op_id_from: bo.op_id,
        op_id_to: winnerId,
        reason: "única referencia del perdedor en ese batch",
      });
    }
  }

  console.log(`\nACCIONES SOBRE batch_operations (${batchActions.length}):`);
  console.table(batchActions);

  // 4. Confirmación interactiva
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      `\n¿Ejecutar el plan en transacción? (escribir 'SI' para continuar): `,
      (ans) => { rl.close(); resolve(ans.trim()); }
    );
  });

  if (answer !== "SI") {
    console.log("\nOperación cancelada — no se ha modificado nada.");
    await conn.end();
    return;
  }

  // 5. Transacción
  console.log("\n[TX] Iniciando transacción...");
  await conn.beginTransaction();
  try {
    // 5a. Procesar batch_ops (DELETE o REASSIGN)
    for (const a of batchActions) {
      if (a.action === "DELETE") {
        const [r] = await conn.execute(
          `DELETE FROM card_terminal_batch_operations WHERE id = ?`,
          [a.batch_op_id]
        );
        if (r.affectedRows !== 1) {
          throw new Error(`DELETE batch_op ${a.batch_op_id} afectó ${r.affectedRows} filas`);
        }
      } else {
        const [r] = await conn.execute(
          `UPDATE card_terminal_batch_operations
           SET card_terminal_operation_id = ?
           WHERE id = ? AND card_terminal_operation_id = ?`,
          [a.op_id_to, a.batch_op_id, a.op_id_from]
        );
        if (r.affectedRows !== 1) {
          throw new Error(`UPDATE batch_op ${a.batch_op_id} afectó ${r.affectedRows} filas`);
        }
      }
    }
    console.log(`  ✓ batch_operations procesadas (${batchActions.length})`);

    // 5b. Borrar perdedores
    if (allLoserIds.length > 0) {
      const idList = allLoserIds.map(Number).join(",");
      const [r] = await conn.query(
        `DELETE FROM card_terminal_operations WHERE id IN (${idList})`
      );
      if (r.affectedRows !== allLoserIds.length) {
        throw new Error(`DELETE perdedores afectó ${r.affectedRows}, esperado ${allLoserIds.length}`);
      }
      console.log(`  ✓ Perdedores borrados (${r.affectedRows})`);
    }

    // 5c. Recalcular duplicate_key de TODAS las filas con la fórmula nueva
    const [r3] = await conn.execute(
      `UPDATE card_terminal_operations
       SET duplicate_key = CONCAT(UPPER(COALESCE(terminal_code, '')), '|', UPPER(operation_number))`
    );
    console.log(`  ✓ duplicate_key recalculado (${r3.affectedRows} filas)`);

    await conn.commit();
    console.log("\n✓ COMMIT.");
  } catch (e) {
    await conn.rollback();
    console.error("\n✗ Error — ROLLBACK ejecutado:", e.message);
    await conn.end();
    process.exit(1);
  }

  // 6. Verificación post
  console.log("\n[POST] Verificando estado final...");
  const [remaining] = await conn.query(
    `SELECT operation_number, COUNT(*) AS c
     FROM card_terminal_operations
     GROUP BY operation_number
     HAVING COUNT(*) > 1`
  );
  if (remaining.length === 0) {
    console.log("  ✓ Ya no hay grupos duplicados");
  } else {
    console.error("  ✗ Aún quedan grupos duplicados:");
    console.table(remaining);
  }

  const [sample] = await conn.query(
    `SELECT id, operation_number, duplicate_key FROM card_terminal_operations LIMIT 5`
  );
  console.log("\nMuestra de duplicate_key recalculados:");
  console.table(sample);

  await conn.end();
  hr();
  console.log("FIN DE LA LIMPIEZA");
  hr();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
