import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { PGlite } from '@electric-sql/pglite';

// Estes testes NÃO precisam do Keycloak real. Fazemos assim:
//  1. geramos um par de chaves RSA aqui no teste;
//  2. subimos um "Keycloak de mentira" que só publica a chave pública (JWKS),
//     no mesmo caminho do Keycloak de verdade;
//  3. assinamos tokens com a chave privada, simulando gerente/funcionário.
// Assim testamos de verdade a validação do token e as regras de permissão.

let privateKey;
let issuer;
let baseUrl;
let fakeKeycloak;
let db;
let apiServer;

// Cria um token JWT assinado. "overrides" permite forjar tokens inválidos.
async function makeToken(username, roles, overrides = {}) {
  return new SignJWT({ preferred_username: username, realm_access: { roles } })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(`id-${username}`)
    .setIssuer(overrides.issuer ?? issuer)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(overrides.key ?? privateKey);
}

// Faz uma requisição à API. Se "token" for informado, envia o Bearer.
async function api(method, path, { token, body, rawBody } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || rawBody !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Atalho: gerente cria uma tarefa para um funcionário e devolve a tarefa criada.
async function createTask(managerToken, assigned_to, title = 'Tarefa de teste') {
  const res = await api('POST', '/tasks', { token: managerToken, body: { title, assigned_to } });
  assert.equal(res.status, 201);
  return res.body;
}

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;

  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  fakeKeycloak = http.createServer((req, res) => {
    if (req.url === '/realms/empresa/protocol/openid-connect/certs') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => fakeKeycloak.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${fakeKeycloak.address().port}/realms/empresa`;

  // Postgres de verdade, mas em memória (PGlite): sem internet e sem tocar no Supabase.
  // Usa o MESMO sql/schema.sql do projeto; cada execução começa com o banco vazio.
  db = new PGlite();
  await db.exec(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
  const app = createApp({ db, issuer });
  apiServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

after(async () => {
  for (const server of [apiServer, fakeKeycloak]) {
    server.close();
    server.closeAllConnections();
  }
  await db.close();
});

// ---------- Autenticação ----------

test('GET /health é público', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('sem token => 401', async () => {
  const res = await api('GET', '/tasks');
  assert.equal(res.status, 401);
});

test('token assinado com outra chave => 401', async () => {
  const other = await generateKeyPair('RS256');
  const token = await makeToken('gerente1', ['gerente'], { key: other.privateKey });
  const res = await api('GET', '/tasks', { token });
  assert.equal(res.status, 401);
});

test('token expirado => 401', async () => {
  const expired = Math.floor(Date.now() / 1000) - 60;
  const token = await makeToken('gerente1', ['gerente'], { exp: expired });
  const res = await api('GET', '/tasks', { token });
  assert.equal(res.status, 401);
});

test('token de outro issuer => 401', async () => {
  const token = await makeToken('gerente1', ['gerente'], { issuer: 'http://outro-lugar/realms/x' });
  const res = await api('GET', '/tasks', { token });
  assert.equal(res.status, 401);
});

test('usuário autenticado mas sem perfil => 403', async () => {
  const token = await makeToken('visitante', ['offline_access']);
  const res = await api('GET', '/tasks', { token });
  assert.equal(res.status, 403);
});

test('GET /me devolve a identidade extraída do token', async () => {
  const token = await makeToken('gerente1', ['gerente', 'offline_access']);
  const res = await api('GET', '/me', { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'gerente1');
  assert.ok(res.body.roles.includes('gerente'));
});

// ---------- Criar tarefas ----------

test('gerente cria tarefa => 201, completed=false e created_by preenchido', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const res = await api('POST', '/tasks', {
    token: manager,
    body: { title: 'Enviar relatório', description: 'Relatório mensal', assigned_to: 'ana' },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Enviar relatório');
  assert.equal(res.body.assigned_to, 'ana');
  assert.equal(res.body.created_by, 'gerente1');
  assert.equal(res.body.completed, false);
  assert.ok(Number.isInteger(res.body.id));
});

test('funcionário não pode criar tarefa => 403', async () => {
  const employee = await makeToken('ana', ['funcionario']);
  const res = await api('POST', '/tasks', {
    token: employee,
    body: { title: 'x', assigned_to: 'ana' },
  });
  assert.equal(res.status, 403);
});

test('criar tarefa sem title ou sem assigned_to => 400', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const semTitle = await api('POST', '/tasks', { token: manager, body: { assigned_to: 'ana' } });
  const semDono = await api('POST', '/tasks', { token: manager, body: { title: 'x' } });
  assert.equal(semTitle.status, 400);
  assert.equal(semDono.status, 400);
});

test('JSON inválido no corpo => 400', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const res = await api('POST', '/tasks', { token: manager, rawBody: '{ title: sem aspas' });
  assert.equal(res.status, 400);
});

// ---------- Listar e consultar ----------

test('funcionário lista só as suas tarefas; gerente lista todas', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  await createTask(manager, 'lista-ana', 'Tarefa da Ana');
  await createTask(manager, 'lista-bruno', 'Tarefa do Bruno');

  const ana = await makeToken('lista-ana', ['funcionario']);
  const doAna = await api('GET', '/tasks', { token: ana });
  assert.equal(doAna.status, 200);
  assert.ok(doAna.body.length >= 1);
  assert.ok(doAna.body.every((t) => t.assigned_to === 'lista-ana'));

  const todas = await api('GET', '/tasks', { token: manager });
  const donos = new Set(todas.body.map((t) => t.assigned_to));
  assert.ok(donos.has('lista-ana') && donos.has('lista-bruno'));

  const filtradas = await api('GET', '/tasks?assigned_to=lista-bruno', { token: manager });
  assert.ok(filtradas.body.every((t) => t.assigned_to === 'lista-bruno'));
});

test('filtro assigned_to repetido na URL => 400', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const res = await api('GET', '/tasks?assigned_to=a&assigned_to=b', { token: manager });
  assert.equal(res.status, 400);
});

test('funcionário não vê tarefa de outro => 403; id inexistente => 404', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'dona-da-tarefa');

  const intruso = await makeToken('intruso', ['funcionario']);
  const proibido = await api('GET', `/tasks/${task.id}`, { token: intruso });
  assert.equal(proibido.status, 403);

  const dona = await makeToken('dona-da-tarefa', ['funcionario']);
  const ok = await api('GET', `/tasks/${task.id}`, { token: dona });
  assert.equal(ok.status, 200);

  const naoExiste = await api('GET', '/tasks/999999', { token: manager });
  assert.equal(naoExiste.status, 404);
  const idInvalido = await api('GET', '/tasks/abc', { token: manager });
  assert.equal(idInvalido.status, 404);
  // maior que o INTEGER do Postgres: deve ser 404, e não erro 500 do banco
  const idGigante = await api('GET', '/tasks/99999999999', { token: manager });
  assert.equal(idGigante.status, 404);
});

// ---------- Marcar como concluída (true/false) ----------

test('funcionário marca a própria tarefa como true e depois false', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'marca-tarefa');
  const employee = await makeToken('marca-tarefa', ['funcionario']);
  const url = `/tasks/${task.id}/completed`;

  const concluir = await api('PATCH', url, { token: employee, body: { completed: true } });
  assert.equal(concluir.status, 200);
  assert.equal(concluir.body.completed, true);

  // confirma que foi gravado no banco
  const lida = await api('GET', `/tasks/${task.id}`, { token: employee });
  assert.equal(lida.body.completed, true);

  const reabrir = await api('PATCH', url, { token: employee, body: { completed: false } });
  assert.equal(reabrir.body.completed, false);
});

test('funcionário não altera tarefa de outro => 403', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'dono-real');
  const intruso = await makeToken('outro-funcionario', ['funcionario']);

  const res = await api('PATCH', `/tasks/${task.id}/completed`, {
    token: intruso,
    body: { completed: true },
  });
  assert.equal(res.status, 403);
});

test('gerente não marca tarefa como concluída => 403', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'qualquer');

  const res = await api('PATCH', `/tasks/${task.id}/completed`, {
    token: manager,
    body: { completed: true },
  });
  assert.equal(res.status, 403);
});

test('completed precisa ser boolean => 400', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'valida-boolean');
  const employee = await makeToken('valida-boolean', ['funcionario']);

  const res = await api('PATCH', `/tasks/${task.id}/completed`, {
    token: employee,
    body: { completed: 'sim' },
  });
  assert.equal(res.status, 400);
});

// ---------- Excluir ----------

test('gerente exclui tarefa => 204 e depois 404; funcionário não exclui => 403', async () => {
  const manager = await makeToken('gerente1', ['gerente']);
  const task = await createTask(manager, 'exclui-tarefa');
  const employee = await makeToken('exclui-tarefa', ['funcionario']);

  const proibido = await api('DELETE', `/tasks/${task.id}`, { token: employee });
  assert.equal(proibido.status, 403);

  const apagou = await api('DELETE', `/tasks/${task.id}`, { token: manager });
  assert.equal(apagou.status, 204);

  const depois = await api('GET', `/tasks/${task.id}`, { token: manager });
  assert.equal(depois.status, 404);
});
