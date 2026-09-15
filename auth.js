// auth.js
// Cadastro/login de corretores por e-mail + senha. Cada corretor só enxerga
// e recebe match dos próprios leads (ver corretor_id em index.js e matching.js).
// "nome" é só informação de exibição, sem validação especial.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

const router = express.Router();

// formato simples: algo@algo.algo, sem espaço — cobre "tem @ e domínio"
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// mínimo 8 caracteres, pelo menos 1 maiúscula e 1 número
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

function emailValido(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

function senhaValida(senha) {
  return typeof senha === 'string' && SENHA_REGEX.test(senha);
}

router.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'nome, email e senha são obrigatórios.' });
    }

    const emailNormalizado = email.trim().toLowerCase();
    if (!emailValido(emailNormalizado)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido (com @ e domínio, ex: nome@exemplo.com).' });
    }
    if (!senhaValida(senha)) {
      return res
        .status(400)
        .json({ erro: 'A senha precisa ter no mínimo 8 caracteres, com pelo menos 1 letra maiúscula e 1 número.' });
    }

    const existente = await pool.query('SELECT id FROM corretores WHERE email = $1', [emailNormalizado]);
    if (existente.rows.length) {
      return res.status(400).json({ erro: 'Já existe uma conta cadastrada com esse e-mail.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const resultado = await pool.query(
      'INSERT INTO corretores (nome, email, senha) VALUES ($1, $2, $3) RETURNING id, onboarding_concluido',
      [nome, emailNormalizado, senhaHash]
    );

    req.session.corretorId = resultado.rows[0].id;
    req.session.corretorNome = nome;
    req.session.onboardingConcluido = resultado.rows[0].onboarding_concluido;
    res.json({ id: resultado.rows[0].id, nome, onboardingConcluido: resultado.rows[0].onboarding_concluido });
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(400).json({ erro: 'Já existe uma conta cadastrada com esse e-mail.' });
    }
    console.error(erro);
    res.status(500).json({ erro: erro.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ erro: 'email e senha são obrigatórios.' });
    }

    const emailNormalizado = email.trim().toLowerCase();
    if (!emailValido(emailNormalizado)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido (com @ e domínio, ex: nome@exemplo.com).' });
    }

    const resultado = await pool.query('SELECT * FROM corretores WHERE email = $1', [emailNormalizado]);
    const corretor = resultado.rows[0];
    const senhaOk = corretor && (await bcrypt.compare(senha, corretor.senha));
    if (!senhaOk) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    req.session.corretorId = corretor.id;
    req.session.corretorNome = corretor.nome;
    req.session.onboardingConcluido = corretor.onboarding_concluido;
    res.json({ id: corretor.id, nome: corretor.nome, onboardingConcluido: corretor.onboarding_concluido });
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
  res.json({
    logado: true,
    id: req.session.corretorId,
    nome: req.session.corretorNome,
    onboardingConcluido: !!req.session.onboardingConcluido,
  });
});

function exigirLogin(req, res, next) {
  if (!req.session.corretorId) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login.' });
  }
  next();
}

module.exports = { router, exigirLogin };
