import { Router } from 'express';

// Rotas de tarefas. Todas já passam pelo middleware "authenticate" (src/app.js),
// então aqui sempre existe req.user = { id, username, roles }.
//
// Os handlers são "async" porque as consultas ao banco são assíncronas (await).
// No Express 5, se um handler async lançar erro, ele é encaminhado automaticamente
// para o tratador de erros do app.js (responde 500 em JSON).
export function createTasksRouter(db, { requireRole }) {
  const router = Router();

  const isManager = (user) => user.roles.includes('gerente');

  // Devolve a tarefa ou undefined. Ids inválidos ou fora do intervalo do tipo
  // INTEGER do Postgres também viram undefined (evita erro 500 no banco).
  async function findTask(idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return undefined;

    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    return rows[0];
  }

  // Quem não é gerente nem funcionário (ex.: usuário sem perfil) não entra.
  router.use(requireRole('gerente', 'funcionario'));

  // GET /tasks
  // gerente: todas (filtro opcional ?assigned_to=usuario) | funcionário: só as suas
  router.get('/', async (req, res) => {
    let result;

    if (isManager(req.user)) {
      const { assigned_to } = req.query;

      if (assigned_to !== undefined && typeof assigned_to !== 'string') {
        return res.status(400).json({ error: '"assigned_to" deve ser um único valor.' });
      }

      result = assigned_to
        ? await db.query('SELECT * FROM tasks WHERE assigned_to = $1 ORDER BY id', [assigned_to])
        : await db.query('SELECT * FROM tasks ORDER BY id');
    } else {
      result = await db.query(
        'SELECT * FROM tasks WHERE assigned_to = $1 ORDER BY id',
        [req.user.username]
      );
    }

    res.json(result.rows);
  });

  // GET /tasks/:id
  router.get('/:id', async (req, res) => {
    const task = await findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

    if (!isManager(req.user) && task.assigned_to !== req.user.username) {
      return res.status(403).json({ error: 'Você só pode ver as suas próprias tarefas.' });
    }

    res.json(task);
  });

  // POST /tasks  (somente gerente)
  router.post('/', requireRole('gerente'), async (req, res) => {
    const { title, description = null, assigned_to } = req.body ?? {};

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: '"title" é obrigatório (texto).' });
    }
    if (typeof assigned_to !== 'string' || !assigned_to.trim()) {
      return res.status(400).json({ error: '"assigned_to" é obrigatório (username do funcionário).' });
    }
    if (description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: '"description" deve ser texto.' });
    }

    // $1, $2... são parâmetros: o driver envia os valores separados do SQL,
    // o que impede SQL Injection. Nunca monte SQL concatenando texto do usuário.
    // RETURNING * devolve a linha criada (com id e created_at gerados pelo banco).
    const { rows } = await db.query(
      `INSERT INTO tasks (title, description, assigned_to, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title.trim(), description, assigned_to.trim(), req.user.username]
    );

    res.status(201).json(rows[0]);
  });

  // PATCH /tasks/:id/completed  (somente o funcionário dono da tarefa)
  router.patch('/:id/completed', requireRole('funcionario'), async (req, res) => {
    const task = await findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

    if (task.assigned_to !== req.user.username) {
      return res.status(403).json({ error: 'Você só pode alterar as suas próprias tarefas.' });
    }

    const { completed } = req.body ?? {};
    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: '"completed" deve ser true ou false.' });
    }

    const { rows } = await db.query(
      'UPDATE tasks SET completed = $1 WHERE id = $2 RETURNING *',
      [completed, task.id]
    );

    res.json(rows[0]);
  });

  // DELETE /tasks/:id  (somente gerente)
  router.delete('/:id', requireRole('gerente'), async (req, res) => {
    const task = await findTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

    await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
    res.status(204).end();
  });

  return router;
}
