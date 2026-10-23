import { createApp } from './app.js';
import { createDb } from './db.js';

const issuer = process.env.KEYCLOAK_ISSUER?.replace(/\/+$/, '');
const port = process.env.PORT || 3000;

if (!issuer) {
  console.error('Defina KEYCLOAK_ISSUER no arquivo .env (veja o .env.example).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL no arquivo .env (veja o .env.example).');
  process.exit(1);
}

const db = createDb();

// Falha cedo: se a URL/senha do banco estiverem erradas, o erro aparece agora,
// e não só na primeira requisição.
try {
  await db.query('SELECT 1');
} catch (err) {
  console.error('Não foi possível conectar ao banco:', err.message);
  process.exit(1);
}

createApp({ db, issuer }).listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
  console.log(`Validando tokens do issuer: ${issuer}`);
});
