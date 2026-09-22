// extraction.js
// Envia a mensagem do corretor para a IA e recebe de volta os dados
// já organizados (papel, tipo, cidade, valores etc), prontos para
// o corretor conferir e confirmar.

require('dotenv').config();

const { TIPOS_LEAD } = require('./categorias-config');

// gera a lista de moldes do prompt direto de categorias-config.js — um tipo
// novo ali já aparece aqui sozinho, sem precisar editar este texto na mão.
function descreverMoldes() {
  return Object.entries(TIPOS_LEAD)
    .map(([tipo, definicao], indice) => {
      const campos = Object.entries(definicao.campos)
        .map(([campo, meta]) => (meta.opcional ? `${campo} (opcional)` : campo))
        .join(', ');
      return `${indice + 1}) ${tipo} (${definicao.label}): { tipo: "${tipo}", nome, papel, cidade, ${campos} }`;
    })
    .join('\n');
}

const SYSTEM_PROMPT = `Você lê mensagens informais de corretores/vendedores (terrenos, ferro e aço, plástico, carros)
e extrai os dados do lead em JSON. A mensagem pode estar torta, sem formatação, com gírias.

Existem ${Object.keys(TIPOS_LEAD).length} "moldes" possíveis. Identifique qual se aplica e preencha SOMENTE os campos daquele molde:

${descreverMoldes()}

papel deve ser "comprador" ou "vendedor".
Se um campo não aparecer na mensagem, deixe null.
Sempre inclua um campo "campos_faltando": lista dos nomes de campo que ficaram null e são importantes
(nome, cidade, e os campos não opcionais do molde escolhido).

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
