// Cria a tabela no banco indicado por DATABASE_URL. Uso: npm run db:init
import { readFileSync } from 'node:fs';
import { createDb } from './db.js';

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL no arquivo .env (veja o .env.example).');
  process.exit(1);
}

const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const db = createDb();

try {
  await db.query(sql);
  console.log('Tabela "tasks" pronta no banco.');
} catch (err) {
  console.error('Falha ao criar a tabela:', err.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
