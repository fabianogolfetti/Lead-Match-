// matching.js
// Depois que um lead é confirmado, procura na base leads do papel oposto
// (comprador <-> vendedor), do mesmo tipo e cidade, e ordena do mais
// parecido em valor para o mais distante. Só considera leads do mesmo
// corretor: cada corretor só recebe match dos próprios leads.

const { pool } = require('./database');
const { TIPOS_LEAD } = require('./categorias-config');

// "categoria" é texto livre (o corretor digita) — duas batem se forem iguais
// (ignorando maiúsculas/espaços) ou se uma contiver a outra, pra pegar casos
// como "terreno" batendo com "terreno industrial".
function categoriasCorrespondem(categoriaA, categoriaB) {
  const a = (categoriaA || '').trim().toLowerCase();
  const b = (categoriaB || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// calcula "o quanto esse lead se parece" com o lead novo: só considera leads
// com categoria correspondente, e dentro desses olha a proximidade do
// "campoValor" definido pro tipo em categorias-config.js
function diferencaDeValor(leadA, leadB) {
  if (!categoriasCorrespondem(leadA.categoria, leadB.categoria)) return Infinity;

  const campoValor = TIPOS_LEAD[leadA.tipo] && TIPOS_LEAD[leadA.tipo].campoValor;
  if (!campoValor) return Infinity;
  if (leadA[campoValor] == null || leadB[campoValor] == null) return Infinity;
  return Math.abs(leadA[campoValor] - leadB[campoValor]);
}

async function encontrarMatches(lead) {
  const papelOposto = lead.papel === 'comprador' ? 'vendedor' : 'comprador';

  // cidade comparada sem diferenciar maiúscula/minúscula nem espaço nas
  // pontas — mesmo cuidado que já existia pra "categoria", só que faltava
  // aqui (é o que causava "ver matches" vazio com "Atibaia" vs "Atibaia ")
  const resultado = await pool.query(
    `SELECT * FROM leads
     WHERE tipo = $1 AND papel = $2 AND confirmado = 1 AND corretor_id = $4 AND status = 'aberto'
       AND LOWER(TRIM(cidade)) = LOWER(TRIM($3))
     ORDER BY id DESC`,
    [lead.tipo, papelOposto, lead.cidade, lead.corretor_id]
  );

  return resultado.rows
    .map((candidato) => ({
      ...candidato,
      diferenca: diferencaDeValor(lead, candidato),
    }))
    // Infinity = categoria não corresponde (ou falta valor) — não é match de
    // verdade, só serve de "vai pro fim" se eu esquecesse de filtrar
    .filter((candidato) => candidato.diferenca !== Infinity)
    .sort((a, b) => a.diferenca - b.diferenca)
    .slice(0, 5); // top 5 mais próximos
}

module.exports = { encontrarMatches };
