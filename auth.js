// auth.js
// Cadastro/login simples de corretores. Cada corretor só enxerga e recebe
// match dos próprios leads (ver corretor_id em index.js e matching.js).

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

const router = express.Router();

router.post('/cadastro', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    if (!nome || !senha) {
      return res.status(400).json({ erro: 'nome e senha são obrigatórios.' });
    }

    const existente = await pool.query('SELECT id FROM corretores WHERE nome = $1', [nome]);
    if (existente.rows.length) {
      return res.status(400).json({ erro: 'Já existe um corretor cadastrado com esse nome.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const resultado = await pool.query(
      'INSERT INTO corretores (nome, senha) VALUES ($1, $2) RETURNING id',
      [nome, senhaHash]
    );

    req.session.corretorId = resultado.rows[0].id;
    req.session.corretorNome = nome;
    res.json({ id: resultado.rows[0].id, nome });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    if (!nome || !senha) {
      return res.status(400).json({ erro: 'nome e senha são obrigatórios.' });
    }

    const resultado = await pool.query('SELECT * FROM corretores WHERE nome = $1', [nome]);
    const corretor = resultado.rows[0];
    const senhaOk = corretor && (await bcrypt.compare(senha, corretor.senha));
    if (!senhaOk) {
      return res.status(401).json({ erro: 'Nome ou senha incorretos.' });
    }

    req.session.corretorId = corretor.id;
    req.session.corretorNome = corretor.nome;
    res.json({ id: corretor.id, nome: corretor.nome });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.corretorId) return res.json({ logado: false });
  res.json({ logado: true, id: req.session.corretorId, nome: req.session.corretorNome });
});

function exigirLogin(req, res, next) {
  if (!req.session.corretorId) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login.' });
  }
  next();
}

module.exports = { router, exigirLogin };
