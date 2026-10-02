// categorias.js
// Etiquetas livres por corretor (das palavras-chave do onboarding, ou criadas
// na hora de marcar uma intenção). Uma intenção pode ter várias.

const { pool } = require('./database');

async function listarCategorias(corretorId) {
  const resultado = await pool.query(
    'SELECT id, nome FROM categorias WHERE corretor_id = $1 ORDER BY nome',
    [corretorId]
  );
  return resultado.rows;
}

// cria as categorias que ainda não existem (por nome, dentro do corretor) e
// devolve os ids de todas elas, existentes ou recém-criadas. Uma query só,
// em vez de uma por nome — importa porque cada round-trip ao Postgres remoto
// custa uns bons milissegundos.
async function garantirCategorias(corretorId, nomes, executor = pool) {
  const nomesLimpos = [...new Set(nomes.map((n) => (n || '').trim()).filter(Boolean))];
  if (!nomesLimpos.length) return [];

  const linhas = nomesLimpos.map((_, i) => `($1, $${i + 2})`).join(', ');
  const resultado = await executor.query(
    `INSERT INTO categorias (corretor_id, nome) VALUES ${linhas}
     ON CONFLICT (corretor_id, nome) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id, nome`,
    [corretorId, ...nomesLimpos]
  );

  const idPorNome = new Map(resultado.rows.map((r) => [r.nome, r.id]));
  return nomesLimpos.map((nome) => idPorNome.get(nome));
}

// substitui de vez as etiquetas associadas à intenção pelas informadas.
async function definirCategoriasDaIntencao(intencaoId, categoriaIds, executor = pool) {
  await executor.query('DELETE FROM intencao_categorias WHERE intencao_id = $1', [intencaoId]);
  if (!categoriaIds.length) return;

  const linhas = categoriaIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await executor.query(`INSERT INTO intencao_categorias (intencao_id, categoria_id) VALUES ${linhas}`, [
    intencaoId,
    ...categoriaIds,
  ]);
}

const SELECT_INTENCAO_COM_CATEGORIAS = `
  SELECT i.*, COALESCE(array_agg(c.nome ORDER BY c.nome) FILTER (WHERE c.nome IS NOT NULL), '{}') AS categorias
  FROM intencoes i
  LEFT JOIN intencao_categorias ic ON ic.intencao_id = i.id
  LEFT JOIN categorias c ON c.id = ic.categoria_id`;

async function buscarIntencaoComCategorias(intencaoId, executor = pool) {
  const resultado = await executor.query(
    `${SELECT_INTENCAO_COM_CATEGORIAS} WHERE i.id = $1 GROUP BY i.id`,
    [intencaoId]
  );
  return resultado.rows[0];
}

async function listarIntencoesComCategorias(corretorId) {
  const resultado = await pool.query(
    `${SELECT_INTENCAO_COM_CATEGORIAS} WHERE i.corretor_id = $1 GROUP BY i.id ORDER BY i.id`,
    [corretorId]
  );
  return resultado.rows;
}

module.exports = {
  listarCategorias,
  garantirCategorias,
  definirCategoriasDaIntencao,
  buscarIntencaoComCategorias,
  listarIntencoesComCategorias,
};
