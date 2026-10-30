import React, { useEffect, useId, useRef, useState } from "react";
import { EspaceApiError } from "../../lib/espace/client";
import {
  counterMeeting,
  createMeeting,
  fetchSlots,
  hourLabel,
  hourRange,
  isStaleSlotError,
  meetingErrorMessage,
  type Meeting,
  type SlotsResponse,
} from "../../lib/espace/meetings";
import { Icon } from "./MeetingStatus";

// E5 (F-50 à F-57, R-12, R-19) : grille des créneaux par pause, message, envoi. Réutilisée par E6 en mode contre-proposition
// (F-62, A-31). Le serveur calcule tout : état de chaque créneau, `blocked`, `pending`, mode (demande, réservation, stand).
// Le front ne présélectionne rien (F-51) et recharge la grille après un conflit (F-56).

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  /** `p:{id}` (personne) ou `x:{id}` (exposant). */
  target: string;
  /** Prénom de la personne ou nom de l'exposant : « Demande envoyée à {nom} ». */
  targetName: string;
  /** Couleur d'édition déjà contrôlée (`bannerColor`), fond du créneau choisi ; null : `bg-title`. */
  themeColor: string | null;
  /** « jeudi 3 décembre », ajouté au titre. */
  dayLabel: string | null;
  /** Grille rendue par le serveur (E5). Sans elle (E6), elle est chargée à l'ouverture. */
  initial?: SlotsResponse;
  standNumber?: string | number | null;
  tableNumber?: number | null;
  /** Contre-proposition : la demande reçue à laquelle on répond ; son créneau n'est pas proposé. */
  counterOf?: { meetingId: string; slotId: string };
  onSent?: (meeting: Meeting) => void;
  onClose?: () => void;
};

const MESSAGE_MAX = 300;

const SLOT_BASE = "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-2 py-1 font-heading text-lg font-medium";
const SLOT_LOOK = {
  available: "border-accent-dark bg-white text-ink hover:bg-surface",
  selected: "border-transparent text-white",
  unavailable: "cursor-not-allowed border-dashed border-accent bg-transparent text-muted line-through",
  inert: "cursor-not-allowed border-surface-alt bg-transparent text-muted",
  requested: "cursor-not-allowed border-wood-dark bg-white text-wood-dark",
  confirmed: "cursor-not-allowed border-primary-ink bg-white text-primary-ink",
};

const TITLES = { request: "Proposer un rendez-vous", booking: "Réserver un créneau", stand: "Demander un rendez-vous au stand" };

export default function SlotPicker({
  strapiUrl,
  editionSlug,
  target,
  targetName,
  themeColor,
  dayLabel,
  initial,
  standNumber,
  tableNumber,
  counterOf,
  onSent,
  onClose,
}: Props) {
  const uid = useId();
  const [data, setData] = useState<SlotsResponse | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const sentRef = useRef<HTMLDivElement>(null);

  const mode = data?.mode ?? "request";
  const isCounter = Boolean(counterOf);
  const readOnly = !isCounter && Boolean(data?.pending);
  const agendaUrl = `/espace/${encodeURIComponent(editionSlug)}/agenda`;
  const title = isCounter ? "Proposer un autre créneau" : TITLES[mode];
  const Heading = isCounter ? "h3" : "h2";

  // Une session expirée ramène à la connexion, comme dans E2.
  function onFailure(failure: unknown, fallback?: string): string {
    if (failure instanceof EspaceApiError && failure.status === 401) {
      window.location.assign(`/espace/${encodeURIComponent(editionSlug)}/connexion`);
    }
    return meetingErrorMessage(failure, fallback);
  }

  async function refresh() {
    setLoadError(null);
    try {
      const fresh = await fetchSlots(strapiUrl, target);
      setData(fresh);
      // Un créneau choisi qui n'est plus disponible est abandonné.
      setSelected((current) =>
        current && fresh.groups.some(({ slots }) => slots.some(({ id, state }) => id === current && state === "available")) ? current : null,
      );
    } catch (failure) {
      setLoadError(onFailure(failure, "Les créneaux n’ont pas pu être chargés. Vérifiez votre connexion et réessayez."));
    }
  }

  useEffect(() => {
    if (!initial) void refresh();
  }, []);

  // Le message de réussite est hors de l'écran quand le bouton d'envoi disparaît : le focus l'y ramène.
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  const chosen = data?.groups.flatMap(({ slots }) => slots).find(({ id }) => id === selected) ?? null;
  const stateOf = (slot: { id: string; state: string }) => (slot.id === counterOf?.slotId ? "unavailable" : slot.state);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || sending || readOnly) return;
    setSending(true);
    setError(null);
    setSent(null);
    const note = mode === "booking" ? "" : message.trim();
    try {
      const meeting = counterOf
        ? await counterMeeting(strapiUrl, counterOf.meetingId, { slotId: chosen.id, ...(note && { message: note }) })
        : await createMeeting(strapiUrl, { slotId: chosen.id, target, ...(note && { message: note }) });
      setSending(false);
      if (counterOf) {
        onSent?.(meeting);
        return;
      }
      setSent(
        mode === "booking"
          ? `Réservation confirmée : ${[meeting.location, hourLabel(meeting.slot.startsAt)].filter(Boolean).join(", ")}.`
          : `Demande envoyée à ${targetName}`,
      );
      setSelected(null);
      setMessage("");
      await refresh();
    } catch (failure) {
      setSending(false);
      setError(onFailure(failure));
      if (isStaleSlotError(failure)) {
        setSelected(null);
        await refresh();
      }
    }
  }

  let blockedText: React.ReactNode = null;
  if (data?.blocked) {
    const { code, message: text } = data.blocked;
    if (code === "SELF") {
      blockedText = (
        <>
          <span className="block">{target.startsWith("x:") ? "Vous représentez cet exposant." : "C’est votre profil."}</span>
          <a href={`/espace/${encodeURIComponent(editionSlug)}/profil`} className="inline-flex min-h-11 items-center text-title underline">
            Modifier mon profil
          </a>
        </>
      );
    } else {
      blockedText = code === "TARGET_UNAVAILABLE" ? `${targetName} ne reçoit pas de demandes de rendez-vous.` : text;
    }
  }

  const hint =
    isCounter
      ? `La demande de ${targetName} est refusée, votre proposition lui est envoyée.`
      : mode === "stand"
        ? standNumber
          ? `Rendez-vous au stand ${standNumber}`
          : "Rendez-vous au stand"
        : mode === "booking"
          ? `${tableNumber ? `Table ${tableNumber}` : "Table dédiée"}, confirmée dès la réservation`
          : "Table attribuée automatiquement à la confirmation";

  const buttonLabel = !chosen
    ? "Choisissez un créneau"
    : isCounter
      ? `Proposer ${chosen.label}`
      : mode === "booking"
        ? `Réserver ${chosen.label}`
        : `Envoyer la demande pour ${chosen.label}`;

  const noteId = `${uid}-note`;
  const hasAvailable = data?.groups.some(({ slots }) => slots.some((slot) => stateOf(slot) === "available")) ?? false;

  return (
    <section aria-labelledby={`${uid}-titre`} className={isCounter ? "mt-4" : ""}>
      <Heading id={`${uid}-titre`} className={`font-heading font-semibold normal-case ${isCounter ? "text-lg" : "text-xl"}`}>
        {title}
        {dayLabel && !isCounter ? `, ${dayLabel}` : ""}
      </Heading>

      <div
        ref={sentRef}
        role="status"
        tabIndex={-1}
        className="mt-4 flex items-start gap-3 rounded-lg bg-white p-3 font-semibold text-ink empty:hidden"
      >
        {sent && (
          <>
            <span className="text-primary-ink">
              <Icon name="check" />
            </span>
            <div>
              <p>{sent}</p>
              <a href={agendaUrl} className="inline-flex min-h-11 items-center text-title underline">
                Voir mon agenda
              </a>
            </div>
          </>
        )}
      </div>

      {!data && !loadError && (
        <p role="status" aria-busy="true" className="mt-4 text-muted">
          Chargement des créneaux…
        </p>
      )}

      {loadError && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
          <span className="text-danger">
            <Icon name="alert" />
          </span>
          <div>
            <p>{loadError}</p>
            <button type="button" onClick={() => void refresh()} className="inline-flex min-h-11 items-center text-title underline">
              Réessayer
            </button>
          </div>
        </div>
      )}

      {data?.blocked && (
        <p className="mt-4 flex items-start gap-3 rounded-lg bg-white p-4 text-ink">
          <span className="text-title">
            <Icon name="info" />
          </span>
          <span>{blockedText}</span>
        </p>
      )}

      {data && !data.blocked && (
        <form onSubmit={submit} noValidate>
          {readOnly && !sent && data.pending && (
            <p className="mt-4 flex items-start gap-3 rounded-lg bg-white p-4 text-ink">
              <span className="text-wood-dark">
                <Icon name="clock" />
              </span>
              <span>
                <span className="block">
                  Demande envoyée pour {data.pending.slotLabel}, {targetName} n’a pas encore répondu.
                </span>
                <a href={agendaUrl} className="inline-flex min-h-11 items-center text-title underline">
                  Voir mon agenda
                </a>
              </span>
            </p>
          )}

          {data.groups.length === 0 && <p className="mt-4 text-muted">Aucun créneau à venir.</p>}

          {data.groups.map(({ session, slots }) => (
            <div key={session.id} role="group" aria-labelledby={`${uid}-g-${session.id}`} className="mt-5">
              <h3 id={`${uid}-g-${session.id}`} className="text-base font-semibold">
                {[session.title, hourRange(session.start, session.end)].filter(Boolean).join(", ")}
              </h3>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => {
                  const state = stateOf(slot);
                  const pickable = state === "available" && !readOnly;
                  const isSelected = pickable && selected === slot.id;
                  const look = isSelected ? "selected" : state === "available" ? (readOnly ? "inert" : "available") : state;
                  const key = look as keyof typeof SLOT_LOOK;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      aria-pressed={pickable ? isSelected : undefined}
                      aria-disabled={pickable ? undefined : true}
                      onClick={() => pickable && setSelected(isSelected ? null : slot.id)}
                      style={isSelected && themeColor ? { backgroundColor: themeColor } : undefined}
                      className={`${SLOT_BASE} ${SLOT_LOOK[key]} ${isSelected && !themeColor ? "bg-title" : ""}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {isSelected && <Icon name="check" className="size-4" />}
                        {slot.label}
                      </span>
                      {state === "unavailable" && <span className="sr-only">, indisponible</span>}
                      {state === "requested" && <span className="font-sans text-xs font-semibold">Demande envoyée</span>}
                      {state === "confirmed" && <span className="font-sans text-xs font-semibold">Confirmé</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {!readOnly && data.groups.length > 0 && !hasAvailable && (
            <p className="mt-4 text-muted">Aucun créneau n’est disponible pour le moment.</p>
          )}

          {!readOnly && data.groups.length > 0 && (
            <>
              {mode !== "booking" && (
                <div className="mt-6">
                  <label htmlFor={`${uid}-message`} className="block font-semibold">
                    {isCounter ? "Un mot pour accompagner votre proposition (facultatif)" : "Un mot pour présenter votre demande (facultatif)"}
                  </label>
                  <textarea
                    id={`${uid}-message`}
                    rows={3}
                    maxLength={MESSAGE_MAX}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className="mt-2 min-h-24 w-full rounded-lg border-2 border-accent-dark bg-white px-4 py-3 text-lg text-ink"
                  />
                  <p aria-hidden="true" className="mt-1 text-right text-sm text-muted">
                    {message.length}/{MESSAGE_MAX}
                  </p>
                </div>
              )}

              {error && (
                <p role="alert" className="mt-4 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
                  <span className="text-danger">
                    <Icon name="alert" />
                  </span>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!chosen || sending}
                aria-busy={sending}
                aria-describedby={noteId}
                className="mt-6 inline-flex min-h-13 w-full items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Envoi…" : buttonLabel}
              </button>
              <p id={noteId} className="mt-2 text-center text-sm text-muted">
                {hint}
              </p>
            </>
          )}
        </form>
      )}

      {isCounter && onClose && (
        <p className="mt-2 text-center">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center text-title underline">
            Fermer sans proposer
          </button>
        </p>
      )}
    </section>
  );
}
