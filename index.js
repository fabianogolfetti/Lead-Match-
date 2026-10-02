// index.js
// Servidor principal do LeadMatch.
// Fluxo: 1) corretor manda o texto da mensagem -> 2) IA extrai os dados
// -> 3) corretor confirma -> 4) sistema salva uma intenção (num contato novo
// ou já existente) e sugere matches.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool, migrar } = require('./database');
const { extrairLead } = require('./extraction');
const { encontrarMatches, todosOsMatches } = require('./matching');
const { router: authRouter, exigirLogin } = require('./auth');
const {
  listarCategorias,
  garantirCategorias,
  definirCategoriasDaIntencao,
  buscarIntencaoComCategorias,
  listarIntencoesComCategorias,
} = require('./categorias');
const { DIRECOES, OPERACOES, CAMPOS_INTENCAO } = require('./categorias-config');

// identifica a versão do código rodando: hash do commit (Render define essa
// env var sozinho em produção), senão tenta o git local (dev), senão cai pro
// horário que o processo subiu — sempre algo que muda a cada deploy/restart,
// pra versionar o cache do service worker sem precisar lembrar de mexer nisso
// à mão a cada mudança (ver GET /service-worker.js abaixo).
function obterVersaoBuild() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 8);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return String(Date.now());
  }
}
const VERSAO_BUILD = obterVersaoBuild();

// erros que viram resposta 4xx com a mensagem pro corretor (o resto é 500)
class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function responderErro(res, erro) {
  if (erro instanceof ErroHttp) return res.status(erro.status).json({ erro: erro.message });
  console.error(erro);
  res.status(500).json({ erro: erro.message });
}

async function comTransacao(trabalho) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await trabalho(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

function textoOuNull(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function dataOuNull(valor) {
  const texto = textoOuNull(valor);
  if (!texto) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(texto)) throw new ErroHttp(400, 'Data inválida (use o formato AAAA-MM-DD).');
  return texto.slice(0, 10);
}

function lerNumero(valor, rotulo) {
  if (valor == null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) throw new ErroHttp(400, `${rotulo} deve ser um número maior ou igual a zero.`);
  return numero;
}

// valida e normaliza os campos da intenção (mesma regra no cadastro e na edição)
function lerCamposIntencao(body) {
  const { direcao, operacao } = body;
  if (!DIRECOES[direcao]) throw new ErroHttp(400, `direção inválida: use ${Object.keys(DIRECOES).join(' ou ')}.`);
  if (!OPERACOES[operacao]) throw new ErroHttp(400, `operação inválida: use ${Object.keys(OPERACOES).join(', ')}.`);

  const descricao = textoOuNull(body.descricao);
  if (!descricao) throw new ErroHttp(400, 'descrição é obrigatória.');

  const valorMin = lerNumero(body.valor_min, CAMPOS_INTENCAO.valor_min.label);
  const valorMax = lerNumero(body.valor_max, CAMPOS_INTENCAO.valor_max.label);
  if (valorMin != null && valorMax != null && valorMin > valorMax) {
    throw new ErroHttp(400, 'O valor mínimo não pode ser maior que o valor máximo.');
  }

  return {
    direcao,
    operacao,
    descricao,
    categoria: textoOuNull(body.categoria),
    cidade: textoOuNull(body.cidade),
    valor_min: valorMin,
    valor_max: valorMax,
  };
}

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

// serve o service worker à parte (antes do static) pra injetar VERSAO_BUILD
// no nome do cache — precisa vir antes de express.static, senão o arquivo
// estático (com o placeholder não substituído) seria servido primeiro.
app.get('/service-worker.js', (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'service-worker.js'), 'utf8', (erro, conteudo) => {
    if (erro) return res.status(500).end();
    res.type('application/javascript').send(conteudo.replaceAll('__VERSAO_BUILD__', VERSAO_BUILD));
  });
});

app.use(express.static('public'));

// Direções, operações e campos da intenção (labels, rótulos "Vendo"/"Compro"
// etc) pra o formulário se montar sozinho, sem hardcode no front.
app.get('/config-intencoes', exigirLogin, (req, res) => {
  res.json({ direcoes: DIRECOES, operacoes: OPERACOES, campos: CAMPOS_INTENCAO });
});

// Lista as etiquetas do corretor logado.
app.get('/categorias', exigirLogin, async (req, res) => {
  try {
    const categorias = await listarCategorias(req.session.corretorId);
    res.json(categorias);
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Questionário do primeiro login: palavras-chave próprias viram etiquetas
// automaticamente. "Pular" também é uma resposta válida (listas vazias), só
// marca o onboarding como concluído.
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
    responderErro(res, erro);
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
    responderErro(res, erro);
  }
});

// Contatos do corretor logado, cada um com suas intenções (e etiquetas) dentro.
app.get('/contatos', exigirLogin, async (req, res) => {
  try {
    const corretorId = req.session.corretorId;
    const [contatos, intencoes] = await Promise.all([
      pool.query('SELECT * FROM contatos WHERE corretor_id = $1 ORDER BY id DESC', [corretorId]),
      listarIntencoesComCategorias(corretorId),
    ]);

    const porContato = new Map(contatos.rows.map((contato) => [contato.id, []]));
    // intenções mais novas primeiro dentro de cada contato
    intencoes.reverse().forEach((intencao) => porContato.get(intencao.contato_id)?.push(intencao));

    res.json(contatos.rows.map((contato) => ({ ...contato, intencoes: porContato.get(contato.id) })));
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Todos os pares de intenções abertas que casam (com pontuação e motivo).
app.get('/matches', exigirLogin, async (req, res) => {
  try {
    res.json(await todosOsMatches(req.session.corretorId));
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Passo 3 e 4: corretor confirma os dados -> salva uma intenção, num contato
// existente (contatoId) ou num contato novo criado junto (nome, notas,
// proximo_contato), na mesma transação -> já retorna os matches (só entre
// intenções do próprio corretor).
app.post('/intencoes', exigirLogin, async (req, res) => {
  try {
    const corretorId = req.session.corretorId;
    const campos = lerCamposIntencao(req.body);
    const { contatoId, nome, notas, proximo_contato: proximoContato, mensagemOriginal, categorias } = req.body;

    if (!contatoId && !textoOuNull(nome)) throw new ErroHttp(400, 'nome do contato é obrigatório.');

    const intencaoId = await comTransacao(async (client) => {
      let idContato = contatoId;
      if (idContato) {
        const existente = await client.query('SELECT id FROM contatos WHERE id = $1 AND corretor_id = $2', [idContato, corretorId]);
        if (!existente.rows[0]) throw new ErroHttp(404, 'Contato não encontrado.');
      } else {
        const novo = await client.query(
          'INSERT INTO contatos (corretor_id, nome, notas, proximo_contato) VALUES ($1, $2, $3, $4) RETURNING id',
          [corretorId, textoOuNull(nome), textoOuNull(notas), dataOuNull(proximoContato)]
        );
        idContato = novo.rows[0].id;
      }

      const inserida = await client.query(
        `INSERT INTO intencoes
           (contato_id, corretor_id, direcao, operacao, categoria, descricao, cidade, valor_min, valor_max, mensagem_original)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          idContato, corretorId, campos.direcao, campos.operacao, campos.categoria, campos.descricao,
          campos.cidade, campos.valor_min, campos.valor_max, textoOuNull(mensagemOriginal),
        ]
      );

      const ids = Array.isArray(categorias) && categorias.length ? await garantirCategorias(corretorId, categorias, client) : [];
      await definirCategoriasDaIntencao(inserida.rows[0].id, ids, client);
      return inserida.rows[0].id;
    });

    const intencao = await buscarIntencaoComCategorias(intencaoId);
    const contato = (await pool.query('SELECT * FROM contatos WHERE id = $1', [intencao.contato_id])).rows[0];
    const matches = await encontrarMatches(intencao);
    res.json({ contato, intencao, matches });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Edição de uma intenção já salva, com a mesma validação do cadastro.
app.put('/intencoes/:id', exigirLogin, async (req, res) => {
  try {
    const corretorId = req.session.corretorId;
    const campos = lerCamposIntencao(req.body);
    const { categorias } = req.body;

    const intencaoId = await comTransacao(async (client) => {
      const atualizada = await client.query(
        `UPDATE intencoes
         SET direcao = $1, operacao = $2, categoria = $3, descricao = $4, cidade = $5,
             valor_min = $6, valor_max = $7, atualizado_em = now()
         WHERE id = $8 AND corretor_id = $9 RETURNING id`,
        [
          campos.direcao, campos.operacao, campos.categoria, campos.descricao, campos.cidade,
          campos.valor_min, campos.valor_max, req.params.id, corretorId,
        ]
      );
      if (!atualizada.rows[0]) throw new ErroHttp(404, 'Intenção não encontrada.');

      const ids = Array.isArray(categorias) && categorias.length ? await garantirCategorias(corretorId, categorias, client) : [];
      await definirCategoriasDaIntencao(atualizada.rows[0].id, ids, client);
      return atualizada.rows[0].id;
    });

    const intencao = await buscarIntencaoComCategorias(intencaoId);
    const matches = await encontrarMatches(intencao);
    res.json({ intencao, matches });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Marca uma intenção como fechada: some das buscas de match, mas continua no histórico.
app.post('/intencoes/:id/fechar', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query(
      "UPDATE intencoes SET status = 'fechado', fechado_em = now() WHERE id = $1 AND corretor_id = $2 RETURNING id",
      [req.params.id, req.session.corretorId]
    );
    if (!resultado.rows[0]) throw new ErroHttp(404, 'Intenção não encontrada.');
    res.json({ intencao: await buscarIntencaoComCategorias(resultado.rows[0].id) });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.delete('/intencoes/:id', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query('DELETE FROM intencoes WHERE id = $1 AND corretor_id = $2', [
      req.params.id,
      req.session.corretorId,
    ]);
    if (resultado.rowCount === 0) throw new ErroHttp(404, 'Intenção não encontrada.');
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Dados da pessoa (nome, notas, próximo contato) — as intenções têm rotas próprias.
app.put('/contatos/:id', exigirLogin, async (req, res) => {
  try {
    const nome = textoOuNull(req.body.nome);
    if (!nome) throw new ErroHttp(400, 'nome do contato é obrigatório.');

    const resultado = await pool.query(
      `UPDATE contatos SET nome = $1, notas = $2, proximo_contato = $3, atualizado_em = now()
       WHERE id = $4 AND corretor_id = $5 RETURNING *`,
      [nome, textoOuNull(req.body.notas), dataOuNull(req.body.proximo_contato), req.params.id, req.session.corretorId]
    );
    if (!resultado.rows[0]) throw new ErroHttp(404, 'Contato não encontrado.');
    res.json({ contato: resultado.rows[0] });
  } catch (erro) {
    responderErro(res, erro);
  }
});

// Apaga o contato e, junto (ON DELETE CASCADE), todas as intenções dele.
app.delete('/contatos/:id', exigirLogin, async (req, res) => {
  try {
    const resultado = await pool.query('DELETE FROM contatos WHERE id = $1 AND corretor_id = $2', [
      req.params.id,
      req.session.corretorId,
    ]);
    if (resultado.rowCount === 0) throw new ErroHttp(404, 'Contato não encontrado.');
    res.json({ ok: true });
  } catch (erro) {
    responderErro(res, erro);
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
