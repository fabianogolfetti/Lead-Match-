// index.js
// Servidor principal do LeadMatch.
// Fluxo: 1) corretor manda o texto da mensagem -> 2) IA extrai os dados
// -> 3) corretor confirma -> 4) sistema salva e sugere matches.

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool, migrar } = require('./database');
const { extrairLead } = require('./extraction');
const { encontrarMatches } = require('./matching');
const { router: authRouter, exigirLogin } = require('./auth');
const {
  listarCategorias,
  garantirCategorias,
  definirCategoriasDoLead,
  buscarLeadComCategorias,
} = require('./categorias');
const { TIPOS_LEAD } = require('./categorias-config');

// todos os campos específicos de qualquer tipo, sem repetir (ex: "preco_kg"
// aparece em mais de um tipo) — usado pra montar o INSERT/UPDATE de leads
// sem precisar listar campo por campo aqui.
const CAMPOS_ESPECIFICOS = [
  ...new Set(Object.values(TIPOS_LEAD).flatMap((definicao) => Object.keys(definicao.campos))),
];

const app = express();
app.use(express.json());
app.use(
  session({
    // mesmo pool do resto do app: sessão sobrevive a restart/deploy (antes
    // era MemoryStore, que zerava e deslogava todo mundo a cada reinício)
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'leadmatch-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.use('/auth', authRouter);
app.use(express.static('public'));

// Descreve os tipos de lead disponíveis (campos, labels, campo de valor) pra
// o formulário se montar sozinho, sem hardcode no front.
app.get('/tipos-lead', exigirLogin, (req, res) => {
  res.json(TIPOS_LEAD);
});

// Lista as categorias (etiquetas) do corretor logado.
app.get('/categorias', exigirLogin, async (req, res) => {
  try {
    const categorias = await listarCategorias(req.session.corretorId);
    res.json(categorias);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Questionário do primeiro login: moldes que o corretor trabalha + palavras-chave
// próprias viram categorias automaticamente. "Pular" também é uma resposta válida
// (moldes e palavrasChave vazios), só marca o onboarding como concluído.
app.post('/onboarding', exigirLogin, async (req, res) => {
  try {
    const { moldes, palavrasChave } = req.body;
    const nomes = [...(Array.isArray(moldes) ? moldes : []), ...(Array.isArray(palavrasChave) ? palavrasChave : [])];

    if (nomes.length) {
      await garantirCategorias(req.session.corretorId, nomes);
    }
    await pool.query('UPDATE corretores SET onboarding_concluido = true WHERE id = $1', [req.session.corretorId]);
    req.session.onboardingConcluido = true;

    const categorias = await listarCategorias(req.session.corretorId);
    res.json({ ok: true, categorias });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Passo 2: recebe o texto solto da mensagem e devolve os dados já organizados
// pela IA, junto com a lista de campos que ficaram faltando.
app.post('/processar-mensagem', exigirLogin, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ erro: 'Envie o campo "texto" com a mensagem.' });

    const dadosExtraidos = await extrairLead(texto);
    res.json({ dadosExtraidos, mensagemOriginal: texto });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Passo 3 e 4: corretor confirma os dados (já revisados/corrigidos por ele
// se precisou) -> salva no banco como confirmado, associado a ele -> já
// retorna os matches (só entre leads do próprio corretor).
app.post('/leads', exigirLogin, async (req, res) => {
  try {
    const { nome, papel, tipo, cidade, mensagemOriginal, categorias } = req.body;

    if (!papel || !tipo) {
      return res.status(400).json({ erro: 'papel e tipo são obrigatórios.' });
    }
    if (!String(req.body.descricao ?? '').trim()) {
      return res.status(400).json({ erro: 'descrição é obrigatória.' });
    }

    const colunas = ['corretor_id', 'nome', 'papel', 'tipo', 'cidade', ...CAMPOS_ESPECIFICOS, 'mensagem_original', 'confirmado'];
    const valores = [
      req.session.corretorId,
      nome || null,
      papel,
      tipo,
      cidade || null,
      ...CAMPOS_ESPECIFICOS.map((campo) => req.body[campo] ?? null),
      mensagemOriginal || null,
      1,
    ];
    const marcadores = valores.map((_, i) => `$${i + 1}`).join(', ');

    const resultado = await pool.query(
      `INSERT INTO leads (${colunas.join(', ')}) VALUES (${marcadores}) RETURNING *`,
      valores
    );

    const leadId = resultado.rows[0].id;
    if (Array.isArray(categorias) && categorias.length) {
      const ids = await garantirCategorias(req.session.corretorId, categorias);
      await definirCategoriasDoLead(leadId, ids);
    }

    const leadSalvo = await buscarLeadComCategorias(leadId);
    const matches = await encontrarMatches(leadSalvo);

    res.json({ lead: leadSalvo, matches });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Lista os leads do corretor logado (útil pra conferir o que já foi cadastrado)
app.get('/leads', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT l.*, COALESCE(array_agg(c.nome ORDER BY c.nome) FILTER (WHERE c.nome IS NOT NULL), '{}') AS categorias
       FROM leads l
       LEFT JOIN lead_categorias lc ON lc.lead_id = l.id
       LEFT JOIN categorias c ON c.id = lc.categoria_id
       WHERE l.corretor_id = $1
       GROUP BY l.id
       ORDER BY l.id DESC`,
      [req.session.corretorId]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Busca matches sob demanda pra um lead já salvo (tela "Meus leads").
app.get('/leads/:id/matches', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM leads WHERE id = $1 AND corretor_id = $2',
      [req.params.id, req.session.corretorId]
    );
    const lead = resultado.rows[0];
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado.' });

    const matches = await encontrarMatches(lead);
    res.json({ matches });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Edição de um lead já salvo, reaproveitando a mesma validação/formato do cadastro.
app.put('/leads/:id', exigirLogin, async (req, res) => {
  try {
    const { nome, papel, tipo, cidade, categorias } = req.body;

    if (!papel || !tipo) {
      return res.status(400).json({ erro: 'papel e tipo são obrigatórios.' });
    }
    if (!String(req.body.descricao ?? '').trim()) {
      return res.status(400).json({ erro: 'descrição é obrigatória.' });
    }

    // sempre grava todos os campos específicos (não só os do tipo atual):
    // se o lead mudou de tipo na edição, os campos do tipo antigo (que não
    // vêm mais no payload) precisam mesmo ser zerados, não ficar esquecidos.
    const colunas = ['nome', 'papel', 'tipo', 'cidade', ...CAMPOS_ESPECIFICOS];
    const valores = [
      nome || null,
      papel,
      tipo,
      cidade || null,
      ...CAMPOS_ESPECIFICOS.map((campo) => req.body[campo] ?? null),
    ];
    const setSql = colunas.map((coluna, i) => `${coluna} = $${i + 1}`).join(', ');

    const resultado = await pool.query(
      `UPDATE leads SET ${setSql} WHERE id = $${valores.length + 1} AND corretor_id = $${valores.length + 2} RETURNING id`,
      [...valores, req.params.id, req.session.corretorId]
    );

    if (!resultado.rows[0]) return res.status(404).json({ erro: 'Lead não encontrado.' });
    const leadId = resultado.rows[0].id;

    const ids = Array.isArray(categorias) && categorias.length
      ? await garantirCategorias(req.session.corretorId, categorias)
      : [];
    await definirCategoriasDoLead(leadId, ids);

    const leadSalvo = await buscarLeadComCategorias(leadId);
    const matches = await encontrarMatches(leadSalvo);
    res.json({ lead: leadSalvo, matches });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

// Marca um lead como fechado: some das buscas de match, mas continua no histórico.
app.post('/leads/:id/fechar', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query(
      "UPDATE leads SET status = 'fechado' WHERE id = $1 AND corretor_id = $2 RETURNING *",
      [req.params.id, req.session.corretorId]
    );

    const lead = resultado.rows[0];
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado.' });
    res.json({ lead });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

app.delete('/leads/:id', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND corretor_id = $2',
      [req.params.id, req.session.corretorId]
    );

    if (resultado.rowCount === 0) return res.status(404).json({ erro: 'Lead não encontrado.' });
    res.json({ ok: true });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

const PORTA = process.env.PORT || 3000;

migrar()
  .then(() => {
    app.listen(PORTA, () => {
      console.log(`LeadMatch rodando em http://localhost:${PORTA}`);
    });
  })
  .catch((erro) => {
    console.error('Não foi possível preparar o banco de dados:', erro);
    process.exit(1);
  });
