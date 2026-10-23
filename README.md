# To_do_list-empresarial

API REST em Node.js para gerenciamento de tarefas empresariais, com autenticação via OpenID Connect (Keycloak): gerentes atribuem tarefas e funcionários atualizam o status de conclusão.

O projeto foi pensado para ser **simples de ler e de testar**: poucos arquivos, SQL puro, e uma coleção do [Bruno](https://www.usebruno.com/) já pronta para exercitar todos os endpoints.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Como a autenticação funciona](#2-como-a-autenticação-funciona)
3. [Tecnologias](#3-tecnologias)
4. [Estrutura do projeto](#4-estrutura-do-projeto)
5. [Configuração passo a passo](#5-configuração-passo-a-passo)
6. [Endpoints](#6-endpoints)
7. [Modelo de dados](#7-modelo-de-dados)
8. [Testando com o Bruno](#8-testando-com-o-bruno)
9. [Testes automatizados](#9-testes-automatizados)
10. [Decisões de projeto](#10-decisões-de-projeto)
11. [Limitações e próximos passos](#11-limitações-e-próximos-passos)
12. [Problemas comuns](#12-problemas-comuns)

---

## 1. Visão geral

Existem dois perfis (*roles*):

| Perfil | O que pode fazer |
|---|---|
| `gerente` | Criar tarefas e atribuí-las a um funcionário, listar todas as tarefas (com filtro por funcionário), consultar e excluir tarefas. |
| `funcionario` | Listar e consultar **apenas as suas** tarefas e marcá-las como concluídas (`true`) ou pendentes (`false`). |

Matriz de permissões:

| Endpoint | Sem token | `gerente` | `funcionario` |
|---|---|---|---|
| `GET /health` | 200 | 200 | 200 |
| `GET /me` | 401 | 200 | 200 |
| `GET /tasks` | 401 | 200 (todas) | 200 (só as suas) |
| `GET /tasks/:id` | 401 | 200 | 200 (só se for dono) / 403 |
| `POST /tasks` | 401 | 201 | 403 |
| `PATCH /tasks/:id/completed` | 401 | 403 | 200 (só se for dono) / 403 |
| `DELETE /tasks/:id` | 401 | 204 | 403 |

Um usuário autenticado que não tenha nenhum dos dois perfis recebe `403` em `/tasks`.

## 2. Como a autenticação funciona

**OpenID Connect (OIDC)** é uma camada de identidade construída sobre o OAuth 2.0. A ideia central: a nossa API **não recebe senhas e não faz login**. Quem autentica é o Keycloak (o *provedor de identidade*). A API só **confia em tokens assinados** por ele.

```
 Bruno                      Keycloak                  API (Node)               Supabase
   |                            |                         |                        |
   |-- 1. usuário + senha ----->|                         |                        |
   |<-- 2. access_token (JWT) --|                         |                        |
   |                                                      |                        |
   |-- 3. GET /tasks  +  Authorization: Bearer <token> -->|                        |
   |                            |<-- 4. chaves públicas --|  (JWKS, ficam em cache)|
   |                            |                         |-- 5. SQL ------------->|
   |<-- 6. resposta JSON ---------------------------------|<-----------------------|
```

O que a API faz com o token (arquivo `src/auth.js`):

1. **Confere a assinatura** usando as chaves públicas do Keycloak (endpoint `.../protocol/openid-connect/certs`). Se alguém alterar o token, a assinatura deixa de bater.
2. **Confere o emissor** (`iss`): precisa ser exatamente o realm configurado em `KEYCLOAK_ISSUER`.
3. **Confere a validade** (`exp`): tokens expirados são recusados.
4. **Extrai a identidade**: `preferred_username` (nome do usuário) e `realm_access.roles` (perfis).

Respostas de erro:

- `401 Unauthorized`: não conseguimos saber **quem** você é (token ausente, inválido ou expirado).
- `403 Forbidden`: sabemos quem você é, mas você **não tem permissão** para aquilo.

## 3. Tecnologias

| Tecnologia | Para quê |
|---|---|
| Node.js (>= 20.6) | Runtime. Usamos `--env-file` (lê o `.env` sem biblioteca extra) e `node:test` (testes sem biblioteca extra). |
| Express 5 | Framework HTTP. A versão 5 encaminha erros de handlers `async` automaticamente para o tratador de erros. |
| jose | Validação do JWT e download das chaves públicas (JWKS) do Keycloak. |
| pg | Driver do PostgreSQL. Escrevemos SQL puro, o que deixa claro o que acontece no banco. |
| Supabase (PostgreSQL) | Banco de dados na nuvem. |
| Keycloak | Provedor OpenID Connect (roda local via Docker). |
| Bruno | Cliente para testar a API (coleção na pasta `bruno/`). |
| PGlite (só em desenvolvimento) | PostgreSQL em memória usado nos testes automatizados. |

## 4. Estrutura do projeto

```
.
├── src/
│   ├── server.js     # Ponto de entrada: valida .env, conecta no banco e sobe o servidor
│   ├── app.js        # Monta o Express: rotas públicas, /me, /tasks e tratamento de erros
│   ├── auth.js       # Middlewares: authenticate (valida o token) e requireRole (checa o perfil)
│   ├── tasks.js      # Rotas de tarefas e regras de negócio
│   ├── db.js         # Pool de conexões com o PostgreSQL (Supabase)
│   └── init-db.js    # Script que cria a tabela (npm run db:init)
├── sql/
│   └── schema.sql    # Definição da tabela "tasks"
├── test/
│   └── api.test.js   # Testes automatizados
├── bruno/            # Coleção do Bruno (abrir esta pasta no Bruno)
├── docker-compose.yml  # Sobe o Keycloak local
├── .env.example      # Modelo de configuração (copie para .env)
└── package.json
```

Por que `server.js` e `app.js` são separados? O `app.js` apenas **monta** a aplicação (recebendo banco e issuer como parâmetros). Isso permite que os testes montem a mesma aplicação com um banco em memória e um Keycloak simulado, sem subir servidor de verdade nem acessar a internet.

## 5. Configuração passo a passo

### Pré-requisitos

- Node.js 20.6 ou superior (`node -v`)
- Docker (para o Keycloak). Alternativa: baixar o Keycloak em <https://www.keycloak.org/downloads> e rodar `bin/kc.bat start-dev` (Windows) ou `bin/kc.sh start-dev`.
- Uma conta no [Supabase](https://supabase.com/)
- [Bruno](https://www.usebruno.com/) instalado

### 5.1 Instalar as dependências

```bash
npm install
```

### 5.2 Criar o arquivo `.env`

```bash
cp .env.example .env     # no Windows (PowerShell): Copy-Item .env.example .env
```

Você vai preencher `DATABASE_URL` (passo 5.3) e `KEYCLOAK_ADMIN_PASSWORD` (passo 5.4). O `.env` está no `.gitignore`: **nunca** envie senhas para o Git.

### 5.3 Banco de dados (Supabase)

1. No Supabase, crie um projeto e **guarde a senha do banco** que você definir.
2. Clique em **Connect** e copie a string do **Session pooler** (formato `postgresql://postgres.<ref>:[YOUR-PASSWORD]@<host>:5432/postgres`).
3. Cole em `DATABASE_URL` no `.env`, trocando `[YOUR-PASSWORD]` pela sua senha. Se a senha tiver caracteres especiais (`@`, `#`, `/`, `%`...), eles precisam ser codificados na URL (ex.: `@` vira `%40`).
4. Crie a tabela:

```bash
npm run db:init
```

Esse comando executa o `sql/schema.sql`. Ele é seguro para rodar de novo (usa `IF NOT EXISTS`). Se preferir, você pode colar o conteúdo do arquivo no **SQL Editor** do Supabase.

> **Por que o Session pooler e não a conexão direta?** A conexão direta do Supabase costuma usar IPv6, e muitas redes domésticas só têm IPv4. O pooler funciona nos dois casos. Confira o que o painel recomenda para o seu projeto.

> **Segurança no Supabase:** o `schema.sql` liga o **RLS** (Row Level Security) na tabela, sem criar policies. Sem isso, a API REST automática do Supabase deixaria a tabela acessível a qualquer pessoa com a *anon key* (que é pública). Nossa API conecta direto no Postgres, que ignora o RLS, então continua funcionando.

### 5.4 Keycloak

Defina em `.env` uma senha para o admin do Keycloak (`KEYCLOAK_ADMIN_PASSWORD`) e suba o container:

```bash
docker compose up -d
```

Acesse <http://localhost:8080> (a primeira inicialização pode levar um minuto) e entre com o usuário `admin` e a senha que você definiu. Depois configure:

1. **Realm:** no menu no canto superior esquerdo, **Create realm** e use o nome `empresa`.
2. **Roles:** em **Realm roles > Create role**, crie `gerente` e `funcionario`.
3. **Client:** em **Clients > Create client**:
   - *Client type*: OpenID Connect; *Client ID*: `todo-api`
   - *Client authentication*: **Off** (cliente público)
   - *Authentication flow*: mantenha **Standard flow** e marque **Direct access grants** (necessário para o login por usuário e senha no Bruno)
4. **Usuários:** em **Users > Add user**, crie por exemplo `gerente1` e `funcionario1`:
   - Preencha **Email, First name e Last name** (sem isso o login falha com *"Account is not fully set up"*)
   - Aba **Credentials > Set password**, com **Temporary: Off**
   - Aba **Role mapping > Assign role**: `gerente` para o gerente e `funcionario` para o funcionário

Os nomes `gerente1` e `funcionario1` são só sugestão. Se usar outros, ajuste `gerenteUser` e `funcionarioUser` no ambiente do Bruno.

### 5.5 Iniciar a API

```bash
npm start          # ou: npm run dev  (reinicia sozinho quando você altera o código)
```

Você deve ver `API rodando em http://localhost:3000`. Teste: <http://localhost:3000/health> deve responder `{"status":"ok"}`.

## 6. Endpoints

Todas as rotas, exceto `/health`, exigem o header `Authorization: Bearer <access_token>`. Corpos de requisição são JSON.

| Método | Rota | Descrição | Corpo |
|---|---|---|---|
| GET | `/health` | Verifica se a API está no ar (pública) | — |
| GET | `/me` | Mostra a identidade lida do token (útil para depurar perfis) | — |
| GET | `/tasks` | Lista tarefas. Gerente: todas (filtro opcional `?assigned_to=usuario`). Funcionário: só as suas | — |
| GET | `/tasks/:id` | Consulta uma tarefa | — |
| POST | `/tasks` | Cria e atribui uma tarefa (gerente) | `title`, `assigned_to`, `description` (opcional) |
| PATCH | `/tasks/:id/completed` | Marca como concluída ou pendente (funcionário dono) | `completed`: `true` ou `false` |
| DELETE | `/tasks/:id` | Exclui uma tarefa (gerente) | — |

### Exemplo: criar tarefa (gerente)

```http
POST /tasks
Authorization: Bearer <token do gerente>
Content-Type: application/json

{
  "title": "Enviar relatório mensal",
  "description": "Consolidar os números do mês e enviar ao financeiro",
  "assigned_to": "funcionario1"
}
```

Resposta `201 Created`:

```json
{
  "id": 1,
  "title": "Enviar relatório mensal",
  "description": "Consolidar os números do mês e enviar ao financeiro",
  "assigned_to": "funcionario1",
  "created_by": "gerente1",
  "completed": false,
  "created_at": "2026-10-23T15:42:10.123Z"
}
```

### Exemplo: concluir tarefa (funcionário)

```http
PATCH /tasks/1/completed
Authorization: Bearer <token do funcionário>
Content-Type: application/json

{ "completed": true }
```

Resposta `200 OK`: a tarefa completa, agora com `"completed": true`.

### Códigos de status usados

| Código | Quando |
|---|---|
| 200 / 201 / 204 | Sucesso (204 = exclusão sem corpo de resposta) |
| 400 | Corpo inválido: campo faltando, tipo errado ou JSON malformado |
| 401 | Token ausente, inválido ou expirado |
| 403 | Autenticado, mas sem permissão (perfil errado ou tarefa de outro funcionário) |
| 404 | Tarefa ou rota inexistente |
| 500 | Erro inesperado (a mensagem real vai para o log, não para o cliente) |

## 7. Modelo de dados

Uma única tabela, `tasks` (veja `sql/schema.sql`):

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `INTEGER` (identity) | Chave primária, gerada pelo banco |
| `title` | `TEXT NOT NULL` | Título da tarefa |
| `description` | `TEXT` | Detalhes (opcional) |
| `assigned_to` | `TEXT NOT NULL` | `username` do funcionário responsável (vem do Keycloak) |
| `created_by` | `TEXT NOT NULL` | `username` do gerente que criou (vem do token, não do corpo da requisição) |
| `completed` | `BOOLEAN NOT NULL DEFAULT false` | `true` = concluída, `false` = pendente |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Data e hora de criação |

Os usuários **não** ficam no nosso banco: eles existem apenas no Keycloak. A tabela guarda só o `username` como referência.

As consultas usam **parâmetros** (`$1`, `$2`...), por exemplo `WHERE assigned_to = $1`. O driver envia os valores separados do texto SQL, o que protege contra *SQL Injection*.

## 8. Testando com o Bruno

1. No Bruno: **Open Collection** e selecione a pasta `bruno/` deste repositório.
2. No canto superior direito, selecione o ambiente **local** e clique em **Configure** para preencher os segredos `gerentePassword` e `funcionarioPassword` (as senhas dos usuários que você criou no Keycloak). Segredos ficam apenas na sua máquina, não nos arquivos do repositório.
3. Rode as requisições em ordem (ou use **Run** na coleção):

| # | Requisição | Resultado esperado |
|---|---|---|
| 01 | Health | 200 |
| 02 | Login gerente | 200, e o token fica salvo em `{{gerenteToken}}` |
| 03 | Login funcionário | 200, e o token fica salvo em `{{funcionarioToken}}` |
| 04 | Quem sou eu (gerente) | 200, mostra `username` e `roles` |
| 05 | Criar tarefa (gerente) | 201, e o `id` fica salvo em `{{taskId}}` |
| 06 | Listar todas (gerente) | 200 |
| 07 | Listar minhas (funcionário) | 200, só as tarefas dele |
| 08 | Buscar por id (funcionário) | 200 |
| 09 | Marcar como `true` | 200, `completed: true` |
| 10 | Marcar como `false` | 200, `completed: false` |
| 11 | Funcionário tenta criar tarefa | **403** (esperado) |
| 12 | Sem token | **401** (esperado) |
| 13 | Excluir tarefa (gerente) | 204 |

Cada requisição tem *assertions* (aba **Assert**), então o Bruno mostra se o resultado foi o esperado. Os access tokens duram pouco: se começar a receber `401`, rode de novo as requisições de login (02 e 03).

## 9. Testes automatizados

```bash
npm test
```

Os testes **não precisam** de Keycloak, Docker, internet nem do Supabase:

- Um **Keycloak simulado** publica uma chave pública, e os testes assinam tokens JWT com a chave privada correspondente. Assim é possível forjar casos como token expirado, assinatura de outra chave e emissor errado.
- O banco é o **PGlite**, um PostgreSQL de verdade rodando em memória, que executa o mesmo `sql/schema.sql` do projeto. Os dados reais do Supabase nunca são tocados.

Cobertura: autenticação (401), autorização por perfil (403), validação de entrada (400), regras de dono da tarefa e todo o ciclo criar, listar, concluir, reabrir e excluir.

## 10. Decisões de projeto

- **SQL puro com `pg`** em vez de um ORM ou do `supabase-js`: menos camadas e mais aprendizado de SQL. O Supabase é usado aqui como um PostgreSQL hospedado.
- **Autorização na API, não no banco:** as regras ("só o dono altera") estão em `src/tasks.js`. O RLS está ligado apenas para bloquear a API REST pública do Supabase.
- **`username` como identificador do funcionário**, em vez do `sub` (UUID): é legível e fácil de digitar no Bruno ao atribuir uma tarefa.
- **`created_by` vem do token**, nunca do corpo da requisição: o cliente não pode se passar por outro gerente.
- **Senhas e segredos fora do repositório:** `.env` ignorado pelo Git, `.env.example` com campos vazios e segredos do Bruno guardados localmente.
- **Login por senha (*password grant*) só para facilitar testes no Bruno.** Esse fluxo está em desuso no OAuth 2.1. Aplicações reais usam *Authorization Code com PKCE*.

## 11. Limitações e próximos passos

- A API **não verifica se o `assigned_to` existe** no Keycloak. Poderia consultar a Admin API do Keycloak antes de criar a tarefa.
- Não validamos o `aud` (*audience*) do token. Por padrão, o Keycloak emite tokens com `aud: account`; para validar, seria preciso configurar um *audience mapper* no client.
- A conexão com o Supabase usa SSL **sem verificar o certificado do servidor** (`rejectUnauthorized: false`, em `src/db.js`). A criptografia existe, mas a identidade do servidor não é conferida. Para endurecer, baixe o certificado CA do Supabase e passe em `ssl.ca`.
- Faltam paginação em `GET /tasks`, edição de título e descrição, e prazo (`due_date`) nas tarefas.
- Não há migrations versionadas: o `schema.sql` cria a tabela, mas não evolui um banco existente.
- Falta *rate limiting* e o container do Keycloak roda em modo de desenvolvimento (`start-dev`).

## 12. Problemas comuns

| Sintoma | Causa provável e solução |
|---|---|
| `node: .env: not found` ao rodar `npm start` | Falta criar o `.env`. Rode `cp .env.example .env` e preencha. |
| `Não foi possível conectar ao banco: ...` | `DATABASE_URL` incorreta. Confira a senha (e a codificação de caracteres especiais) e prefira a string do Session pooler. |
| Login no Bruno: `invalid_grant` / *Account is not fully set up* | O usuário precisa de Email, First name e Last name preenchidos no Keycloak. |
| Login no Bruno: `invalid_grant` / *Invalid user credentials* | Senha incorreta no segredo do ambiente do Bruno. |
| Login no Bruno: `unauthorized_client` | Ative **Direct access grants** no client `todo-api`. |
| API responde `401` e o log mostra `ERR_JWT_CLAIM_VALIDATION_FAILED` | O `iss` do token difere do `KEYCLOAK_ISSUER`. Use `localhost` nos dois lugares (`127.0.0.1` gera um issuer diferente). |
| API responde `401` e o log mostra `ERR_JWT_EXPIRED` | Token expirado. Rode de novo a requisição de login. |
| API responde `401` e o log mostra erro de rede (`fetch failed`, timeout) | A API não está alcançando o Keycloak. Confirme que o container está de pé (`docker compose ps`). |
| `403` mesmo com token válido | O usuário não tem o perfil. Rode a requisição **04** (`/me`) e confira `roles`; atribua o role em **Role mapping**. |
