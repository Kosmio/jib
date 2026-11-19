import { useEffect, useRef, useState } from "react";
import { LIST_POLL_INTERVAL_MS, getConversations, listTime, type ConversationSummary } from "../../lib/espace/messages";
import { Avatar } from "./ProfileCardView";

// E7, liste des conversations (F-70, F-133) : dernier message d'abord, avatar, nom, extrait, heure, pastille de messages non lus.
// Rendue par le serveur pour le premier affichage (et sans JavaScript), puis relue toutes les 60 s onglet visible et au retour au
// premier plan ; onglet masqué, aucune requête. Un échec garde la liste affichée, la lecture suivante réessaie.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  initialConversations: ConversationSummary[];
  /** Instant du rendu serveur (ISO) : la première peinture du navigateur donne les mêmes heures que le serveur. */
  initialNow: string;
  /** La lecture du serveur a échoué : pas d'état vide tant qu'aucune relecture n'a réussi. */
  unavailable: boolean;
};

export default function ConversationList({ strapiUrl, editionSlug, initialConversations, initialNow, unavailable }: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const [loaded, setLoaded] = useState(!unavailable);
  const [now, setNow] = useState(() => new Date(initialNow));
  const busy = useRef(false);
  const base = `/espace/${encodeURIComponent(editionSlug)}`;

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      busy.current = true;
      try {
        setConversations(await getConversations(strapiUrl));
        setNow(new Date());
        setLoaded(true);
      } catch {
        // La liste affichée reste valable.
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(tick, LIST_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [strapiUrl]);

  if (conversations.length === 0) {
    if (!loaded) return null;
    return (
      <div className="mt-6 rounded-xl border border-surface-alt bg-white p-6 text-center">
        <p className="font-heading text-lg font-semibold text-title">Aucun message pour l’instant</p>
        <p className="mt-2 text-muted">Écrivez à un participant depuis sa fiche dans l’annuaire.</p>
        <a
          href={`${base}/annuaire`}
          className="mt-4 inline-flex min-h-13 w-full items-center justify-center rounded-lg border-2 border-title bg-white px-6 text-lg font-bold text-title hover:bg-surface"
        >
          Ouvrir l’annuaire
        </a>
      </div>
    );
  }

  return (
    <ul className="mt-6 space-y-3">
      {conversations.map((conversation) => {
        const unread = Number(conversation.unread) || 0;
        const { counterpart, lastMessage } = conversation;
        return (
          <li key={conversation.id}>
            <a
              href={`${base}/messages/${encodeURIComponent(conversation.id)}`}
              className="flex min-h-11 items-center gap-4 rounded-xl border border-surface-alt bg-white p-4 hover:bg-surface"
            >
              <Avatar card={counterpart} strapiUrl={strapiUrl} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-lg font-bold text-ink">{counterpart.displayName}</span>
                  <time className="shrink-0 text-sm text-muted" dateTime={lastMessage.at}>
                    {listTime(lastMessage.at, now)}
                  </time>
                </span>
                <span className={`block truncate ${unread ? "font-semibold text-ink" : "text-muted"}`}>
                  {lastMessage.mine ? "Vous : " : ""}
                  {lastMessage.excerpt}
                </span>
              </span>
              {unread > 0 && (
                <>
                  <span
                    aria-hidden="true"
                    className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-gold px-1.5 text-sm font-bold text-gold-ink"
                  >
                    {unread}
                  </span>
                  <span className="sr-only">{`, ${unread} ${unread > 1 ? "messages non lus" : "message non lu"}`}</span>
                </>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
