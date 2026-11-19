// Service worker de l'espace participant (NF-24, F-131). Portée : /espace/ seulement, jamais le site public.
// - Pages gardées : accueil, agenda, programme et liste des messages de l'édition. Réseau d'abord, délai de 4 s, puis repli sur la dernière
//   copie réussie. Une copie servie porte `data-hors-ligne="<ISO>"` sur <html> (le gabarit en tire le bandeau et désactive les actions).
// - Fichiers statiques de l'espace (feuilles, scripts, polices, icônes) : copie d'abord, remplie au passage.
// - Jamais de copie de l'API Strapi ni d'une autre page. Les en-têtes no-store des réponses ne changent pas : la copie est faite ici, dans
//   Cache Storage. Les copies de pages sont propres à l'édition et expirent 48 h après la date de l'événement.
const STATIC_CACHE = "jib-espace-v2-statique";
const PAGES_PREFIX = "jib-espace-v2-ed-";
const OFFLINE_URL = "/espace/hors-ligne.html";
const NETWORK_TIMEOUT_MS = 4000;
const EXPIRY_AFTER_EVENT_MS = 48 * 3600 * 1000;
const EXPIRY_WITHOUT_DATE_MS = 14 * 24 * 3600 * 1000;

const PAGE_RE = /^\/espace\/([^/]+)\/(?:agenda|programme|messages)?\/?$/;
const STATIC_RE = /^\/(?:_astro\/|fonts\/|assets\/favicon-192\.png$|favicon\.png$|espace\/icon-)/;
const RESERVED = ["verifier", "introuvable", "erreur", "hors-ligne.html", "sw.js"];

const pageKey = (url) => new URL(url.pathname.replace(/(.)\/$/, "$1"), url.origin).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

// Version suivante : tout cache `jib-espace` d'une autre version (dont l'ancien « hors-connexion-v1 ») disparaît.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith("jib-espace") && n !== STATIC_CACHE && !n.startsWith(PAGES_PREFIX)).map((n) => caches.delete(n))),
      )
      .then(purgeExpired)
      .then(() => self.clients.claim()),
  );
});

async function purgeExpired() {
  const now = Date.now();
  for (const name of await caches.keys()) {
    if (!name.startsWith(PAGES_PREFIX)) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response || Number(response.headers.get("X-Espace-Expire")) < now) await cache.delete(request);
    }
  }
}

async function storePage(cache, key, response) {
  const html = await response.text();
  const date = /<meta name="espace-date" content="(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1];
  const now = Date.now();
  const expire = date ? Date.parse(`${date}T00:00:00Z`) + EXPIRY_AFTER_EVENT_MS : now + EXPIRY_WITHOUT_DATE_MS;
  const headers = new Headers({ "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8" });
  headers.set("X-Espace-Copie", String(now));
  headers.set("X-Espace-Expire", String(expire));
  await cache.put(key, new Response(html, { status: 200, headers }));
}

async function cachedPage(cache, key) {
  const copy = await cache.match(key);
  if (!copy) return null;
  if (Number(copy.headers.get("X-Espace-Expire")) < Date.now()) {
    await cache.delete(key);
    return null;
  }
  const stamp = new Date(Number(copy.headers.get("X-Espace-Copie"))).toISOString();
  const html = (await copy.text()).replace("<html ", `<html data-hors-ligne="${stamp}" `);
  return new Response(html, { status: 200, headers: { "Content-Type": copy.headers.get("Content-Type") } });
}

function handlePage(event, url, edition) {
  const request = event.request;
  const key = pageKey(url);
  const cacheName = PAGES_PREFIX + edition;
  const network = fetch(request).then(async (response) => {
    // Seule une réponse 200 sans redirection est gardée : la redirection vers la connexion (session finie) n'écrase rien.
    if (response.status === 200 && !response.redirected) {
      const cache = await caches.open(cacheName);
      await storePage(cache, key, response.clone());
    }
    if (response.status >= 500) throw new Error("indisponible");
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => null), timeout]).then(async (winner) => {
    if (winner) return winner;
    const copy = await cachedPage(await caches.open(cacheName), key);
    if (copy) return copy;
    // Pas de copie : si le réseau n'a pas encore répondu on l'attend, sinon page hors connexion.
    return network.catch(() => caches.match(OFFLINE_URL));
  });
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (!url.pathname.startsWith("/espace/")) return;
    const match = PAGE_RE.exec(url.pathname);
    const edition = match && !RESERVED.includes(match[1]) ? match[1] : null;
    if (edition) {
      event.respondWith(handlePage(event, url, edition));
    } else {
      event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    }
    return;
  }
  if (STATIC_RE.test(url.pathname)) event.respondWith(handleStatic(request));
});
