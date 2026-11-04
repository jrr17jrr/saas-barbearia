// Cria um Postgres em memória (PGlite) com stub do Supabase + schema legado + migrations.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const migrationsDir = join(root, 'supabase', 'migrations');

export function migrationFiles() {
  return readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
}

export async function createDb({ applyTwice = false, afterFile = null } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(readFileSync(join(root, 'tests', 'sql', 'supabase_stub.sql'), 'utf8'));
  await db.exec(readFileSync(join(root, 'tests', 'sql', 'baseline_existing.sql'), 'utf8'));
  const runs = applyTwice ? 2 : 1;
  for (let i = 0; i < runs; i++) {
    for (const f of migrationFiles()) {
      try {
        await db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
        if (afterFile && i === 0) await afterFile(f, db);
      } catch (e) {
        e.message = `[${f} run ${i + 1}] ${e.message}`;
        throw e;
      }
    }
  }
  return db;
}

// Executa fn como um papel do PostgREST (anon/authenticated) dentro de uma transação.
export async function as(db, { role = 'anon', uid = null, headers = null } = {}, fn) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role }) : '']);
    await tx.query(`select set_config('request.headers', $1, true)`, [headers ? JSON.stringify(headers) : '']);
    return fn(tx);
  });
}

export async function createUser(db, email, { confirmed = true } = {}) {
  const r = await db.query(
    `insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id`,
    [email, confirmed ? new Date().toISOString() : null]);
  return r.rows[0].id;
}

export async function expectError(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !String(e.message).match(pattern)) {
      throw new Error(`Erro inesperado: ${e.message} (esperado ${pattern})`);
    }
    return e;
  }
  throw new Error(`Era esperado erro ${pattern || ''}, mas a operação foi bem-sucedida`);
}
