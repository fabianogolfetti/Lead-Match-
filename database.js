// database.js
// Conexão com o Postgres. Substitui o SQLite (better-sqlite3): o disco do
// Render é efêmero, então um banco em arquivo local perdia corretores e
// leads a cada deploy/restart. Em produção aponta pro Postgres do Render
// (ou outro, ex. Neon); em dev local, pro Postgres que você tiver rodando.

const { Pool, types } = require('pg');

// DATE (ex: proximo_contato) volta como "AAAA-MM-DD" puro em vez de um Date
// à meia-noite do fuso do servidor — que, serializado, podia virar o dia
// anterior/seguinte dependendo de onde o servidor roda.
types.setTypeParser(1082, (valor) => valor);

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

  // etiquetas livres do corretor (das palavras-chave do onboarding + qualquer
  // uma criada na hora de marcar uma intenção)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categorias (
      id SERIAL PRIMARY KEY,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      nome TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (corretor_id, nome)
    )
  `);

  // contato = a pessoa/empresa. O que ela quer (comprar, vender, alugar...)
  // fica nas intenções; um contato pode ter quantas quiser.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      nome TEXT,
      notas TEXT,
      proximo_contato DATE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ,
      lead_origem_id INTEGER              -- só preenchido nos contatos vindos da migração da tabela "leads"
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS contatos_corretor_idx ON contatos (corretor_id)');

  // intenção = um "tenho X" / "procuro X" de um contato, numa operação
  // (venda, locação... ver categorias-config.js). O valor é uma faixa e
  // aceita só um dos lados preenchido.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intencoes (
      id SERIAL PRIMARY KEY,
      contato_id INTEGER NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      direcao TEXT CHECK (direcao IN ('tenho', 'procuro')), -- null só na migração de papéis que não eram comprador/vendedor
      operacao TEXT NOT NULL DEFAULT 'venda',                -- chave de OPERACOES; sem CHECK pra ser extensível
      categoria TEXT,
      descricao TEXT,
      cidade TEXT,
      valor_min DOUBLE PRECISION,
      valor_max DOUBLE PRECISION,
      mensagem_original TEXT,
      status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ,
      fechado_em TIMESTAMPTZ,
      papel_original TEXT,                -- texto original do "papel" nos leads migrados (auditoria)
      lead_origem_id INTEGER              -- só preenchido nas intenções vindas da migração da tabela "leads"
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS intencoes_corretor_status_idx ON intencoes (corretor_id, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS intencoes_contato_idx ON intencoes (contato_id)');

  // uma intenção pode ter várias etiquetas, e uma etiqueta vale pra várias intenções
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intencao_categorias (
      intencao_id INTEGER NOT NULL REFERENCES intencoes(id) ON DELETE CASCADE,
      categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
      PRIMARY KEY (intencao_id, categoria_id)
    )
  `);

  // quais leads da tabela antiga já viraram contato + intenção. Separado das
  // colunas lead_origem_id de propósito: se o corretor apagar um contato
  // migrado, o lead antigo não pode "ressuscitar" na próxima subida.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads_migrados (
      lead_id INTEGER PRIMARY KEY,
      migrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await migrarLeadsLegados();
}

// A tabela "leads" (um lead = uma pessoa com um único papel e valor) foi
// substituída por contatos + intenções. Migração ADITIVA: não altera nem
// apaga nada em "leads"/"lead_categorias" (ficam como backup) e roda a cada
// subida, pegando também leads criados pela versão antiga do app durante a
// transição. Cada lead vira 1 contato + 1 intenção:
//   papel vendedor  -> direção "tenho",   operação "venda"
//   papel comprador -> direção "procuro", operação "venda"
//   qualquer outro papel (ex: "Corretor") -> direção null, papel guardado em
//   papel_original — não dá pra adivinhar; o corretor define na edição.
//   valor_aproximado -> valor_min = valor_max (faixa de um ponto só)
async function migrarLeadsLegados() {
  const existe = await pool.query("SELECT to_regclass('public.leads') AS tabela, to_regclass('public.lead_categorias') AS tags");
  if (!existe.rows[0].tabela) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // duas instâncias subindo juntas (ex: deploy + máquina local) não podem migrar o mesmo lead duas vezes
    await client.query('SELECT pg_advisory_xact_lock(727001)');

    const pendentes = await client.query('SELECT id FROM leads WHERE id NOT IN (SELECT lead_id FROM leads_migrados) ORDER BY id');
    const ids = pendentes.rows.map((linha) => linha.id);

    if (ids.length) {
      await client.query(
        `INSERT INTO contatos (corretor_id, nome, notas, proximo_contato, criado_em, atualizado_em, lead_origem_id)
         SELECT l.corretor_id, NULLIF(BTRIM(l.nome), ''), NULLIF(l.notas, ''), l.proximo_contato, l.criado_em, l.atualizado_em, l.id
         FROM leads l WHERE l.id = ANY($1) ORDER BY l.id`,
        [ids]
      );

      await client.query(
        `INSERT INTO intencoes
           (contato_id, corretor_id, direcao, operacao, categoria, descricao, cidade, valor_min, valor_max,
            mensagem_original, status, criado_em, atualizado_em, fechado_em, papel_original, lead_origem_id)
         SELECT c.id, l.corretor_id,
                CASE LOWER(BTRIM(l.papel)) WHEN 'vendedor' THEN 'tenho' WHEN 'comprador' THEN 'procuro' ELSE NULL END,
                'venda', NULLIF(BTRIM(l.categoria), ''), l.descricao, NULLIF(BTRIM(l.cidade), ''),
                l.valor_aproximado, l.valor_aproximado,
                l.mensagem_original, l.status, l.criado_em, l.atualizado_em, l.fechado_em, l.papel, l.id
         FROM leads l JOIN contatos c ON c.lead_origem_id = l.id
         WHERE l.id = ANY($1) ORDER BY l.id`,
        [ids]
      );

      // etiquetas só dos leads migrados agora — copiar sempre ressuscitaria etiqueta que o corretor já removeu
      if (existe.rows[0].tags) {
        await client.query(
          `INSERT INTO intencao_categorias (intencao_id, categoria_id)
           SELECT i.id, lc.categoria_id
           FROM lead_categorias lc JOIN intencoes i ON i.lead_origem_id = lc.lead_id
           WHERE lc.lead_id = ANY($1)
           ON CONFLICT DO NOTHING`,
          [ids]
        );
      }

      await client.query('INSERT INTO leads_migrados (lead_id) SELECT unnest($1::int[])', [ids]);
    }

    await client.query('COMMIT');
    if (ids.length) console.log(`Migração: ${ids.length} lead(s) antigo(s) viraram contato + intenção.`);
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrar };
