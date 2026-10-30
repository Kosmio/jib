import React, { useCallback, useEffect, useRef, useState } from "react";
import { EspaceApiError, type ProfileCard } from "../../lib/espace/client";
import { timeLabel } from "../../lib/espace/format";
import {
  MESSAGE_COUNTER_FROM,
  MESSAGE_MAX_LENGTH,
  POLL_INTERVAL_MS,
  dayHeading,
  getThread,
  messageDay,
  openConversation,
  postMessage,
  type LinkedMeeting,
  type ThreadMessage,
} from "../../lib/espace/messages";
import { Avatar } from "./ProfileCardView";

// E7, fil d'une conversation (F-70 à F-72, A-37) : en-tête (retour, interlocuteur), bandeau du rendez-vous lié, bulles envoyées à droite
// et reçues à gauche, horodatage, « Lu », zone de saisie. L'îlot est rendu par le serveur : en-tête et messages sont là sans JavaScript.
// Le fil est rendu par le serveur (messages initiaux) puis interrogé toutes les 20 s, sauf onglet masqué (F-71, NF-23).
// Sans `conversationId`, la conversation n'existe pas encore : elle est créée au premier envoi, puis la page du fil s'ouvre (A-37).

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  conversationId: string | null;
  /** `p:{id}` quand la conversation reste à créer. */
  target: string | null;
  counterpart: ProfileCard;
  initialMeeting: LinkedMeeting | null;
  initialMessages: ThreadMessage[];
  initialGetsEmail: boolean;
};

const SEND_FAILED = "Le message n’a pas pu être envoyé. Vérifiez votre connexion et réessayez.";

/** Le bas de la page est visible, à quelques lignes près : un nouveau message fait alors défiler le fil. */
const isNearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
const scrollToBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight });

function Icon({ name }: { name: "send" | "mail" | "alert" | "back" | "calendar" }) {
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
      {name === "send" && <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" />}
      {name === "mail" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </>
      )}
      {name === "alert" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5h.01" />
        </>
      )}
      {name === "back" && <path d="m15 6-6 6 6 6" />}
      {name === "calendar" && (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4m-7.5 9.5 2 2 4-4" />
        </>
      )}
    </svg>
  );
}

export default function ChatThread({
  strapiUrl,
  editionSlug,
  conversationId,
  target,
  counterpart,
  initialMeeting,
  initialMessages,
  initialGetsEmail,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [meeting, setMeeting] = useState(initialMeeting);
  const [getsEmail, setGetsEmail] = useState(initialGetsEmail);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const stickToBottom = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);

  const base = `/espace/${encodeURIComponent(editionSlug)}`;
  const loginUrl = `${base}/connexion`;
  const firstName = counterpart.displayName.split(" ")[0];

  // Ouverture du fil, nouveau message reçu ou envoyé : on suit le dernier message, sauf si la personne a remonté dans le fil.
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages]);

  const refresh = useCallback(async () => {
    if (!conversationId || inFlight.current) return;
    inFlight.current = true;
    try {
      const thread = await getThread(strapiUrl, conversationId);
      stickToBottom.current = isNearBottom();
      setMessages(thread.messages);
      setMeeting(thread.conversation.meeting);
      setGetsEmail(thread.conversation.counterpartGetsEmail);
    } catch (failure) {
      if (failure instanceof EspaceApiError && failure.status === 401) window.location.assign(loginUrl);
      // Autre échec : le fil affiché reste valable, la prochaine interrogation réessaie.
    } finally {
      inFlight.current = false;
    }
  }, [strapiUrl, conversationId, loginUrl]);

  // F-71 : une interrogation toutes les 20 s tant que l'onglet est visible ; à son retour, une interrogation immédiate.
  useEffect(() => {
    if (!conversationId) return;
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [conversationId, refresh]);

  const resize = () => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);

    try {
      const id = conversationId ?? (target ? (await openConversation(strapiUrl, target)).id : null);
      if (!id) throw new EspaceApiError(0, "NO_TARGET", "");
      const message = await postMessage(strapiUrl, id, body);
      if (!conversationId) {
        window.location.assign(`${base}/messages/${encodeURIComponent(id)}`);
        return;
      }
      stickToBottom.current = true;
      setMessages((current) => (current.some(({ id: known }) => known === message.id) ? current : [...current, message]));
      setDraft("");
      setSending(false);
      requestAnimationFrame(() => {
        resize();
        field.current?.focus();
      });
    } catch (failure) {
      setSending(false);
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      const text = failure instanceof EspaceApiError && failure.status !== 0 ? failure.fields.body || failure.message : "";
      setError(text || SEND_FAILED);
      field.current?.focus();
    }
  }

  const length = draft.length;
  const canSend = draft.trim().length > 0 && !sending;

  const profileHref = `${base}/annuaire/${counterpart.kind === "exhibitor" ? "x" : "p"}/${encodeURIComponent(counterpart.id)}`;
  const place = meeting?.location ? `, ${meeting.location.charAt(0).toLowerCase()}${meeting.location.slice(1)}` : "";

  // Les marges négatives rendent à la colonne la place que `AppShell` réserve sous le contenu (32 px sur mobile, 48 px dès 1024 px) :
  // sans elles, la zone de saisie collante, arrêtée au bas de la colonne, remonterait de cette hauteur en fin de page.
  return (
    <div className="-mb-8 flex flex-col lg:-mb-12">
      <header className="sticky top-0 z-20 border-b border-surface-alt bg-white">
        <h1 className="sr-only">Conversation avec {counterpart.displayName}</h1>
        <div className="mx-auto flex max-w-180 items-center gap-2 px-2 py-2">
          <a href={`${base}/messages`} className="flex size-11 shrink-0 items-center justify-center rounded-full text-title hover:bg-surface">
            <Icon name="back" />
            <span className="sr-only">Retour aux messages</span>
          </a>
          <a href={profileHref} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 hover:bg-surface">
            <Avatar card={counterpart} strapiUrl={strapiUrl} />
            <span className="min-w-0">
              <span className="block truncate font-heading text-lg font-semibold text-title">{counterpart.displayName}</span>
              {counterpart.subtitle && <span className="block truncate text-muted">{counterpart.subtitle}</span>}
            </span>
            <span className="sr-only">, voir la fiche</span>
          </a>
        </div>
        {meeting && (
          <div className="mx-auto max-w-180 px-4 pb-3">
            <div className="flex items-center gap-3 rounded-xl bg-surface p-3">
              <span className="text-primary-ink">
                <Icon name="calendar" />
              </span>
              <p className="min-w-0 flex-1 font-semibold">
                Rendez-vous confirmé, {meeting.slotLabel}
                {place}
              </p>
              <a
                href={`${base}/agenda?demande=${encodeURIComponent(meeting.id)}`}
                className="inline-flex min-h-11 shrink-0 items-center font-semibold text-title underline"
              >
                Voir l’agenda
              </a>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-180 flex-col">
        <ol role="log" aria-label="Messages" aria-live="polite" className="flex flex-col gap-4 px-4 py-6">
          {messages.length === 0 && (
            <li className="py-8 text-center text-muted">
              {target ? `Écrivez votre premier message à ${firstName}.` : "Aucun message pour l’instant."}
            </li>
          )}
          {messages.map((message, index) => {
            const newDay = index === 0 || messageDay(messages[index - 1].at) !== messageDay(message.at);
            return (
              <React.Fragment key={message.id}>
                {newDay && (
                  <li className="pt-2 text-center text-sm text-muted">
                    <time dateTime={message.at}>{dayHeading(message.at)}</time>
                  </li>
                )}
                <li className={`flex flex-col ${message.mine ? "items-end" : "items-start"}`}>
                  <p
                    className={`max-w-4/5 rounded-2xl px-4 py-3 text-lg break-words whitespace-pre-wrap ${
                      message.mine ? "bg-title text-white" : "border border-surface-alt bg-white text-ink"
                    }`}
                  >
                    <span className="sr-only">{message.mine ? "Vous\u00a0: " : `${firstName}\u00a0: `}</span>
                    {message.body}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {message.mine ? (
                      message.readAt ? (
                        <>
                          Lu, <time dateTime={message.readAt}>{timeLabel(message.readAt)}</time>
                        </>
                      ) : (
                        <>
                          Envoyé, <time dateTime={message.at}>{timeLabel(message.at)}</time>
                        </>
                      )
                    ) : (
                      <time dateTime={message.at}>{timeLabel(message.at)}</time>
                    )}
                  </p>
                </li>
              </React.Fragment>
            );
          })}
        </ol>

        <form noValidate onSubmit={send} className="sticky bottom-16 z-10 border-t border-surface-alt bg-surface px-4 pt-3 pb-4 lg:bottom-0">
          {error && (
            <p role="alert" className="mb-3 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
              <span className="text-danger">
                <Icon name="alert" />
              </span>
              {error}
            </p>
          )}
          {getsEmail && (
            <p className="mb-3 flex items-center gap-2 text-sm text-muted">
              <Icon name="mail" />
              {firstName} reçoit aussi vos messages par e-mail
            </p>
          )}
          <div className="flex items-end gap-3">
            <label htmlFor="message" className="sr-only">
              Votre message
            </label>
            <textarea
              ref={field}
              id="message"
              name="message"
              rows={1}
              maxLength={MESSAGE_MAX_LENGTH}
              value={draft}
              placeholder="Écrire un message"
              aria-describedby={length > MESSAGE_COUNTER_FROM ? "message-compteur" : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                resize();
              }}
              onKeyDown={(event) => {
                // Entrée va à la ligne ; Ctrl ou Cmd + Entrée envoie.
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send(event);
              }}
              className="max-h-40 min-h-12 w-full resize-none rounded-2xl border-2 border-muted bg-white px-4 py-3 text-lg text-ink"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-busy={sending}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-gold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="send" />
              <span className="sr-only">{sending ? "Envoi en cours" : "Envoyer"}</span>
            </button>
          </div>
          {length > MESSAGE_COUNTER_FROM && (
            <p
              id="message-compteur"
              aria-live="polite"
              className={`mt-2 text-right text-sm ${length >= MESSAGE_MAX_LENGTH ? "font-semibold text-danger" : "text-muted"}`}
            >
              {length.toLocaleString("fr-FR")} / {MESSAGE_MAX_LENGTH.toLocaleString("fr-FR")}&nbsp;caractères
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
