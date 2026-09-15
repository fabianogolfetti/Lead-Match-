// database.js
// Conexão com o Postgres. Substitui o SQLite (better-sqlite3): o disco do
// Render é efêmero, então um banco em arquivo local perdia corretores e
// leads a cada deploy/restart. Em produção aponta pro Postgres do Render
// (ou outro, ex. Neon); em dev local, pro Postgres que você tiver rodando.

const { Pool } = require('pg');

const ehLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ehLocal ? false : { rejectUnauthorized: false },
});

async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS corretores (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,               -- só exibição, sem validação especial
      email TEXT,                       -- login é por aqui; obrigatório/único é validado na aplicação
      senha TEXT NOT NULL,              -- hash bcrypt, nunca texto puro
      onboarding_concluido BOOLEAN NOT NULL DEFAULT false, -- já respondeu o questionário de categorias?
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // migrações leves: corretores já existiam antes dessas colunas/regras
  await pool.query('ALTER TABLE corretores ADD COLUMN IF NOT EXISTS onboarding_concluido BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE corretores ADD COLUMN IF NOT EXISTS email TEXT');
  // "nome" era único; agora é só exibição e quem passa a ser único é "email"
  // (índice único em vez de UNIQUE inline: permite várias linhas com email
  // NULL, pros corretores antigos que ainda não migraram pro login por e-mail)
  await pool.query('ALTER TABLE corretores DROP CONSTRAINT IF EXISTS corretores_nome_key');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS corretores_email_unique ON corretores (email)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      nome TEXT,
      papel TEXT NOT NULL,              -- 'comprador' ou 'vendedor'
      tipo TEXT NOT NULL,               -- 'terreno' | 'ferro_lote' | 'estrutura_metalica'
      cidade TEXT,
      etiqueta TEXT,                    -- ex: industrial, residencial (opcional)

      -- campos específicos de TERRENO
      area_m2 DOUBLE PRECISION,
      valor_total DOUBLE PRECISION,

      -- campos específicos de FERRO EM LOTE
      toneladas DOUBLE PRECISION,
      preco_kg DOUBLE PRECISION,

      -- campos específicos de ESTRUTURA METÁLICA
      comprimento_m DOUBLE PRECISION,
      largura_m DOUBLE PRECISION,

      mensagem_original TEXT,
      confirmado INTEGER DEFAULT 0,          -- 0 = aguardando confirmação, 1 = confirmado
      status TEXT NOT NULL DEFAULT 'aberto', -- 'aberto' | 'fechado' (fechado não entra mais no matching)
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // etiquetas livres do corretor (dos moldes que ele escolheu no onboarding +
  // palavras-chave próprias + qualquer uma criada na hora de marcar um lead)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categorias (
      id SERIAL PRIMARY KEY,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      nome TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (corretor_id, nome)
    )
  `);

  // um lead pode ter várias categorias, e uma categoria vale pra vários leads
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_categorias (
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
      PRIMARY KEY (lead_id, categoria_id)
    )
  `);
}

module.exports = { pool, migrar };
