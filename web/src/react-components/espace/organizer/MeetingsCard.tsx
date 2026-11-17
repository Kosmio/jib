import React, { useEffect, useMemo, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { Card, FeedbackArea, Icon, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// F-139 à F-141, R-90 : les rendez-vous de l'édition par créneau, leur annulation et leur déplacement par l'organisation,
// le blocage de tables et la fermeture d'un créneau. Routes : GET /meetings, POST /meetings/{id}/cancel, POST /meetings/{id}/move,
// PUT /slots/{id}/blocks, sous /admin/{edition}.

type Status = "pending" | "accepted" | "declined" | "cancelled" | "expired";
type Party = { kind: "attendee" | "exhibitor"; name: string; subtitle: string | null };
type AdminSlot = {
  id: string;
  label: string;
  startsAt: string;
  sessionTitle: string | null;
  closed: boolean;
  blockedTables: number[];
  freeTables: number[];
};
type AdminMeeting = {
  id: string;
  status: Status;
  slot: { id: string; label: string; startsAt: string; sessionTitle: string | null };
  requester: Party;
  target: Party;
  location: string | null;
  tableNumber: number | null;
  conflict: boolean;
  canCancel: boolean;
  canMove: boolean;
  freeTables: number[];
};
type AdminData = { tablesCount: number; dedicatedTables: number[]; slots: AdminSlot[]; meetings: AdminMeeting[] };
type BlocksResult = { id: string; blockedTables: number[]; closed: boolean; affected: string[] };

const REASON_MAX = 200;
const ACTION_FAILED = "L’action a échoué. Vérifiez votre connexion et réessayez.";

const STATUS_LABELS: Record<Status, string> = {
  pending: "En attente",
  accepted: "Confirmé",
  declined: "Refusé",
  cancelled: "Annulé",
  expired: "Expiré",
};
const STATUS_COLORS: Record<Status, string> = {
  pending: "text-wood-dark",
  accepted: "text-primary-ink",
  declined: "text-muted",
  cancelled: "text-muted",
  expired: "text-muted",
};

const enc = encodeURIComponent;
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function StatusIcon({ status }: { status: Status }) {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      {status === "pending" && <path d="M12 7v5l3 2" />}
      {status === "accepted" && <path d="m8.5 12.5 2.5 2.5 4.5-5" />}
      {status !== "pending" && status !== "accepted" && <path d="m9 9 6 6M15 9l-6 6" />}
    </svg>
  );
}

const partyLabel = ({ name, subtitle }: Party) => (subtitle ? `${name} (${subtitle})` : name);
const placeLabel = (meeting: AdminMeeting) =>
  meeting.location ?? (meeting.status === "pending" ? "Lieu attribué à l’acceptation" : "Pas de lieu");
const tablesLabel = (tables: number[]) => (tables.length ? tables.join(", ") : "aucune");

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-4 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-4 font-bold text-danger hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60";
const fieldClass = "mt-1 block min-h-11 w-full rounded-lg border-2 border-title bg-white px-3 text-ink";

export default function MeetingsCard({ edition, strapiUrl }: CardProps) {
  const base = `/admin/${enc(edition)}`;
  const [data, setData] = useState<AdminData | null>(null);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [slotFilter, setSlotFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [blockSlot, setBlockSlot] = useState("");
  const [blockTables, setBlockTables] = useState<number[]>([]);
  const [blockClosed, setBlockClosed] = useState(false);
  const [dayTable, setDayTable] = useState("");

  async function load() {
    try {
      setData(await request<AdminData>(strapiUrl, `${base}/meetings`, "GET"));
      return true;
    } catch (failure) {
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(edition)}/connexion`);
        return false;
      }
      setNotice({ kind: "alert", text: LOAD_FAILED });
      return false;
    }
  }

  useEffect(() => {
    load();
  }, [edition, strapiUrl]);

  /** Une action de l'organisateur : rend sa réponse, ou null après avoir affiché l'échec. */
  async function act<T>(call: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setNotice(null);
    try {
      return await call();
    } catch (failure) {
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(edition)}/connexion`);
        return null;
      }
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || ACTION_FAILED });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function cancel(meeting: AdminMeeting) {
    const done = await act(() => request(strapiUrl, `${base}/meetings/${enc(meeting.id)}/cancel`, "POST", { reason: reason.trim() || undefined }));
    if (done === null) return;
    setCancelling(null);
    setReason("");
    await load();
    setNotice({ kind: "status", text: "Rendez-vous annulé. Les deux parties sont prévenues par e-mail et la table est libérée." });
  }

  async function move(meeting: AdminMeeting) {
    const table = Number(moveTo[meeting.id] ?? meeting.freeTables[0]);
    if (!Number.isInteger(table)) return;
    const done = await act(() => request(strapiUrl, `${base}/meetings/${enc(meeting.id)}/move`, "POST", { table }));
    if (done === null) return;
    await load();
    setNotice({ kind: "status", text: `Rendez-vous déplacé à la table ${table}.` });
  }

  function chooseBlockSlot(id: string) {
    setBlockSlot(id);
    const slot = data?.slots.find((item) => item.id === id);
    setBlockTables(slot?.blockedTables ?? []);
    setBlockClosed(slot?.closed ?? false);
  }

  /** Résumé après un blocage (F-141) : les rendez-vous confirmés touchés sont à déplacer ou à annuler. */
  const blocksNotice = (affected: number): Feedback =>
    affected
      ? {
          kind: "alert",
          text: `Blocage enregistré. ${plural(affected, "rendez-vous confirmé est touché", "rendez-vous confirmés sont touchés")} : déplacez-le vers une table libre du même créneau ou annulez-le, dans la liste ci-dessous.`,
        }
      : { kind: "status", text: "Blocage enregistré. Aucun rendez-vous confirmé n’est touché." };

  async function saveBlocks() {
    if (!blockSlot) return;
    const result = await act(() =>
      request<BlocksResult>(strapiUrl, `${base}/slots/${enc(blockSlot)}/blocks`, "PUT", { blockedTables: blockTables, closed: blockClosed }),
    );
    if (result === null) return;
    await load();
    setNotice(blocksNotice(result.affected.length));
  }

  /** Une table sur toute la journée : le même blocage, créneau après créneau, les autres blocages conservés. */
  async function blockDay(block: boolean) {
    const table = Number(dayTable);
    if (!data || !Number.isInteger(table)) return;
    const affected = new Set<string>();
    const done = await act(async () => {
      for (const slot of data.slots) {
        const rest = slot.blockedTables.filter((n) => n !== table);
        const result = await request<BlocksResult>(strapiUrl, `${base}/slots/${enc(slot.id)}/blocks`, "PUT", {
          blockedTables: block ? [...rest, table] : rest,
          closed: slot.closed,
        });
        result.affected.forEach((id) => affected.add(id));
      }
      return true;
    });
    await load();
    if (done) setNotice(blocksNotice(affected.size));
  }

  const meetings = data?.meetings ?? [];
  const conflicts = meetings.filter((meeting) => meeting.conflict);
  const shown = useMemo(() => {
    const needle = normalize(query.trim());
    return meetings.filter(
      (meeting) =>
        (!slotFilter || meeting.slot.id === slotFilter) &&
        (!statusFilter || meeting.status === statusFilter) &&
        (!needle || normalize(`${partyLabel(meeting.requester)} ${partyLabel(meeting.target)}`).includes(needle)),
    );
  }, [meetings, slotFilter, statusFilter, query]);
  const groups = (data?.slots ?? []).map((slot) => ({ slot, items: shown.filter((meeting) => meeting.slot.id === slot.id) })).filter(({ items }) => items.length);
  const slotName = (slot: { label: string; sessionTitle: string | null }) => (slot.sessionTitle ? `${slot.label}, ${slot.sessionTitle}` : slot.label);
  const blockableTables = data ? Array.from({ length: data.tablesCount }, (_, index) => index + 1) : [];

  return (
    <Card heading="Rendez-vous de l’édition">
      {!data && !notice && <p className="mt-2 text-muted">Chargement…</p>}
      <FeedbackArea feedback={notice} />
      {data && (
        <>
          {conflicts.length > 0 && (
            <p className="mt-4 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
              <span className="text-danger">
                <Icon name="alert" />
              </span>
              {`${plural(conflicts.length, "rendez-vous confirmé est touché", "rendez-vous confirmés sont touchés")} par un blocage : déplacez-le vers une table libre du même créneau ou annulez-le.`}
            </p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block font-semibold">
              Créneau
              <select className={fieldClass} value={slotFilter} onChange={(event) => setSlotFilter(event.target.value)}>
                <option value="">Tous les créneaux</option>
                {data.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slotName(slot)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-semibold">
              Statut
              <select className={fieldClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">Tous les statuts</option>
                {(Object.keys(STATUS_LABELS) as Status[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-semibold">
              Rechercher un nom
              <input type="search" className={fieldClass} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
          <p role="status" className="mt-3 text-sm text-muted">
            {plural(shown.length, "rendez-vous affiché", "rendez-vous affichés")} sur {meetings.length}.
          </p>

          {groups.length === 0 ? (
            <p className="mt-4 text-muted">{meetings.length ? "Aucun rendez-vous ne correspond à ces filtres." : "Aucun rendez-vous pour cette édition."}</p>
          ) : (
            <div className="mt-4 space-y-6">
              {groups.map(({ slot, items }) => (
                <section key={slot.id} aria-labelledby={`slot-${slot.id}`}>
                  <h3 id={`slot-${slot.id}`} className="font-heading font-semibold">
                    {slotName(slot)}
                    {slot.closed && <span className="ml-2 text-danger">Créneau fermé</span>}
                    {slot.blockedTables.length > 0 && <span className="ml-2 text-sm font-normal text-muted">Tables bloquées : {tablesLabel(slot.blockedTables)}</span>}
                  </h3>
                  <ul className="mt-2 divide-y divide-surface-alt rounded-lg border border-surface-alt">
                    {items.map((meeting) => (
                      <li key={meeting.id} className="p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <p className="font-semibold">
                            {partyLabel(meeting.requester)} <span className="font-normal text-muted">et</span> {partyLabel(meeting.target)}
                          </p>
                          <p className={`inline-flex items-center gap-1.5 font-semibold ${STATUS_COLORS[meeting.status]}`}>
                            <StatusIcon status={meeting.status} />
                            {STATUS_LABELS[meeting.status]}
                          </p>
                        </div>
                        <p className="text-muted">{placeLabel(meeting)}</p>
                        {meeting.conflict && (
                          <p className="mt-1 flex items-start gap-2 font-semibold text-danger">
                            <Icon name="alert" />
                            {slot.closed ? "Ce créneau est fermé." : `La table ${meeting.tableNumber} est bloquée sur ce créneau.`}
                          </p>
                        )}
                        {(meeting.canMove || meeting.canCancel) && (
                          <div className="mt-3 flex flex-wrap items-end gap-3">
                            {meeting.canMove && meeting.freeTables.length > 0 && (
                              <>
                                <label className="block text-sm font-semibold">
                                  <span>
                                    Table libre<span className="sr-only"> pour {meeting.requester.name}</span>
                                  </span>
                                  <select
                                    className="mt-1 block min-h-11 rounded-lg border-2 border-title bg-white px-3 text-ink"
                                    value={moveTo[meeting.id] ?? String(meeting.freeTables[0])}
                                    onChange={(event) => setMoveTo({ ...moveTo, [meeting.id]: event.target.value })}
                                  >
                                    {meeting.freeTables.map((table) => (
                                      <option key={table} value={table}>
                                        Table {table}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button type="button" className={buttonClass} disabled={busy} onClick={() => move(meeting)}>
                                  Déplacer<span className="sr-only"> le rendez-vous de {meeting.requester.name}</span>
                                </button>
                              </>
                            )}
                            {meeting.canMove && meeting.freeTables.length === 0 && meeting.conflict && (
                              <p className="text-muted">Aucune table libre sur ce créneau : annulez le rendez-vous.</p>
                            )}
                            {meeting.canCancel && cancelling !== meeting.id && (
                              <button
                                type="button"
                                className={dangerButtonClass}
                                disabled={busy}
                                onClick={() => {
                                  setCancelling(meeting.id);
                                  setReason("");
                                }}
                              >
                                Annuler<span className="sr-only"> le rendez-vous de {meeting.requester.name}</span>
                              </button>
                            )}
                          </div>
                        )}
                        {cancelling === meeting.id && (
                          <div role="group" aria-labelledby={`cancel-${meeting.id}`} className="mt-3 rounded-lg border-2 border-title bg-white p-4">
                            <p id={`cancel-${meeting.id}`} className="font-semibold">
                              Les deux parties recevront un e-mail « annulé par l’organisation ». La table sera libérée.
                            </p>
                            <label className="mt-3 block font-semibold">
                              Motif (facultatif)
                              <input
                                type="text"
                                maxLength={REASON_MAX}
                                className={fieldClass}
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                              />
                            </label>
                            <div className="mt-3 flex flex-wrap gap-3">
                              <button type="button" className={dangerButtonClass} disabled={busy} aria-busy={busy} onClick={() => cancel(meeting)}>
                                {busy ? "Annulation en cours…" : "Confirmer l’annulation"}
                              </button>
                              <button type="button" className={buttonClass} disabled={busy} onClick={() => setCancelling(null)}>
                                Garder le rendez-vous
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <details className="mt-6 border-t border-surface-alt pt-4">
            <summary className="cursor-pointer font-semibold text-title">Bloquer des tables ou fermer un créneau</summary>
            <p className="mt-3 text-muted">
              Un blocage refuse les nouvelles attributions. Les rendez-vous déjà confirmés ne bougent pas : l’écran vous signale ceux qu’il touche.
            </p>
            <label className="mt-4 block max-w-md font-semibold">
              Créneau à régler
              <select className={fieldClass} value={blockSlot} onChange={(event) => chooseBlockSlot(event.target.value)}>
                <option value="">Choisir un créneau</option>
                {data.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slotName(slot)}
                  </option>
                ))}
              </select>
            </label>
            {blockSlot && (
              <>
                <fieldset className="mt-4">
                  <legend className="font-semibold">Tables bloquées sur ce créneau</legend>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                    {blockableTables.map((table) => (
                      <label key={table} className="inline-flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-5"
                          checked={blockTables.includes(table)}
                          onChange={(event) => setBlockTables(event.target.checked ? [...blockTables, table] : blockTables.filter((n) => n !== table))}
                        />
                        Table {table}
                        {data.dedicatedTables.includes(table) && <span className="text-sm text-muted">(dédiée)</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold">
                  <input type="checkbox" className="size-5" checked={blockClosed} onChange={(event) => setBlockClosed(event.target.checked)} />
                  Fermer tout le créneau
                </label>
                <div className="mt-3">
                  <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={busy} onClick={saveBlocks}>
                    Enregistrer le blocage
                  </button>
                </div>
              </>
            )}
            <div className="mt-6 border-t border-surface-alt pt-4">
              <label className="block max-w-md font-semibold">
                Une table sur toute la journée
                <select className={fieldClass} value={dayTable} onChange={(event) => setDayTable(event.target.value)}>
                  <option value="">Choisir une table</option>
                  {blockableTables.map((table) => (
                    <option key={table} value={table}>
                      Table {table}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className={buttonClass} disabled={busy || !dayTable} onClick={() => blockDay(true)}>
                  Bloquer sur toute la journée
                </button>
                <button type="button" className={buttonClass} disabled={busy || !dayTable} onClick={() => blockDay(false)}>
                  Débloquer sur toute la journée
                </button>
              </div>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
