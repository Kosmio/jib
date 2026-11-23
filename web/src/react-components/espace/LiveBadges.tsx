// F-132, badges vivants de la barre d'onglets (AppShell). Module sans React ni JSX, par choix de poids (moins de 5 Ko compressés) :
// il agit sur le DOM rendu par le serveur. Lit GET /me (compteurs `counts`) toutes les 60 s onglet visible et à chaque retour au
// premier plan ; onglet masqué, aucune requête. Une hausse du nombre de demandes ou de messages est annoncée une fois (aria-live polie).
// Marques lues dans le DOM : `data-live-nav` (racine, `data-strapi-url`), `data-live-badge` et `data-live-sr` (`pendingReceived` ou
// `unreadMessages`), `data-live-announce` (zone d'annonce).

const INTERVAL_MS = 60_000;
type Key = "pendingReceived" | "unreadMessages";
type Counts = Record<Key, number>;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const LABELS: Record<Key, (n: number) => string> = {
  pendingReceived: (n) => plural(n, "demande reçue en attente", "demandes reçues en attente"),
  unreadMessages: (n) => plural(n, "message non lu", "messages non lus"),
};
const NEWS: Record<Key, string> = { pendingReceived: "Nouvelle demande de rendez-vous", unreadMessages: "Nouveau message" };

export function initLiveBadges(): void {
  const root = document.querySelector<HTMLElement>("[data-live-nav]");
  if (!root) return;
  const base = root.dataset.strapiUrl ?? "";
  const announce = root.querySelector<HTMLElement>("[data-live-announce]");
  const known: Counts = { pendingReceived: 0, unreadMessages: 0 };
  for (const key of Object.keys(known) as Key[]) known[key] = Number(root.querySelector(`[data-live-badge="${key}"]`)?.getAttribute("data-count")) || 0;
  let busy = false;

  const paint = (key: Key, n: number) => {
    const badge = root.querySelector<HTMLElement>(`[data-live-badge="${key}"]`);
    const sr = root.querySelector<HTMLElement>(`[data-live-sr="${key}"]`);
    if (badge) {
      badge.dataset.count = String(n);
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.toggle("hidden", n === 0);
      badge.classList.toggle("flex", n > 0);
    }
    if (sr) sr.textContent = n > 0 ? `, ${LABELS[key](n)}` : "";
  };

  const refresh = async () => {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try {
      const response = await fetch(`${base}/api/espace/me`, { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const counts = ((await response.json()) as { counts?: Partial<Counts> } | null)?.counts;
      if (!counts) return;
      const news: string[] = [];
      for (const key of Object.keys(known) as Key[]) {
        const n = Math.max(0, Number(counts[key]) || 0);
        if (n > known[key]) news.push(`${NEWS[key]}, ${LABELS[key](n)}.`);
        if (n !== known[key]) paint(key, n);
        known[key] = n;
      }
      if (announce && news.length) announce.textContent = news.join(" ");
    } catch {
      // Hors connexion : les badges affichés restent, la prochaine lecture réessaie.
    } finally {
      busy = false;
    }
  };

  window.setInterval(refresh, INTERVAL_MS);
  document.addEventListener("visibilitychange", () => void refresh());
}
