import express from 'express';
import { createAuth } from './auth.js';
import { createTasksRouter } from './tasks.js';

// Monta a aplicação recebendo o banco e o issuer como parâmetros.
// Separar "montar o app" de "iniciar o servidor" (server.js) facilita os testes.
export function createApp({ db, issuer }) {
  const app = express();
  const auth = createAuth({ issuer });

  app.use(express.json());

  // Rota pública: serve para conferir se a API está no ar.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Mostra quem a API "enxerga" a partir do token (ótimo para depurar roles).
  app.get('/me', auth.authenticate, (req, res) => res.json(req.user));

  // Tudo em /tasks exige token válido.
  app.use('/tasks', auth.authenticate, createTasksRouter(db, auth));

  // Rota inexistente
  app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // Tratamento de erros: sempre responde JSON (nunca HTML com stack trace).
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  return app;
}
