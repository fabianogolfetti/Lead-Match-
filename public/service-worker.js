// service-worker.js
// Cache básico do "app shell". O HTML (navegação) é sempre buscado da rede
// primeiro — só cai pro cache se estiver offline — porque cache-first no
// index.html prende o usuário numa versão antiga da página pra sempre (o SW
// só reinstala quando o PRÓPRIO service-worker.js muda de bytes). Ícones e
// manifest, que raramente mudam, usam cache-first normalmente. Rotas de
// dados (auth, leads, IA) sempre vão pra rede, já que dependem da sessão do
// corretor logado.

const CACHE_NAME = 'leadmatch-v1';
const ASSETS_PARA_CACHE = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_PARA_CACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((chave) => chave !== CACHE_NAME).map((chave) => caches.delete(chave)))
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const ehRotaDinamica =
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/leads') ||
    url.pathname.startsWith('/processar-mensagem');
  if (ehRotaDinamica) return;

  const ehHtml = request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

  if (ehHtml) {
    event.respondWith(
      fetch(request)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
          return resposta;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (respostaCacheada) =>
        respostaCacheada ||
        fetch(request).then((resposta) => {
          const copia = resposta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
          return resposta;
        })
    )
  );
});
