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
      nome TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,              -- hash bcrypt, nunca texto puro
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

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
}

module.exports = { pool, migrar };
