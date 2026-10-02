# LeadMatch

Plataforma de captação e match de leads pra corretores e comerciantes que
negociam por mensagem de texto (imóveis, galpões, ferro e aço, sucata...),
com a IA extraindo os dados automaticamente.

Cada **contato** (a pessoa) pode ter várias **intenções**: "tenho X" ou
"procuro X", numa operação (venda, locação...), com categoria, cidade e uma
faixa de valor (`valor_min`/`valor_max`, aceita só um dos dois preenchido).
O match cruza intenções de direção oposta, mesma operação, categoria
compatível (com um dicionário pequeno de sinônimos) e cidade — ver
`categorias-config.js` e `matching.js`.

## Como rodar

1. Instale as dependências:
   ```
   npm install
   ```

2. Copie o arquivo de variáveis de ambiente:
   ```
   cp .env.example .env
   ```
   Depois edite o `.env`:
   - `ANTHROPIC_API_KEY`: pega em https://console.anthropic.com (chave secreta,
     guardada só no servidor, nunca no código).
   - `DATABASE_URL`: string de conexão de um Postgres. Pra dev local, pode ser
     um Postgres na sua máquina ou um banco free de algum provedor (ex. Neon).
     Em produção no Render, use a "Internal Database URL" do Postgres do projeto.

3. Rode o servidor:
   ```
   npm start
   ```
   Na primeira vez, ele cria sozinho as tabelas (`corretores`, `contatos`,
   `intencoes`, `categorias`, `session`...) no Postgres apontado por
   `DATABASE_URL` (ver `migrar()` em `database.js`). Se já existirem leads de
   uma versão anterior do app (tabela `leads`, modelo antigo de 1 lead = 1
   pessoa com 1 papel/valor), a mesma subida migra cada um pra 1 contato + 1
   intenção, sem apagar a tabela antiga — ver `migrarLeadsLegados()`.

4. Abra `http://localhost:3000` no navegador. Cole uma mensagem de teste,
   clique em "Processar mensagem", confira os dados que a IA extraiu,
   ajuste se precisar, e clique em "Confirmar". Se já tiver outra intenção de
   direção oposta (tenho/procuro) na mesma operação, categoria e cidade
   compatíveis, o match aparece na hora, com pontuação e explicação.

## Estrutura do projeto

- `index.js` — servidor Express, junta tudo (rotas)
- `database.js` — conecta no Postgres (`pg`), cria as tabelas e migra leads antigos
- `auth.js` — cadastro/login/logout de corretor
- `categorias-config.js` — direções, operações e campos de uma intenção (fonte única)
- `categorias.js` — etiquetas livres por corretor
- `extraction.js` — chama a IA pra ler a mensagem e extrair os dados de uma intenção
- `matching.js` — cruza intenções compatíveis e pontua o match
- `public/index.html` — página (PWA) com o fluxo completo: contatos, intenções, matches

## O que falta pra virar produto de verdade

- Conectar de verdade no WhatsApp (hoje o teste é colando o texto manualmente
  na página; o próximo passo é receber a mensagem direto pela API oficial
  do WhatsApp da Meta)
