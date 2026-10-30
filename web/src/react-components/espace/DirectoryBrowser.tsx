import React, { useEffect, useRef, useState } from "react";
import { EspaceApiError, request, type ProfileCard, type Topic } from "../../lib/espace/client";
import { plural } from "../../lib/espace/format";
import ProfileCardView from "./ProfileCardView";

// E4 (F-40 à F-44) : recherche temporisée de 250 ms dès 2 caractères, sélecteur de type, puces de sujets, compteur, défilement par 30.
// Le serveur filtre, trie et découpe (A-34) ; ce composant ne fait que demander la page suivante (`nextCursor`). La première page est
// rendue côté serveur (`initial`) : la liste est là avant l'hydratation.

type Page = { items: ProfileCard[]; nextCursor: string | null; total: number };
type DirectoryType = "all" | "participant" | "speaker" | "exhibitor";

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  topics: Topic[];
  /** Première page sans filtre, ou null si le rendu serveur n'a pas pu la lire : l'îlot la demande alors au montage. */
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

function pathOf(q: string, type: DirectoryType, topicIds: string[], cursor?: string | null): string {
  const params = new URLSearchParams({ type });
  if (q.length >= MIN_QUERY) params.set("q", q);
  if (topicIds.length) params.set("topics", topicIds.join(","));
  if (cursor) params.set("cursor", cursor);
  return `/directory?${params}`;
}

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

export default function DirectoryBrowser({ strapiUrl, editionSlug, topics, initial }: Props) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState<DirectoryType>("all");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [page, setPage] = useState<Page | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinel = useRef<HTMLDivElement>(null);
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

  async function load() {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
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
    setError(null);
    try {
      const result = await request<Page>(strapiUrl, pathOf(q, type, topicIds, page.nextCursor), "GET");
      if (current === sequence.current) setPage({ ...result, items: [...page.items, ...result.items] });
    } catch (caught) {
      if (current === sequence.current) failure(caught);
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

  // Défilement par pages de 30 (F-43) : la page suivante se charge quand le bas de la liste approche.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !page?.nextCursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMore(), { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [page?.nextCursor, loading, loadingMore]);

  function clearFilters() {
    setInput("");
    setQ("");
    setType("all");
    setTopicIds([]);
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
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:flex-wrap">
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
        <ul aria-busy={loading} className={`mt-4 space-y-3 ${loading ? "opacity-60" : ""}`}>
          {page.items.map((card) => (
            <li key={`${card.kind}:${card.id}`}>
              <ProfileCardView
                card={card}
                strapiUrl={strapiUrl}
                href={`/espace/${encodeURIComponent(editionSlug)}/annuaire/${card.kind === "exhibitor" ? "x" : "p"}/${encodeURIComponent(card.id)}`}
              />
            </li>
          ))}
        </ul>
      )}

      {page?.nextCursor && (
        <div ref={sentinel} className="py-6 text-center text-muted">
          {loadingMore ? <p role="status">Chargement…</p> : null}
        </div>
      )}
    </div>
  );
}
