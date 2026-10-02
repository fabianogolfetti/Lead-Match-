// categorias-config.js
// Definição central do que uma "intenção" pode ser. Um contato (a pessoa) tem
// quantas intenções quiser; cada intenção combina dois eixos:
//   - direção: o que a pessoa faz com a coisa ("tenho" ou "procuro")
//   - operação: o tipo de negócio (venda, locação, ...)
// O matching cruza direções opostas dentro da mesma operação. Pra suportar
// uma operação nova (troca, serviço, ...) basta acrescentar uma entrada em
// OPERACOES: o banco (TEXT sem CHECK), a validação (index.js), o prompt da IA
// (extraction.js) e os formulários (public/index.html, via GET
// /config-intencoes) leem tudo daqui.
//
// OPERACOES.<op>.rotulos: como a intenção aparece escrita pro corretor
// ("Vendo", "Compro"...), uma por direção.

const DIRECOES = {
  tenho: { label: 'Tenho', oposta: 'procuro' },
  procuro: { label: 'Procuro', oposta: 'tenho' },
};

const OPERACOES = {
  venda: { label: 'Venda', rotulos: { tenho: 'Vendo', procuro: 'Compro' } },
  locacao: { label: 'Locação', rotulos: { tenho: 'Alugo', procuro: 'Procuro alugar' } },
};

// campos próprios da intenção (o contato tem nome, notas e próximo contato).
//   - tipoDado: 'texto' | 'numero'
//   - opcional: true se não deve ser cobrado em "campos_faltando" da IA
// valor_min e valor_max formam uma faixa e podem vir só um dos dois:
// só mínimo = "a partir de", só máximo = "até".
const CAMPOS_INTENCAO = {
  descricao: { label: 'Descrição', tipoDado: 'texto' },
  categoria: { label: 'Categoria', tipoDado: 'texto' },
  valor_min: { label: 'Valor mínimo (R$)', tipoDado: 'numero', opcional: true },
  valor_max: { label: 'Valor máximo (R$)', tipoDado: 'numero', opcional: true },
};

module.exports = { DIRECOES, OPERACOES, CAMPOS_INTENCAO };
