// Service worker de l'espace participant, version minimale (phase 3, F-05, NF-24 réduit). Portée : /espace/ seulement, jamais le site public.
// Il ne met en cache NI les pages de l'espace NI les appels à l'API : chaque navigation va au réseau, aucune page n'est jamais périmée.
// Seule exception, la page « hors connexion », gardée à l'installation et servie quand une navigation échoue faute de réseau.
// Les requêtes qui ne sont pas des navigations (API, scripts, images, polices) ne sont pas interceptées : le navigateur les traite seul.
const OFFLINE_CACHE = "jib-espace-hors-connexion-v1";
const OFFLINE_URL = "/espace/hors-ligne.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== OFFLINE_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
});
