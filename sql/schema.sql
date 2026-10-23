-- Esquema do banco (PostgreSQL / Supabase).
-- Pode ser executado quantas vezes quiser: usa IF NOT EXISTS e não apaga dados.
-- Como aplicar: "npm run db:init" ou cole este conteúdo no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT        NOT NULL,
  description TEXT,
  assigned_to TEXT        NOT NULL,  -- username do funcionário no Keycloak (preferred_username)
  created_by  TEXT        NOT NULL,  -- username do gerente que criou a tarefa
  completed   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Acelera a busca "tarefas de um funcionário"
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks (assigned_to);

-- SEGURANÇA NO SUPABASE:
-- Toda tabela do schema "public" fica exposta pela API REST automática do Supabase.
-- Ligando o RLS (Row Level Security) SEM criar nenhuma policy, essa API pública não
-- consegue ler nem escrever na tabela. Nossa API Node conecta direto no Postgres com
-- o usuário "postgres", que ignora o RLS, então continua funcionando normalmente.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
