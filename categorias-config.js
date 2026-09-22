// categorias-config.js
// Definição central do(s) tipo(s) de lead que o corretor pode cadastrar.
// Hoje só existe um tipo genérico ("geral"); se um dia fizer sentido voltar
// a ter mais de um, é só acrescentar outra entrada aqui — o banco
// (database.js), o matching (matching.js), a extração por IA
// (extraction.js) e o formulário (public/index.html, via GET /tipos-lead)
// leem tudo daqui.
//
// Cada tipo tem:
//   - label: nome exibido no formulário e nos filtros
//   - campos: um por campo específico do tipo
//       - label: texto exibido no formulário
//       - tipoDado: 'numero' | 'texto' — define o tipo da coluna no banco
//       - opcional: true se não deve ser cobrado em "campos_faltando" da IA
//         (o padrão, sem essa chave, é obrigatório)
//   - campoValor: qual campo usar pra calcular a proximidade de valor no
//     matching (quanto menor a diferença, mais parecido o lead)

const TIPOS_LEAD = {
  geral: {
    label: 'Lead',
    campos: {
      descricao: { label: 'Descrição', tipoDado: 'texto' },
      categoria: { label: 'Categoria', tipoDado: 'texto' },
      valor_aproximado: { label: 'Valor aproximado (R$)', tipoDado: 'numero' },
    },
    campoValor: 'valor_aproximado',
  },
};

module.exports = { TIPOS_LEAD };
