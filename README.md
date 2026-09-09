# LeadMatch

Esqueleto inicial (Fase 1) da plataforma de captação e match de leads
(compradores/vendedores de terreno, ferro em lote e estrutura metálica),
com a IA extraindo os dados automaticamente a partir da mensagem de texto.

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
   Na primeira vez, ele cria sozinho as tabelas `corretores`, `leads` e
   `session` (sessão de login) no Postgres apontado por `DATABASE_URL`
   (ver `migrar()` em `database.js` e o `store` em `index.js`).

4. Abra `http://localhost:3000` no navegador. Cole uma mensagem de teste,
   clique em "Processar mensagem", confira os dados que a IA extraiu,
   ajuste se precisar, e clique em "Confirmar lead". Se já tiver outro
   lead do papel oposto (comprador/vendedor) na mesma cidade e tipo,
   o match aparece na hora.

## Estrutura do projeto

- `index.js` — servidor Express, junta tudo (rotas)
- `database.js` — conecta no Postgres (`pg`) e cria as tabelas se não existirem
- `auth.js` — cadastro/login/logout de corretor
- `extraction.js` — chama a IA pra ler a mensagem e extrair os dados
- `matching.js` — procura e ordena os leads compatíveis
- `public/index.html` — página simples pra testar o fluxo completo

## O que falta pra virar produto de verdade

- Conectar de verdade no WhatsApp (hoje o teste é colando o texto manualmente
  na página; o próximo passo é receber a mensagem direto pela API oficial
  do WhatsApp da Meta)
