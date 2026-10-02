// extraction.js
// Envia a mensagem do corretor para a IA e recebe de volta os dados
// já organizados (contato, direção, operação, categoria, faixa de valor
// etc), prontos para o corretor conferir e confirmar.

require('dotenv').config();

const { DIRECOES, OPERACOES, CAMPOS_INTENCAO } = require('./categorias-config');

// direções e operações do prompt saem direto de categorias-config.js — uma
// operação nova ali já aparece aqui sozinha, sem editar este texto na mão.
function descreverOperacoes() {
  return Object.entries(OPERACOES)
    .map(([chave, operacao]) => `"${chave}" (${operacao.label}): tenho = "${operacao.rotulos.tenho}", procuro = "${operacao.rotulos.procuro}"`)
    .join('; ');
}

const CAMPOS_OBRIGATORIOS = Object.entries(CAMPOS_INTENCAO)
  .filter(([, meta]) => !meta.opcional)
  .map(([campo]) => campo);

const SYSTEM_PROMPT = `Você lê mensagens informais de corretores/comerciantes (imóveis, galpões, ferro e aço, sucata, plástico, carros...)
e extrai UMA intenção de negócio em JSON. A mensagem pode estar torta, sem formatação, com gírias.

Campos do JSON:
- nome: nome da pessoa (contato) que está oferecendo ou procurando
- direcao: ${Object.keys(DIRECOES).map((d) => `"${d}"`).join(' ou ')}. "tenho" = a pessoa tem/oferece a coisa; "procuro" = a pessoa quer conseguir a coisa
- operacao: ${Object.keys(OPERACOES).map((o) => `"${o}"`).join(' ou ')} (${descreverOperacoes()})
- categoria: o que é a coisa, em poucas palavras (ex: "galpão", "sucata de ferro", "terreno")
- descricao: resumo curto do que foi dito (quantidade, estado, detalhes)
- cidade
- valor_min e valor_max: faixa de valor em reais, como número puro (sem "R$", sem pontos). Um valor só (ex: "850 mil") vale para os dois campos;
  "até X" preenche só valor_max; "a partir de X" preenche só valor_min; "entre X e Y" preenche os dois.

Se um campo não aparecer na mensagem, deixe null.
Sempre inclua "campos_faltando": lista dos campos importantes que ficaram null
(nome, direcao, operacao, cidade${CAMPOS_OBRIGATORIOS.map((c) => `, ${c}`).join('')}). valor_min e valor_max nunca entram nessa lista.

Responda APENAS com o JSON, sem nenhum texto antes ou depois.`;

async function extrairLead(textoMensagem) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada no arquivo .env');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: textoMensagem }],
    }),
  });

  if (!response.ok) {
    const erro = await response.text();
    throw new Error(`Erro na chamada da IA: ${response.status} - ${erro}`);
  }

  const data = await response.json();
  const textoResposta = data.content.map((bloco) => bloco.text || '').join('');

  // remove eventuais crases de markdown (```json ... ```) antes de parsear
  const jsonLimpo = textoResposta.replace(/```json|```/g, '').trim();
  return JSON.parse(jsonLimpo);
}

module.exports = { extrairLead };
