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
    const {
      nome, papel, tipo, cidade, etiqueta,
      area_m2, valor_total, toneladas, preco_kg,
      comprimento_m, largura_m, mensagemOriginal,
    } = req.body;

    if (!papel || !tipo) {
      return res.status(400).json({ erro: 'papel e tipo são obrigatórios.' });
    }

    const resultado = await pool.query(
      `INSERT INTO leads
       (corretor_id, nome, papel, tipo, cidade, etiqueta, area_m2, valor_total, toneladas, preco_kg, comprimento_m, largura_m, mensagem_original, confirmado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
       RETURNING *`,
      [
        req.session.corretorId,
        nome || null,
        papel,
        tipo,
        cidade || null,
        etiqueta || null,
        area_m2 || null,
        valor_total || null,
        toneladas || null,
        preco_kg || null,
        comprimento_m || null,
        largura_m || null,
        mensagemOriginal || null,
      ]
    );

    const leadSalvo = resultado.rows[0];
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
      'SELECT * FROM leads WHERE corretor_id = $1 ORDER BY id DESC',
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
    const {
      nome, papel, tipo, cidade, etiqueta,
      area_m2, valor_total, toneladas, preco_kg,
      comprimento_m, largura_m,
    } = req.body;

    if (!papel || !tipo) {
      return res.status(400).json({ erro: 'papel e tipo são obrigatórios.' });
    }

    const resultado = await pool.query(
      `UPDATE leads SET
         nome = $1, papel = $2, tipo = $3, cidade = $4, etiqueta = $5,
         area_m2 = $6, valor_total = $7, toneladas = $8, preco_kg = $9,
         comprimento_m = $10, largura_m = $11
       WHERE id = $12 AND corretor_id = $13
       RETURNING *`,
      [
        nome || null,
        papel,
        tipo,
        cidade || null,
        etiqueta || null,
        area_m2 || null,
        valor_total || null,
        toneladas || null,
        preco_kg || null,
        comprimento_m || null,
        largura_m || null,
        req.params.id,
        req.session.corretorId,
      ]
    );

    const leadSalvo = resultado.rows[0];
    if (!leadSalvo) return res.status(404).json({ erro: 'Lead não encontrado.' });

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
