// matching.js
// Cruza intenções de um MESMO corretor: direção oposta (tenho x procuro),
// mesma operação (venda, locação...), categoria compatível e cidade
// compatível. Quem passa nesses filtros recebe uma pontuação de 0 a 100 e
// uma explicação curta do motivo (ex: "mesma categoria, faixa de valor
// sobreposta, mesma cidade"):
//   categoria (até 40)  igual 40 · uma contida na outra 32 · mesmo grupo de sinônimos 28
//   valor     (até 35)  faixas se sobrepõem 35 · próximas 22/12 · distantes 4 · sem valor 15
//   cidade    (até 25)  mesma 25 · alguma das duas sem cidade 10 · cidades diferentes descartam
// Intenções do mesmo contato nunca casam entre si.

const { pool } = require('./database');
const { DIRECOES } = require('./categorias-config');

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'para', 'pra', 'em', 'com', 'a', 'o', 'as', 'os', 'um', 'uma', 'no', 'na']);

function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// plural -> singular só o bastante pro dicionário abaixo e pra comparação
// ("galpões" -> "galpao", "perfis" -> "perfil", "imóveis" -> "imovel")
function singularizar(palavra) {
  if (palavra.length > 4) {
    if (palavra.endsWith('oes') || palavra.endsWith('aes')) return palavra.slice(0, -3) + 'ao';
    if (palavra.endsWith('eis')) return palavra.slice(0, -3) + 'el';
    if (palavra.endsWith('ais')) return palavra.slice(0, -3) + 'al';
    if (palavra.endsWith('ns')) return palavra.slice(0, -2) + 'm';
    if (/[rz]es$/.test(palavra)) return palavra.slice(0, -2);
    if (palavra.endsWith('is')) return palavra.slice(0, -2) + 'il';
  }
  if (palavra.length > 3 && palavra.endsWith('s') && !palavra.endsWith('ss')) return palavra.slice(0, -1);
  return palavra;
}

function tokens(texto) {
  return normalizarTexto(texto)
    .split(' ')
    .filter((palavra) => palavra && !STOPWORDS.has(palavra))
    .map(singularizar);
}

// Dicionário curado à mão: termos (em qualquer forma/plural) que o corretor
// usa como sinônimos no dia a dia. Só o que é "a mesma coisa dita de outro
// jeito" — categoria mais ampla que a outra (ex: "imóvel" x "casa") NÃO entra
// aqui; isso cai na regra de "uma contida na outra". Cresce conforme o uso.
const GRUPOS_SINONIMOS = [
  { nome: 'galpão', termos: ['galpão', 'barracão', 'pavilhão', 'armazém'] },
  { nome: 'terreno', termos: ['terreno', 'lote', 'gleba'] },
  { nome: 'casa', termos: ['casa', 'residência', 'sobrado'] },
  { nome: 'apartamento', termos: ['apartamento', 'apto'] },
  { nome: 'sítio/chácara', termos: ['sítio', 'chácara'] },
  { nome: 'ponto comercial', termos: ['loja', 'ponto comercial', 'sala comercial'] },
  { nome: 'sucata', termos: ['sucata', 'ferro velho', 'refugo'] },
  { nome: 'ferro e aço', termos: ['ferro', 'aço', 'vergalhão', 'perfil', 'viga', 'estrutura metálica', 'chapa', 'ferragem', 'metal'] },
  { nome: 'plástico', termos: ['plástico', 'pet', 'polietileno'] },
  { nome: 'veículo', termos: ['carro', 'automóvel', 'veículo'] },
  { nome: 'moto', termos: ['moto', 'motocicleta'] },
  { nome: 'caminhão', termos: ['caminhão', 'truck'] },
  { nome: 'máquinas', termos: ['máquina', 'maquinário', 'equipamento'] },
  { nome: 'frete', termos: ['frete', 'transporte', 'carreto'] },
].map((grupo) => ({ nome: grupo.nome, termos: grupo.termos.map(tokens) }));

function contemSequencia(lista, sequencia) {
  for (let i = 0; i + sequencia.length <= lista.length; i++) {
    if (sequencia.every((palavra, j) => lista[i + j] === palavra)) return true;
  }
  return false;
}

function gruposDe(listaTokens) {
  return GRUPOS_SINONIMOS.filter((grupo) => grupo.termos.some((termo) => contemSequencia(listaTokens, termo)));
}

function compararCategorias(categoriaA, categoriaB) {
  const a = tokens(categoriaA);
  const b = tokens(categoriaB);
  if (!a.length || !b.length) return null;

  if (a.join(' ') === b.join(' ')) return { pontos: 40, motivo: 'mesma categoria' };
  if (a.every((t) => b.includes(t)) || b.every((t) => a.includes(t))) return { pontos: 32, motivo: 'categorias parecidas' };

  const gruposB = gruposDe(b);
  const comum = gruposDe(a).find((grupo) => gruposB.includes(grupo));
  if (comum) return { pontos: 28, motivo: `categorias relacionadas (${comum.nome})` };
  return null;
}

function compararCidades(cidadeA, cidadeB) {
  const a = normalizarTexto(cidadeA);
  const b = normalizarTexto(cidadeB);
  if (!a || !b) return { pontos: 10, motivo: 'cidade não informada' };
  if (a === b) return { pontos: 25, motivo: 'mesma cidade' };
  return null;
}

function numeroOuNull(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// faixa aberta: só mínimo = "a partir de" (sem teto), só máximo = "até" (sem piso)
function faixaDe(intencao) {
  const min = numeroOuNull(intencao.valor_min);
  const max = numeroOuNull(intencao.valor_max);
  if (min == null && max == null) return null;
  return { min, max, lo: min ?? -Infinity, hi: max ?? Infinity };
}

function compararValores(intencaoA, intencaoB) {
  const a = faixaDe(intencaoA);
  const b = faixaDe(intencaoB);
  if (!a || !b) return { pontos: 15, motivo: 'valor não informado' };

  if (a.lo <= b.hi && b.lo <= a.hi) {
    const mesmoValor = a.min != null && a.min === a.max && b.min === b.max && a.min === b.min;
    return { pontos: 35, motivo: mesmoValor ? 'mesmo valor' : 'faixa de valor sobreposta' };
  }

  // sem sobreposição: mede o vão entre as faixas em relação ao valor mais alto envolvido
  const [gap, referencia] = a.hi < b.lo ? [b.lo - a.hi, b.lo] : [a.lo - b.hi, a.lo];
  const proporcao = referencia > 0 ? gap / referencia : 1;
  const diferenca = proporcao >= 1 ? 'mais de 100%' : `~${Math.round(proporcao * 100)}%`;
  if (proporcao <= 0.1) return { pontos: 22, motivo: `faixas de valor próximas (${diferenca} de diferença)` };
  if (proporcao <= 0.25) return { pontos: 12, motivo: `faixas de valor um pouco distantes (${diferenca})` };
  return { pontos: 4, motivo: `faixas de valor distantes (${diferenca})` };
}

// null se as duas intenções não podem casar; senão { pontuacao, motivos, explicacao }
function pontuarPar(a, b) {
  if (!a.direcao || !b.direcao) return null;
  if (!DIRECOES[a.direcao] || DIRECOES[a.direcao].oposta !== b.direcao) return null;
  if (a.operacao !== b.operacao) return null;
  if (a.contato_id === b.contato_id) return null;
  if (a.status !== 'aberto' || b.status !== 'aberto') return null;

  const categoria = compararCategorias(a.categoria, b.categoria);
  if (!categoria) return null;
  const cidade = compararCidades(a.cidade, b.cidade);
  if (!cidade) return null;
  const valor = compararValores(a, b);

  const motivos = [categoria.motivo, valor.motivo, cidade.motivo];
  return { pontuacao: categoria.pontos + valor.pontos + cidade.pontos, motivos, explicacao: motivos.join(', ') };
}

// matches de UMA intenção, já com o nome do contato de cada candidato
async function encontrarMatches(intencao) {
  if (!intencao.direcao || intencao.status !== 'aberto') return [];

  const resultado = await pool.query(
    `SELECT i.*, c.nome AS contato_nome
     FROM intencoes i JOIN contatos c ON c.id = i.contato_id
     WHERE i.corretor_id = $1 AND i.status = 'aberto' AND i.direcao = $2 AND i.operacao = $3 AND i.contato_id <> $4`,
    [intencao.corretor_id, DIRECOES[intencao.direcao].oposta, intencao.operacao, intencao.contato_id]
  );

  return resultado.rows
    .map((candidato) => {
      const pontuado = pontuarPar(intencao, candidato);
      if (!pontuado) return null;
      return {
        intencao_id: candidato.id,
        contato_id: candidato.contato_id,
        contato_nome: candidato.contato_nome,
        direcao: candidato.direcao,
        operacao: candidato.operacao,
        categoria: candidato.categoria,
        descricao: candidato.descricao,
        cidade: candidato.cidade,
        valor_min: candidato.valor_min,
        valor_max: candidato.valor_max,
        ...pontuado,
      };
    })
    .filter(Boolean)
    .sort((x, y) => y.pontuacao - x.pontuacao || y.intencao_id - x.intencao_id)
    .slice(0, 10);
}

// todos os pares que casam entre as intenções abertas do corretor (alimenta
// o dashboard e a lista de matches de cada contato sem uma chamada por intenção)
async function todosOsMatches(corretorId) {
  const resultado = await pool.query(
    "SELECT * FROM intencoes WHERE corretor_id = $1 AND status = 'aberto' AND direcao IS NOT NULL ORDER BY id",
    [corretorId]
  );

  const pares = [];
  const intencoes = resultado.rows;
  for (let i = 0; i < intencoes.length; i++) {
    for (let j = i + 1; j < intencoes.length; j++) {
      const pontuado = pontuarPar(intencoes[i], intencoes[j]);
      if (pontuado) pares.push({ intencao_a: intencoes[i].id, intencao_b: intencoes[j].id, ...pontuado });
    }
  }
  return pares;
}

module.exports = { encontrarMatches, todosOsMatches, pontuarPar };
