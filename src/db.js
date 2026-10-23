import pg from 'pg';

// Cria o "pool" de conexões com o PostgreSQL (no nosso caso, o do Supabase).
// Um pool reaproveita conexões abertas em vez de abrir uma nova a cada requisição.
// A URL de conexão fica em DATABASE_URL (arquivo .env) e contém a senha do banco.
export function createDb(connectionString = process.env.DATABASE_URL) {
  const pool = new pg.Pool({
    connectionString,
    // O Supabase exige conexão criptografada (SSL). Use DATABASE_SSL=false apenas
    // se for apontar para um Postgres local, sem SSL.
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
  });

  // Sem este listener, um erro em conexão ociosa derrubaria o processo.
  pool.on('error', (err) => console.error('Erro inesperado no pool do banco:', err.message));

  return pool;
}
