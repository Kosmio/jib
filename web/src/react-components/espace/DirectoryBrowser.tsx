import React, { useEffect, useRef, useState } from "react";
import { EspaceApiError, request, type ProfileCard, type Topic } from "../../lib/espace/client";
import { plural } from "../../lib/espace/format";
import { pathTypeOf } from "../../lib/espace/meetings";
import ProfileCardView from "./ProfileCardView";

// E4 (F-40 à F-45, F-143 à F-145) : recherche temporisée de 250 ms dès 2 caractères, sélecteur de type, puces de sujets, compteur, défilement par 30.
// Le serveur filtre, trie et découpe (A-34) ; ce composant ne fait que demander la page suivante (`nextCursor`). La première page est
// rendue côté serveur (`initial`, pour les filtres lus dans l'URL) : la liste est là avant l'hydratation.
// F-45 : recherche, type et sujets vivent dans l'URL (`history.replaceState`) ; au retour d'une fiche, la position de défilement et les
// pages déjà chargées sont restaurées depuis `sessionStorage`. F-145 : l'échec d'une page suivante garde les pages chargées.

type Page = { items: ProfileCard[]; nextCursor: string | null; total: number };
type DirectoryType = "all" | "participant" | "speaker" | "exhibitor";
export type DirectoryFilters = { q: string; type: DirectoryType; topicIds: string[] };

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  topics: Topic[];
  /** Filtres lus dans l'URL par le rendu serveur (F-45). */
  filters: DirectoryFilters;
  /** Mes sujets (F-143) : ceux des cartes qui en font partie sont mis en avant. */
  myTopicIds: string[];
  /** Première page des filtres ci-dessus, ou null si le rendu serveur n'a pas pu la lire : l'îlot la demande alors au montage. */
  initial: Page | null;
};

const TYPES: { value: DirectoryType; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "participant", label: "Participants" },
  { value: "speaker", label: "Intervenants" },
  { value: "exhibitor", label: "Exposants" },
];

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/** Filtres de l'URL, assainis (F-45) : type connu, sujets parmi ceux de l'édition, recherche de 100 caractères au plus. */
export function parseFilters(params: URLSearchParams, topics: Topic[]): DirectoryFilters {
  const type = TYPES.find(({ value }) => value === params.get("type"))?.value ?? "all";
  const known = new Set(topics.map((topic) => topic.id));
  const topicIds = (params.get("topics") ?? "").split(",").filter((id) => known.has(id));
  return { q: (params.get("q") ?? "").trim().slice(0, 100), type, topicIds: [...new Set(topicIds)] };
}

/** Requête d'URL canonique des filtres (`?q=…&type=…&topics=…`, vide sans filtre) : la même pour l'URL de l'annuaire et le retour d'une fiche. */
export function filtersQuery({ q, type, topicIds }: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (q.length >= MIN_QUERY) params.set("q", q);
  if (type !== "all") params.set("type", type);
  if (topicIds.length) params.set("topics", topicIds.join(","));
  const text = params.toString();
  return text ? `?${text}` : "";
}

function pathOf(q: string, type: DirectoryType, topicIds: string[], cursor?: string | null): string {
  const params = new URLSearchParams({ type });
  if (q.length >= MIN_QUERY) params.set("q", q);
  if (topicIds.length) params.set("topics", topicIds.join(","));
  if (cursor) params.set("cursor", cursor);
  return `/directory?${params}`;
}

type Saved = { y: number; count: number };
const savedKey = (editionSlug: string, query: string) => `espace-annuaire:${editionSlug}${query}`;

function Icon({ name }: { name: "alert" | "check" | "search" }) {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d={name === "alert" ? "M12 8v5M12 16.5h.01" : "m8.5 12.5 2.5 2.5 4.5-5"} />
        </>
      )}
    </svg>
  );
}

export default function DirectoryBrowser({ strapiUrl, editionSlug, topics, filters, myTopicIds, initial }: Props) {
  const [input, setInput] = useState(filters.q);
  const [q, setQ] = useState(filters.q.length >= MIN_QUERY ? filters.q : "");
  const [type, setType] = useState<DirectoryType>(filters.type);
  const [topicIds, setTopicIds] = useState<string[]>(filters.topicIds);
  const [page, setPage] = useState<Page | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F-145 : l'échec de la page suivante a son propre message ; les pages déjà chargées restent affichées.
  const [moreError, setMoreError] = useState<string | null>(null);
  const [moreAhead, setMoreAhead] = useState(false);

  const sentinel = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const pendingScroll = useRef<number | null>(null);
  // Chaque demande porte un numéro : la réponse d'une demande dépassée est ignorée.
  const sequence = useRef(0);
  const skipFirst = useRef(initial !== null);

  const loginUrl = `/espace/${encodeURIComponent(editionSlug)}/connexion`;
  const hasFilters = q.length >= MIN_QUERY || type !== "all" || topicIds.length > 0;

  function failure(caught: unknown) {
    if (caught instanceof EspaceApiError && caught.status === 401) {
      window.location.assign(loginUrl);
      return;
    }
    setError("Le chargement a échoué. Vérifiez votre connexion et réessayez.");
  }

  const query = filtersQuery({ q, type, topicIds });

  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const result = await request<Page>(strapiUrl, pathOf(q, type, topicIds), "GET");
      if (current === sequence.current) setPage(result);
    } catch (caught) {
      if (current === sequence.current) failure(caught);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }

  async function loadMore() {
    if (!page?.nextCursor || loading || loadingMore) return;
    const current = sequence.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const result = await request<Page>(strapiUrl, pathOf(q, type, topicIds, page.nextCursor), "GET");
      if (current === sequence.current) setPage({ ...result, items: [...page.items, ...result.items] });
    } catch (caught) {
      if (current !== sequence.current) return;
      if (caught instanceof EspaceApiError && caught.status === 401) window.location.assign(loginUrl);
      else setMoreError("Les profils suivants n’ont pas pu être chargés. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoadingMore(false);
    }
  }

  // Temporisation de la saisie ; sous 2 caractères, la recherche est ignorée (F-41).
  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const effectiveQ = q.length >= MIN_QUERY ? q : "";
  const topicKey = topicIds.join(",");
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    void load();
  }, [effectiveQ, type, topicKey]);

  // F-45 : les filtres sont dans l'URL, sans entrée d'historique.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query}${window.location.hash}`);
    } catch {
      // URL non modifiable : les filtres fonctionnent quand même.
    }
  }, [query]);

  // F-45 : retour d'une fiche, les pages déjà vues sont rechargées, puis la position de défilement est rétablie.
  useEffect(() => {
    if (!initial) return;
    let saved: Saved | null = null;
    try {
      const key = savedKey(editionSlug, filtersQuery(filters));
      const raw = window.sessionStorage.getItem(key);
      window.sessionStorage.removeItem(key);
      const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
      if (parsed && Number.isFinite(parsed.y) && Number.isFinite(parsed.count)) saved = { y: Math.max(0, Number(parsed.y)), count: Number(parsed.count) };
    } catch {
      saved = null;
    }
    if (!saved) return;
    const target = saved;
    const manual = "scrollRestoration" in window.history;
    if (manual) window.history.scrollRestoration = "manual";
    const current = sequence.current;
    void (async () => {
      let items = initial.items;
      let result = initial;
      try {
        while (result.nextCursor && items.length < target.count) {
          result = await request<Page>(strapiUrl, pathOf(filters.q, filters.type, filters.topicIds, result.nextCursor), "GET");
          items = [...items, ...result.items];
        }
      } catch {
        // Pages manquantes : on rétablit ce qui est chargé, « Réessayer » reprendra la suite.
      }
      if (current !== sequence.current) return;
      pendingScroll.current = target.y;
      setPage({ ...result, items, total: result.total });
      if (items.length === initial.items.length) window.scrollTo(0, target.y);
    })();
  }, []);

  useEffect(() => {
    if (pendingScroll.current === null || !page) return;
    const y = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [page]);

  // Position retenue en ouvrant une fiche (`sessionStorage`, parfois indisponible).
  function remember() {
    try {
      const saved: Saved = { y: Math.round(window.scrollY), count: pageRef.current?.items.length ?? 0 };
      window.sessionStorage.setItem(savedKey(editionSlug, query), JSON.stringify(saved));
    } catch {
      // Stockage refusé : le retour se fait sans position.
    }
  }

  // Indice de défilement horizontal des sujets : un fondu à droite tant qu'il reste des puces à découvrir.
  function measureChips() {
    const row = chips.current;
    if (row) setMoreAhead(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
  }
  useEffect(() => {
    measureChips();
    window.addEventListener("resize", measureChips);
    return () => window.removeEventListener("resize", measureChips);
  }, [topics]);

  // Défilement par pages de 30 (F-43) : la page suivante se charge quand le bas de la liste approche, sauf après un échec (F-145).
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !page?.nextCursor || moreError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMore(), { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [page?.nextCursor, loading, loadingMore, moreError]);

  function clearFilters() {
    setInput("");
    setQ("");
    setType("all");
    setTopicIds([]);
    setMoreError(null);
    document.getElementById("recherche")?.focus();
  }

  const selectedNames = topics.filter((topic) => topicIds.includes(topic.id)).map((topic) => `« ${topic.name} »`);
  const counter = loading
    ? "Recherche en cours…"
    : page
      ? `${selectedNames.length ? `${selectedNames.length > 1 ? "Sujets" : "Sujet"} ${selectedNames.join(", ")} : ` : ""}${plural(page.total, "profil")}`
      : "";

  return (
    <div>
      <div className="sticky top-0 z-30 -mx-4 border-b border-surface-alt bg-surface px-4 pt-2 pb-3">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(input.trim());
          }}
        >
          <label htmlFor="recherche" className="sr-only">
            Rechercher un profil par nom, entreprise, fonction ou sujet
          </label>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted">
              <Icon name="search" />
            </span>
            <input
              id="recherche"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Nom, entreprise, sujet"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="min-h-12 w-full rounded-lg border-2 border-accent bg-white pr-4 pl-12 text-lg text-ink placeholder:text-muted"
            />
          </div>
        </form>

        <fieldset className="mt-3 min-w-0">
          <legend className="sr-only">Type de profil</legend>
          <div className="flex gap-1 rounded-xl border border-surface-alt bg-white p-1">
            {TYPES.map(({ value, label }) => (
              <label
                key={value}
                className={`relative flex min-h-11 flex-1 items-center justify-center rounded-lg px-1 text-center text-sm font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-title sm:text-base ${
                  type === value ? "bg-title text-white" : "text-title hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {topics.length > 0 && (
          <fieldset className="mt-3 min-w-0">
            <legend className="sr-only">Sujets</legend>
            <div
              ref={chips}
              onScroll={measureChips}
              className={`-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:flex-wrap ${
                moreAhead ? "[mask-image:linear-gradient(to_right,#000_calc(100%-3rem),transparent)] lg:[mask-image:none]" : ""
              }`}
            >
              {topics.map((topic) => {
                const checked = topicIds.includes(topic.id);
                return (
                  <label
                    key={topic.id}
                    className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-2 px-4 font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-title ${
                      checked ? "border-title bg-title text-white" : "border-accent bg-white text-title hover:bg-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setTopicIds((current) => (event.target.checked ? [...current, topic.id] : current.filter((id) => id !== topic.id)))
                      }
                      className="absolute inset-0 size-full cursor-pointer opacity-0"
                    />
                    {checked && <Icon name="check" />}
                    {topic.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>

      <p role="status" className="mt-4 text-lg text-muted empty:hidden">
        {counter}
      </p>

      {error && (
        <div role="alert" className="mt-4 rounded-xl border-2 border-danger bg-white p-4">
          <p className="flex items-start gap-2 font-semibold">
            <span className="text-danger">
              <Icon name="alert" />
            </span>
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface"
          >
            Réessayer
          </button>
        </div>
      )}

      {page && page.items.length === 0 && !loading && !error && (
        <div className="mt-4 rounded-xl border border-surface-alt bg-white p-6 text-center">
          {hasFilters ? (
            <>
              <p className="text-lg">Aucun profil ne correspond. Essayez un autre sujet ou effacez la recherche.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 inline-flex min-h-13 w-full items-center justify-center rounded-lg border-2 border-title bg-white px-6 text-lg font-bold text-title hover:bg-surface"
              >
                Effacer les filtres
              </button>
            </>
          ) : (
            <p className="text-lg">L’annuaire est vide pour le moment.</p>
          )}
        </div>
      )}

      {page && page.items.length > 0 && (
        <ul aria-busy={loading} onClickCapture={remember} className={`mt-4 space-y-3 ${loading ? "opacity-60" : ""}`}>
          {page.items.map((card) => (
            <li key={`${card.kind}:${card.id}`}>
              <ProfileCardView
                card={card}
                strapiUrl={strapiUrl}
                href={`/espace/${encodeURIComponent(editionSlug)}/annuaire/${pathTypeOf(card)}/${encodeURIComponent(card.id)}${query}`}
                myTopicIds={myTopicIds}
              />
            </li>
          ))}
        </ul>
      )}

      {moreError && (
        <div role="alert" className="mt-4 rounded-xl border-2 border-danger bg-white p-4">
          <p className="flex items-start gap-2 font-semibold">
            <span className="text-danger">
              <Icon name="alert" />
            </span>
            {moreError}
          </p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface"
          >
            Réessayer
          </button>
        </div>
      )}

      {page?.nextCursor && !moreError && (
        <div ref={sentinel} className="py-6 text-center text-muted">
          {loadingMore ? <p role="status">Chargement…</p> : null}
        </div>
      )}
    </div>
  );
}
