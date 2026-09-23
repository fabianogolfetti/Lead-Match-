// database.js
// Conexão com o Postgres. Substitui o SQLite (better-sqlite3): o disco do
// Render é efêmero, então um banco em arquivo local perdia corretores e
// leads a cada deploy/restart. Em produção aponta pro Postgres do Render
// (ou outro, ex. Neon); em dev local, pro Postgres que você tiver rodando.

const { Pool } = require('pg');
const { TIPOS_LEAD } = require('./categorias-config');

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
      tipo TEXT NOT NULL,               -- chave de TIPOS_LEAD (ver categorias-config.js)
      cidade TEXT,
      mensagem_original TEXT,
      confirmado INTEGER DEFAULT 0,          -- 0 = aguardando confirmação, 1 = confirmado
      status TEXT NOT NULL DEFAULT 'aberto', -- 'aberto' | 'fechado' (fechado não entra mais no matching)
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ,         -- última edição (null até a primeira, pra "histórico" na tela de detalhe)
      fechado_em TIMESTAMPTZ             -- quando foi marcado como fechado (pra "atividade recente")
    )
  `);
  // migrações leves: leads já existiam antes dessas colunas
  await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMPTZ');
  await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ');

  // campos específicos de cada tipo de lead viram colunas aqui. Cada tipo
  // novo em TIPOS_LEAD já garante as colunas dele sozinho, sem precisar
  // mexer neste arquivo.
  const TIPO_SQL_POR_DADO = { numero: 'DOUBLE PRECISION', data: 'DATE' };
  for (const definicao of Object.values(TIPOS_LEAD)) {
    for (const [campo, meta] of Object.entries(definicao.campos)) {
      const tipoSql = TIPO_SQL_POR_DADO[meta.tipoDado] || 'TEXT';
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${campo} ${tipoSql}`);
    }
  }

  // os vários moldes antigos (terreno, ferro_lote, estrutura_metalica,
  // ferro_aco, plastico, carro) foram simplificados num único tipo genérico
  // — migra quem ainda estiver com um tipo diferente do único que existe hoje
  const [tipoUnico] = Object.keys(TIPOS_LEAD);
  await pool.query('UPDATE leads SET tipo = $1 WHERE tipo IS DISTINCT FROM $1', [tipoUnico]);

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
