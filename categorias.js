// categorias.js
// Etiquetas livres por corretor (do onboarding, de palavras-chave próprias,
// ou criadas na hora de marcar um lead). Um lead pode ter várias.

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
async function garantirCategorias(corretorId, nomes) {
  const nomesLimpos = [...new Set(nomes.map((n) => (n || '').trim()).filter(Boolean))];
  if (!nomesLimpos.length) return [];

  const linhas = nomesLimpos.map((_, i) => `($1, $${i + 2})`).join(', ');
  const resultado = await pool.query(
    `INSERT INTO categorias (corretor_id, nome) VALUES ${linhas}
     ON CONFLICT (corretor_id, nome) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id, nome`,
    [corretorId, ...nomesLimpos]
  );

  const idPorNome = new Map(resultado.rows.map((r) => [r.nome, r.id]));
  return nomesLimpos.map((nome) => idPorNome.get(nome));
}

// substitui de vez as categorias associadas ao lead pelas informadas.
async function definirCategoriasDoLead(leadId, categoriaIds) {
  await pool.query('DELETE FROM lead_categorias WHERE lead_id = $1', [leadId]);
  if (!categoriaIds.length) return;

  const linhas = categoriaIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(`INSERT INTO lead_categorias (lead_id, categoria_id) VALUES ${linhas}`, [
    leadId,
    ...categoriaIds,
  ]);
}

async function buscarLeadComCategorias(leadId) {
  const resultado = await pool.query(
    `SELECT l.*, COALESCE(array_agg(c.nome ORDER BY c.nome) FILTER (WHERE c.nome IS NOT NULL), '{}') AS categorias
     FROM leads l
     LEFT JOIN lead_categorias lc ON lc.lead_id = l.id
     LEFT JOIN categorias c ON c.id = lc.categoria_id
     WHERE l.id = $1
     GROUP BY l.id`,
    [leadId]
  );
  return resultado.rows[0];
}

module.exports = { listarCategorias, garantirCategorias, definirCategoriasDoLead, buscarLeadComCategorias };
