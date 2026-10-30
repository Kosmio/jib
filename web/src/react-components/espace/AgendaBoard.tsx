import React, { useEffect, useId, useRef, useState } from "react";
import { EspaceApiError } from "../../lib/espace/client";
import {
  acceptMeeting,
  cancelMeeting,
  declineMeeting,
  fetchMeetings,
  firstName,
  hourLabel,
  hourRange,
  meetingErrorMessage,
  targetOf,
  type AgendaSession,
  type Meeting,
  type MeetingsResponse,
} from "../../lib/espace/meetings";
import MeetingStatus, { Icon } from "./MeetingStatus";
import { Avatar } from "./ProfileCardView";
import SlotPicker from "./SlotPicker";

// E6 (F-60 à F-66) : demandes reçues, frise de la journée, demandes envoyées, historique. Les boutons suivent les `can*` du
// serveur : aucune règle de R-10 à R-19 n'est recalculée ici. Après chaque action, la liste est relue au serveur.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  /** Couleur d'édition déjà contrôlée (`bannerColor`), passée aux grilles de contre-proposition. */
  themeColor: string | null;
  dayLabel: string | null;
  initial: MeetingsResponse;
  /** `?demande={id}` : la demande à mettre en évidence (lien des e-mails). */
  highlightId: string | null;
};

type Notice = { kind: "status" | "alert"; text: string };
type Confirm = { meeting: Meeting; action: "cancel" | "decline" };

const SECTION_TITLE = "font-heading text-xl font-semibold normal-case";
const BUTTON = "inline-flex items-center justify-center rounded-lg px-4 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} min-h-13 bg-gold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light`;
const SECONDARY = `${BUTTON} min-h-13 border-2 border-title bg-white text-title hover:bg-surface`;
const QUIET = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-semibold text-title underline disabled:opacity-60";
const DANGER = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-4 font-bold text-danger disabled:opacity-60";

const allMeetings = (data: MeetingsResponse): Meeting[] => [
  ...data.received,
  ...data.sent,
  ...data.closed,
  ...data.agenda.flatMap((item) => (item.type === "meeting" ? [item.meeting] : [])),
];

/** « 15h30, pause et B2B » : heure du créneau puis intitulé de la pause. */
const slotLine = (meeting: Meeting): string => [hourLabel(meeting.slot.startsAt), meeting.slot.sessionTitle].filter(Boolean).join(", ");

const viaLine = (meeting: Meeting): string | null =>
  meeting.viaExhibitor
    ? `Pour ${meeting.viaExhibitor.name}${meeting.viaExhibitor.standNumber ? `, stand ${meeting.viaExhibitor.standNumber}` : ""}`
    : null;

function Person({ meeting, strapiUrl, size }: { meeting: Meeting; strapiUrl: string; size?: string }) {
  const { counterpart } = meeting;
  return (
    <div className="flex items-center gap-4">
      <Avatar card={counterpart} strapiUrl={strapiUrl} size={size} />
      <div className="min-w-0">
        <p className="text-lg leading-snug font-bold text-ink">{counterpart.displayName}</p>
        {counterpart.subtitle && <p className="leading-snug text-muted">{counterpart.subtitle}</p>}
      </div>
    </div>
  );
}

/** Fenêtre de confirmation (F-63) : `<dialog>` modal, qui piège le focus et se ferme avec Échap. */
function ConfirmDialog({ confirm, onConfirm, onClose }: { confirm: Confirm | null; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (confirm && !dialog.open) dialog.showModal();
    if (!confirm && dialog.open) dialog.close();
  }, [confirm]);

  const meeting = confirm?.meeting;
  const name = meeting ? firstName(meeting.counterpart) : "";
  const texts = {
    cancel: {
      title: meeting?.status === "pending" ? "Annuler cette demande ?" : "Annuler ce rendez-vous ?",
      text:
        meeting?.status === "pending"
          ? `La demande à ${name} est retirée.`
          : `Nous prévenons ${name} par e-mail. Le créneau sera de nouveau libre.`,
      yes: meeting?.status === "pending" ? "Oui, annuler la demande" : "Oui, annuler le rendez-vous",
      no: "Non, la garder",
    },
    decline: {
      title: "Refuser cette demande ?",
      text: `Nous prévenons ${name} par e-mail et l’invitons à choisir un autre créneau.`,
      yes: "Oui, refuser",
      no: "Non, revenir",
    },
  };
  const view = confirm ? texts[confirm.action] : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-surface-alt bg-white p-6 text-ink backdrop:bg-title/60"
    >
      {view && meeting && (
        <>
          <h2 id={titleId} className="font-heading text-lg font-semibold normal-case">
            {view.title}
          </h2>
          <p className="mt-2">
            {meeting.counterpart.displayName}, {slotLine(meeting)}
          </p>
          <p className="mt-1 text-muted">{view.text}</p>
          <div className="mt-6 grid gap-2">
            <button type="button" onClick={onConfirm} className={`${BUTTON} min-h-13 bg-danger text-white`}>
              {view.yes}
            </button>
            <button type="button" onClick={onClose} className={SECONDARY}>
              {view.no}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

export default function AgendaBoard({ strapiUrl, editionSlug, themeColor, dayLabel, initial, highlightId }: Props) {
  const [data, setData] = useState<MeetingsResponse>(initial);
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    highlightId && !allMeetings(initial).some(({ id }) => id === highlightId)
      ? { kind: "status", text: "Cette demande n’est plus en attente." }
      : null,
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const base = `/espace/${encodeURIComponent(editionSlug)}`;

  // Le message (réussite ou échec) peut être hors de l'écran : le focus l'y amène, ce qui le fait aussi lire.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // Lien d'un e-mail : la demande visée est amenée à l'écran et marquée.
  useEffect(() => {
    if (!highlightId) return;
    const card = document.getElementById(`demande-${highlightId}`);
    card?.scrollIntoView({ block: "center" });
    card?.focus({ preventScroll: true });
  }, []);

  function failure(error: unknown): string {
    if (error instanceof EspaceApiError && error.status === 401) window.location.assign(`${base}/connexion`);
    return meetingErrorMessage(error);
  }

  async function reload() {
    try {
      setData(await fetchMeetings(strapiUrl));
    } catch (error) {
      setNotice({ kind: "alert", text: failure(error) });
    }
  }

  async function run(meeting: Meeting, label: string, call: () => Promise<Meeting>, success: (done: Meeting) => string) {
    if (busy) return;
    setBusy({ id: meeting.id, label });
    setNotice(null);
    try {
      setNotice({ kind: "status", text: success(await call()) });
    } catch (error) {
      setNotice({ kind: "alert", text: failure(error) });
    }
    await reload(); // l'état du serveur fait foi, même après un échec (demande déjà fermée par R-15, par exemple)
    setBusy(null);
  }

  const accept = (meeting: Meeting) =>
    run(meeting, "Acceptation…", () => acceptMeeting(strapiUrl, meeting.id), (done) =>
      `Rendez-vous confirmé avec ${meeting.counterpart.displayName}, ${[done.location, hourLabel(done.slot.startsAt)].filter(Boolean).join(", ")}.`,
    );

  function confirmed() {
    if (!confirm) return;
    const { meeting, action } = confirm;
    setConfirm(null);
    if (action === "decline") {
      void run(meeting, "Refus…", () => declineMeeting(strapiUrl, meeting.id), () => `Demande de ${meeting.counterpart.displayName} refusée.`);
    } else {
      void run(meeting, "Annulation…", () => cancelMeeting(strapiUrl, meeting.id), () =>
        meeting.status === "pending"
          ? `Demande à ${meeting.counterpart.displayName} annulée.`
          : `Rendez-vous avec ${meeting.counterpart.displayName} annulé.`,
      );
    }
  }

  const { received, sent, agenda, closed } = data;
  const isEmpty = !received.length && !sent.length && !closed.length && !agenda.some(({ type }) => type === "meeting");
  const cardId = (meeting: Meeting) => ({ id: `demande-${meeting.id}`, tabIndex: -1 });
  const marked = (meeting: Meeting) => (meeting.id === highlightId ? "ring-4 ring-title" : "");
  const label = (meeting: Meeting, text: string) => (busy?.id === meeting.id ? busy.label : text);

  return (
    <div>
      <div
        ref={noticeRef}
        tabIndex={-1}
        role={notice?.kind === "alert" ? "alert" : "status"}
        className={`mt-6 flex items-start gap-3 rounded-lg bg-white p-3 font-semibold text-ink empty:hidden ${notice?.kind === "alert" ? "border-2 border-danger" : ""}`}
      >
        {notice && (
          <>
            <span className={notice.kind === "alert" ? "text-danger" : "text-primary-ink"}>
              <Icon name={notice.kind === "alert" ? "alert" : "check"} />
            </span>
            <p>{notice.text}</p>
          </>
        )}
      </div>

      {isEmpty && (
        <div className="mt-6 rounded-xl border border-surface-alt bg-white p-6 text-center">
          <p className="font-heading text-lg font-semibold text-title">Aucun rendez-vous pour l’instant</p>
          <p className="mt-2 text-muted">Les demandes reçues et envoyées apparaissent ici.</p>
          <a href={`${base}/annuaire`} className={`${SECONDARY} mt-4 w-full`}>
            Trouver des interlocuteurs
          </a>
        </div>
      )}

      {received.length > 0 && (
        <section aria-labelledby="demandes-recues" className="mt-6">
          <h2 id="demandes-recues" className={SECTION_TITLE}>
            Demandes reçues
          </h2>
          <ul className="mt-3 grid gap-4">
            {received.map((meeting) => (
              <li key={meeting.id} {...cardId(meeting)} className={`rounded-xl border-2 border-gold bg-white p-4 ${marked(meeting)}`}>
                <p className="font-bold text-wood-dark">Nouvelle demande reçue</p>
                <div className="mt-3">
                  <Person meeting={meeting} strapiUrl={strapiUrl} size="size-14" />
                </div>
                <p className="mt-3 text-ink">Propose {slotLine(meeting)}</p>
                {viaLine(meeting) && <p className="text-sm text-muted">{viaLine(meeting)}</p>}
                {meeting.message && <p className="mt-3 rounded-lg bg-surface p-3 text-ink">« {meeting.message} »</p>}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {meeting.canAccept && (
                    <button type="button" disabled={busy !== null} aria-busy={busy?.id === meeting.id} onClick={() => void accept(meeting)} className={PRIMARY}>
                      {label(meeting, "Accepter")}
                      <span className="sr-only">{` la demande de ${meeting.counterpart.displayName}`}</span>
                    </button>
                  )}
                  {meeting.canCounter && (
                    <button
                      type="button"
                      aria-expanded={counterFor === meeting.id}
                      disabled={busy !== null}
                      onClick={() => setCounterFor(counterFor === meeting.id ? null : meeting.id)}
                      className={SECONDARY}
                    >
                      Proposer un autre créneau
                      <span className="sr-only">{` à ${meeting.counterpart.displayName}`}</span>
                    </button>
                  )}
                  {meeting.canDecline && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirm({ meeting, action: "decline" })}
                      className={`${QUIET} sm:col-span-2`}
                    >
                      Refuser
                      <span className="sr-only">{` la demande de ${meeting.counterpart.displayName}`}</span>
                    </button>
                  )}
                </div>
                {counterFor === meeting.id && (
                  <SlotPicker
                    strapiUrl={strapiUrl}
                    editionSlug={editionSlug}
                    target={targetOf(meeting.counterpart)}
                    targetName={firstName(meeting.counterpart)}
                    themeColor={themeColor}
                    dayLabel={dayLabel}
                    counterOf={{ meetingId: meeting.id, slotId: meeting.slot.id }}
                    onClose={() => setCounterFor(null)}
                    onSent={async () => {
                      setCounterFor(null);
                      setNotice({ kind: "status", text: `Proposition envoyée à ${firstName(meeting.counterpart)}.` });
                      await reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {agenda.length > 0 && (
        <section aria-labelledby="ma-journee" className="mt-8">
          <h2 id="ma-journee" className={SECTION_TITLE}>
            Ma journée{dayLabel ? `, ${dayLabel}` : ""}
          </h2>
          <ol className="mt-4">
            {agenda.map((item) => {
              const meeting = item.type === "meeting" ? item.meeting : null;
              const session: AgendaSession | null = item.type === "session" ? item : null;
              const confirmedMeeting = meeting?.status === "accepted";
              return (
                <li key={meeting ? `m-${meeting.id}` : `s-${session?.id}`} className="grid grid-cols-[3.5rem_1.25rem_1fr] gap-x-2">
                  <p className={`text-right font-heading font-medium text-ink ${meeting ? "pt-4" : "pt-1"}`}>
                    {session ? hourLabel(session.start || session.startsAt) : hourLabel(item.startsAt)}
                  </p>
                  <div className="relative flex justify-center before:absolute before:inset-y-0 before:w-0.5 before:bg-surface-alt">
                    <span
                      aria-hidden="true"
                      className={`relative z-10 size-3.5 rounded-full border-2 ${meeting ? "mt-5" : "mt-2"} ${
                        confirmedMeeting ? "border-primary bg-primary" : meeting ? "border-gold bg-surface" : "border-accent bg-surface"
                      }`}
                    ></span>
                  </div>
                  {session && (
                    <div className="pb-5">
                      <p className="pt-1 leading-snug font-semibold text-muted">{session.title}</p>
                      {session.start && session.end && <p className="text-sm text-muted">{hourRange(session.start, session.end)}</p>}
                    </div>
                  )}
                  {meeting && (
                    <div className="pb-4">
                      <div
                        {...(confirmedMeeting ? cardId(meeting) : {})}
                        className={`rounded-xl border border-surface-alt bg-white p-4 ${marked(meeting)}`}
                      >
                        <p className="text-lg leading-snug font-bold text-ink">{meeting.counterpart.displayName}</p>
                        {meeting.counterpart.subtitle && <p className="leading-snug text-muted">{meeting.counterpart.subtitle}</p>}
                        <p className="mt-1 text-ink">{[meeting.location, meeting.slot.sessionTitle].filter(Boolean).join(", ")}</p>
                        {viaLine(meeting) && <p className="text-sm text-muted">{viaLine(meeting)}</p>}
                        {meeting.answeredByName && confirmedMeeting && meeting.counterpart.kind === "exhibitor" && (
                          <p className="text-sm text-muted">Confirmé par {meeting.answeredByName}</p>
                        )}
                        <p className="mt-2">
                          <MeetingStatus status={meeting.status} />
                        </p>
                        {meeting.canCancel && confirmedMeeting && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setConfirm({ meeting, action: "cancel" })}
                            className={`${DANGER} mt-3`}
                          >
                            {label(meeting, "Annuler le rendez-vous")}
                            <span className="sr-only">{` avec ${meeting.counterpart.displayName}`}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {sent.length > 0 && (
        <section aria-labelledby="demandes-envoyees" className="mt-8">
          <h2 id="demandes-envoyees" className={SECTION_TITLE}>
            Demandes envoyées
          </h2>
          <ul className="mt-3 grid gap-4">
            {sent.map((meeting) => (
              <li key={meeting.id} {...cardId(meeting)} className={`rounded-xl border border-surface-alt bg-white p-4 ${marked(meeting)}`}>
                <Person meeting={meeting} strapiUrl={strapiUrl} />
                <p className="mt-3 text-ink">{slotLine(meeting)}</p>
                {viaLine(meeting) && <p className="text-sm text-muted">{viaLine(meeting)}</p>}
                <p className="mt-2">
                  <MeetingStatus status={meeting.status} />
                </p>
                {meeting.canCancel && (
                  <button type="button" disabled={busy !== null} onClick={() => setConfirm({ meeting, action: "cancel" })} className={`${DANGER} mt-3`}>
                    {label(meeting, "Annuler la demande")}
                    <span className="sr-only">{` à ${meeting.counterpart.displayName}`}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {closed.length > 0 && (
        <details className="mt-8 rounded-xl border border-surface-alt bg-white p-4" open={closed.some(({ id }) => id === highlightId)}>
          <summary className="flex min-h-11 cursor-pointer items-center font-heading text-lg font-semibold text-title">
            Historique ({closed.length})
          </summary>
          <ul className="mt-2 divide-y divide-surface-alt">
            {closed.map((meeting) => (
              <li key={meeting.id} {...cardId(meeting)} className={`py-3 ${marked(meeting)}`}>
                <p className="font-bold text-ink">{meeting.counterpart.displayName}</p>
                <p className="text-muted">{slotLine(meeting)}</p>
                <p className="mt-1">
                  <MeetingStatus status={meeting.status} />
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog confirm={confirm} onConfirm={confirmed} onClose={() => setConfirm(null)} />
    </div>
  );
}
