// matching.js
// Depois que um lead é confirmado, procura na base leads do papel oposto
// (comprador <-> vendedor), do mesmo tipo e cidade, e ordena do mais
// parecido em valor para o mais distante. Só considera leads do mesmo
// corretor: cada corretor só recebe match dos próprios leads.

const { pool } = require('./database');

// calcula "o quanto esse lead se parece" com o lead novo, olhando o
// campo de valor mais relevante para o tipo (terreno, ferro ou estrutura)
function diferencaDeValor(leadA, leadB) {
  if (leadA.tipo === 'terreno' || leadA.tipo === 'estrutura_metalica') {
    if (leadA.valor_total == null || leadB.valor_total == null) return Infinity;
    return Math.abs(leadA.valor_total - leadB.valor_total);
  }
  if (leadA.tipo === 'ferro_lote') {
    if (leadA.preco_kg == null || leadB.preco_kg == null) return Infinity;
    return Math.abs(leadA.preco_kg - leadB.preco_kg);
  }
  return Infinity;
}

async function encontrarMatches(lead) {
  const papelOposto = lead.papel === 'comprador' ? 'vendedor' : 'comprador';

  const resultado = await pool.query(
    `SELECT * FROM leads
     WHERE tipo = $1 AND papel = $2 AND confirmado = 1 AND cidade = $3 AND corretor_id = $4 AND status = 'aberto'
     ORDER BY id DESC`,
    [lead.tipo, papelOposto, lead.cidade, lead.corretor_id]
  );

  return resultado.rows
    .map((candidato) => ({
      ...candidato,
      diferenca: diferencaDeValor(lead, candidato),
    }))
    .sort((a, b) => a.diferenca - b.diferenca)
    .slice(0, 5); // top 5 mais próximos
}

module.exports = { encontrarMatches };
