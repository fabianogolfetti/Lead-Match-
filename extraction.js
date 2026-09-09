// extraction.js
// Envia a mensagem do corretor para a IA e recebe de volta os dados
// já organizados (papel, tipo, cidade, valores etc), prontos para
// o corretor conferir e confirmar.

require('dotenv').config();

const SYSTEM_PROMPT = `Você lê mensagens informais de corretores (imóveis, ferro e aço, estrutura metálica)
e extrai os dados do lead em JSON. A mensagem pode estar torta, sem formatação, com gírias.

Existem 3 "moldes" possíveis. Identifique qual se aplica e preencha SOMENTE os campos daquele molde:

1) terreno: { tipo: "terreno", nome, papel, cidade, etiqueta (industrial/residencial/null), area_m2, valor_total }
2) ferro_lote: { tipo: "ferro_lote", nome, papel, cidade, toneladas, preco_kg }
3) estrutura_metalica: { tipo: "estrutura_metalica", nome, papel, cidade, comprimento_m, largura_m, valor_total }

papel deve ser "comprador" ou "vendedor".
Se um campo não aparecer na mensagem, deixe null.
Sempre inclua um campo "campos_faltando": lista dos nomes de campo que ficaram null e são importantes
(nome, cidade, e os campos numéricos do molde escolhido).

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
