import React, { useEffect, useMemo, useRef, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { hourLabel } from "../../../lib/espace/meetings";
import { FeedbackArea, Icon, type Feedback } from "./shared";
import { STATUS_LABELS, type AdminData, type AdminMeeting, type AdminSlot, type BlocksResult } from "./MeetingsCard";
import { buttonDanger, buttonPrimary, buttonSecondary, controlClass } from "./ui";

// Onglet « Vue B2B » de l'interface organisation (15-administration.md, AD-4) : grille des créneaux par tables et stands d'une pause,
// chaque case portant son rendez-vous (F-181) ; déplacer, annuler, bloquer une table (F-139 à F-141, R-90) ; mode « jour J » (F-182) :
// plein écran, créneau en cours mis en avant, rafraîchi toutes les 30 secondes, sans action destructrice.
// Données et actions : routes existantes de la carte « Rendez-vous » (GET /meetings, /meetings/{id}/move, /cancel, PUT /slots/{id}/blocks).

type Props = { edition: string; strapiUrl: string; slotMinutes: number; initialDayMode?: boolean };

type Group = { key: string; title: string; slots: AdminSlot[] };
type Selection = { kind: "meeting"; meeting: AdminMeeting } | { kind: "table"; slot: AdminSlot; table: number } | null;

const ACTIVE = new Set(["pending", "accepted"]);
const REFRESH_MS = 30_000;
const enc = encodeURIComponent;
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Pauses B2B : créneaux consécutifs de même séance, dans l'ordre horaire. */
function groupsOf(slots: AdminSlot[]): Group[] {
  const groups: Group[] = [];
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const last = groups.at(-1);
    if (last && last.title === (slot.sessionTitle ?? "")) last.slots.push(slot);
    else groups.push({ key: slot.id, title: slot.sessionTitle ?? "", slots: [slot] });
  }
  return groups;
}

const shortName = (name: string) => name.trim();

export default function B2BBoard({ edition, strapiUrl, slotMinutes, initialDayMode = false }: Props) {
  const base = `/admin/${enc(edition)}`;
  const [data, setData] = useState<AdminData | null>(null);
  const [failed, setFailed] = useState(false);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dayMode, setDayMode] = useState(initialDayMode);
  const [now, setNow] = useState(() => Date.now());
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setData(await request<AdminData>(strapiUrl, `${base}/meetings`, "GET"));
      setFailed(false);
      setRefreshedAt(Date.now());
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, [edition, strapiUrl]);

  useEffect(() => {
    if (!dayMode) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [dayMode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (dayMode) url.searchParams.set("jour", "1");
    else url.searchParams.delete("jour");
    window.history.replaceState(null, "", url);
    if (dayMode) setSelection(null);
  }, [dayMode]);

  const groups = useMemo(() => groupsOf(data?.slots ?? []), [data]);
  const slotEnd = (slot: AdminSlot) => Date.parse(slot.startsAt) + slotMinutes * 60_000;
  const currentSlot = data?.slots.find((slot) => now >= Date.parse(slot.startsAt) && now < slotEnd(slot)) ?? null;
  // Pause affichée : celle choisie, sinon celle du créneau en cours, sinon la prochaine, sinon la première.
  const group =
    groups.find((item) => item.key === groupKey) ??
    groups.find((item) => item.slots.some((slot) => slot.id === currentSlot?.id)) ??
    groups.find((item) => item.slots.some((slot) => slotEnd(slot) > now)) ??
    groups[0];

  const active = (data?.meetings ?? []).filter((meeting) => ACTIVE.has(meeting.status));
  const needle = fold(query.trim());
  const matches = (meeting: AdminMeeting) => !needle || fold(`${meeting.requester.name} ${meeting.target.name}`).includes(needle);
  const tables = Array.from({ length: data?.tablesCount ?? 0 }, (_, index) => index + 1);
  const dedicated = new Set(data?.dedicatedTables ?? []);
  const atTable = (slot: AdminSlot, table: number) => active.find((meeting) => meeting.slot.id === slot.id && meeting.tableNumber === table);
  const atStands = (slot: AdminSlot) => active.filter((meeting) => meeting.slot.id === slot.id && meeting.tableNumber === null);
  const pendingNoTable = (slot: AdminSlot) => atStands(slot).filter((meeting) => !meeting.location);
  const groupMeetings = group ? active.filter((meeting) => group.slots.some((slot) => slot.id === meeting.slot.id)) : [];
  const found = needle ? active.filter(matches) : [];

  async function act<T>(call: () => Promise<T>, done: string): Promise<T | null> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await call();
      await load();
      setNotice({ kind: "status", text: done });
      return result;
    } catch (error) {
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(`/espace/${enc(edition)}/connexion`);
        return null;
      }
      setNotice({ kind: "alert", text: (error instanceof EspaceApiError && error.status !== 0 && error.message) || "L’action a échoué. Réessayez." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.current?.requestFullscreen?.().catch(() => undefined);
  }

  if (failed && !data) {
    return <FeedbackArea feedback={{ kind: "alert", text: "La vue B2B n’a pas pu être chargée. Rechargez la page." }} />;
  }
  if (!data) return <p className="text-muted" role="status">Chargement des rendez-vous…</p>;
  if (!groups.length) {
    return (
      <div className="rounded-xl border border-surface-alt bg-white p-6">
        <p className="font-semibold">Aucun créneau de rendez-vous pour l’instant.</p>
        <p className="mt-1 text-muted">Marquez les pauses B2B du programme puis régénérez les créneaux dans l’onglet Édition.</p>
      </div>
    );
  }

  return (
    <div ref={root} className={dayMode ? "min-h-full bg-surface p-4 md:p-6" : ""}>
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div role="group" aria-label="Pause affichée" className="flex flex-wrap gap-2">
          {groups.map((item) => {
            const selected = item.key === group?.key;
            const first = item.slots[0];
            const last = item.slots.at(-1)!;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setGroupKey(item.key);
                  setSelection(null);
                }}
                className={`min-h-11 rounded-lg border-2 px-3 text-left leading-tight ${selected ? "border-title bg-title text-white" : "border-surface-alt bg-white text-title hover:border-title"}`}
              >
                <span className="block text-sm font-bold">
                  {hourLabel(first.startsAt)} à {hourLabel(new Date(slotEnd(last)).toISOString())}
                </span>
                <span className={`block text-xs ${selected ? "text-white" : "text-muted"}`}>{item.title || "Pause B2B"}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="b2b-recherche" className="block text-sm font-semibold">
            Chercher une personne
          </label>
          <input id="b2b-recherche" type="search" className={controlClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom ou entreprise" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={dayMode} className={dayMode ? buttonPrimary : buttonSecondary} onClick={() => setDayMode(!dayMode)}>
            {dayMode ? "Quitter le mode jour J" : "Mode jour J"}
          </button>
          {dayMode && (
            <button type="button" className={buttonSecondary} onClick={() => void toggleFullscreen()}>
              Plein écran
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {plural(groupMeetings.filter((m) => m.status === "accepted").length, "rendez-vous confirmé")}, {plural(groupMeetings.filter((m) => m.status === "pending").length, "demande")} en attente sur cette pause.
        {dayMode && refreshedAt && ` Actualisé à ${hourLabel(new Date(refreshedAt).toISOString())}, toutes les 30 secondes.`}
        {needle && ` ${plural(found.length, "rendez-vous trouvé", "rendez-vous trouvés")} pour « ${query.trim()} ».`}
      </p>

      {needle && found.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {found.map((meeting) => (
            <li key={meeting.id}>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-surface-alt bg-white px-3 text-left text-sm hover:border-title"
                onClick={() => {
                  setGroupKey(groups.find((item) => item.slots.some((slot) => slot.id === meeting.slot.id))?.key ?? null);
                  if (!dayMode) setSelection({ kind: "meeting", meeting });
                }}
              >
                <span className="font-semibold">{meeting.slot.label}</span> {meeting.location ?? "sans lieu"} : {meeting.requester.name} et {meeting.target.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Grille */}
      {group && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-surface-alt bg-white">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Rendez-vous de la pause {group.title}, par créneau et par table
            </caption>
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">
                  Créneau
                </th>
                {tables.map((table) => (
                  <th key={table} scope="col" className="min-w-36 px-2 py-2 text-left font-semibold whitespace-nowrap">
                    Table {table}
                    {dedicated.has(table) && <span className="ml-1 rounded bg-white px-1.5 text-xs font-semibold text-wood-dark">dédiée</span>}
                  </th>
                ))}
                <th scope="col" className="min-w-44 px-2 py-2 text-left font-semibold">
                  Stands et en attente
                </th>
              </tr>
            </thead>
            <tbody>
              {group.slots.map((slot) => {
                const isNow = slot.id === currentSlot?.id;
                const past = slotEnd(slot) <= now;
                return (
                  <tr key={slot.id} className={`border-t border-surface-alt ${isNow ? "bg-gold/15" : past && dayMode ? "opacity-60" : ""}`}>
                    <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left align-top whitespace-nowrap ${isNow ? "bg-gold-light" : "bg-white"}`}>
                      <span className={`font-bold tabular-nums ${dayMode ? "text-lg" : ""}`}>{slot.label}</span>
                      {isNow && <span className="block text-xs font-bold text-gold-ink">en cours</span>}
                      {slot.closed && <span className="block text-xs font-semibold text-danger">créneau fermé</span>}
                    </th>
                    {tables.map((table) => {
                      const meeting = atTable(slot, table);
                      const blocked = slot.blockedTables.includes(table);
                      const selected =
                        (selection?.kind === "meeting" && meeting && selection.meeting.id === meeting.id) ||
                        (selection?.kind === "table" && selection.slot.id === slot.id && selection.table === table);
                      const dim = needle && meeting && !matches(meeting);
                      return (
                        <td key={table} className="border-l border-surface-alt p-1 align-top">
                          <Cell
                            meeting={meeting}
                            blocked={blocked}
                            dim={Boolean(dim)}
                            selected={Boolean(selected)}
                            large={dayMode}
                            disabled={dayMode}
                            label={`${slot.label}, table ${table}`}
                            onSelect={() => setSelection(meeting ? { kind: "meeting", meeting } : { kind: "table", slot, table })}
                          />
                        </td>
                      );
                    })}
                    <td className="border-l border-surface-alt p-1 align-top">
                      <ul className="space-y-1">
                        {atStands(slot).map((meeting) => (
                          <li key={meeting.id}>
                            <Cell
                              meeting={meeting}
                              blocked={false}
                              dim={Boolean(needle && !matches(meeting))}
                              selected={selection?.kind === "meeting" && selection.meeting.id === meeting.id}
                              large={dayMode}
                              disabled={dayMode}
                              place={meeting.location ?? "Lieu à l’acceptation"}
                              label={`${slot.label}, ${meeting.location ?? "sans lieu"}`}
                              onSelect={() => setSelection({ kind: "meeting", meeting })}
                            />
                          </li>
                        ))}
                        {atStands(slot).length === 0 && <li className="px-2 py-1 text-muted">aucun</li>}
                      </ul>
                      {pendingNoTable(slot).length > 0 && <span className="sr-only">{plural(pendingNoTable(slot).length, "demande")} sans lieu</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Legend />

      {!dayMode && selection && (
        <Details
          key={selection.kind === "meeting" ? selection.meeting.id : `${selection.slot.id}-${selection.table}`}
          selection={selection}
          slots={data.slots}
          busy={busy}
          onClose={() => setSelection(null)}
          onMove={(meeting, table) =>
            act(() => request(strapiUrl, `${base}/meetings/${enc(meeting.id)}/move`, "POST", { table }), `Rendez-vous déplacé à la table ${table}.`).then((done) => done !== null && setSelection(null))
          }
          onCancel={(meeting, reason) =>
            act(
              () => request(strapiUrl, `${base}/meetings/${enc(meeting.id)}/cancel`, "POST", { reason: reason.trim() || undefined }),
              "Rendez-vous annulé. Les deux personnes sont prévenues par e-mail et la table est libérée."
            ).then((done) => done !== null && setSelection(null))
          }
          onBlock={(slot, table, block) => {
            const blockedTables = block ? [...slot.blockedTables, table] : slot.blockedTables.filter((n) => n !== table);
            return act(
              () => request<BlocksResult>(strapiUrl, `${base}/slots/${enc(slot.id)}/blocks`, "PUT", { blockedTables, closed: slot.closed }),
              block ? `Table ${table} bloquée à ${slot.label}.` : `Table ${table} débloquée à ${slot.label}.`
            ).then(() => setSelection(null));
          }}
        />
      )}
      <FeedbackArea feedback={notice} />
    </div>
  );
}

function Cell({
  meeting,
  blocked,
  dim,
  selected,
  large,
  disabled,
  place,
  label,
  onSelect,
}: {
  meeting: AdminMeeting | undefined;
  blocked: boolean;
  dim: boolean;
  selected: boolean;
  large: boolean;
  disabled: boolean;
  place?: string;
  label: string;
  onSelect: () => void;
}) {
  const ring = selected ? "ring-2 ring-title ring-offset-1" : "";
  const size = large ? "min-h-20 text-base" : "min-h-16";
  if (!meeting) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-label={`${label} : ${blocked ? "table bloquée" : "libre"}`}
        className={`flex w-full items-center rounded-md px-2 ${size} ${ring} ${
          blocked ? "b2b-blocked text-muted" : "text-muted/70 hover:bg-surface"
        } disabled:cursor-default disabled:hover:bg-transparent`}
      >
        {blocked ? "bloquée" : <span aria-hidden="true">libre</span>}
      </button>
    );
  }
  const accepted = meeting.status === "accepted";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-label={`${label} : ${meeting.requester.name} et ${meeting.target.name}, ${STATUS_LABELS[meeting.status].toLowerCase()}`}
      className={`block w-full rounded-md border-2 px-2 py-1.5 text-left ${size} ${ring} ${dim ? "opacity-30" : ""} ${
        accepted ? "border-primary-dark/30 bg-surface" : "border-dashed border-wood bg-white"
      } ${meeting.conflict ? "outline-2 outline-danger" : ""} disabled:cursor-default`}
    >
      {place && <span className="block text-xs font-semibold text-muted">{place}</span>}
      <span className="block leading-tight font-semibold">{shortName(meeting.requester.name)}</span>
      <span className="block leading-tight">{shortName(meeting.target.name)}</span>
      <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${accepted ? "text-primary-ink" : "text-wood-dark"}`}>
        {accepted ? "confirmé" : "en attente"}
        {meeting.conflict && <span className="text-danger">, conflit</span>}
      </span>
    </button>
  );
}

function Legend() {
  return (
    <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block size-4 rounded border-2 border-primary-dark/30 bg-surface" />
        confirmé
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block size-4 rounded border-2 border-dashed border-wood bg-white" />
        en attente de réponse
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="b2b-blocked inline-block size-4 rounded" />
        table bloquée
      </span>
      <span>Cliquez sur une case pour agir dessus.</span>
    </p>
  );
}

function Details({
  selection,
  slots,
  busy,
  onClose,
  onMove,
  onCancel,
  onBlock,
}: {
  selection: NonNullable<Selection>;
  slots: AdminSlot[];
  busy: boolean;
  onClose: () => void;
  onMove: (meeting: AdminMeeting, table: number) => void;
  onCancel: (meeting: AdminMeeting, reason: string) => void;
  onBlock: (slot: AdminSlot, table: number, block: boolean) => void;
}) {
  const [table, setTable] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const panel = "mt-4 rounded-xl border-2 border-title bg-white p-5";
  if (selection.kind === "table") {
    const { slot, table: number } = selection;
    const blocked = slot.blockedTables.includes(number);
    return (
      <section aria-labelledby="b2b-detail" className={panel}>
        <h2 id="b2b-detail" ref={heading} tabIndex={-1} className="font-heading text-lg font-semibold normal-case">
          Table {number}, {slot.label}
        </h2>
        <p className="mt-1 text-muted">{blocked ? "Cette table est bloquée : aucun rendez-vous ne peut y être placé." : "Table libre sur ce créneau."}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={buttonSecondary} disabled={busy} onClick={() => onBlock(slot, number, !blocked)}>
            {blocked ? "Débloquer la table" : "Bloquer la table"}
          </button>
          <button type="button" className={buttonSecondary} onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    );
  }

  const { meeting } = selection;
  const current = slots.find((slot) => slot.id === meeting.slot.id);
  return (
    <section aria-labelledby="b2b-detail" className={panel}>
      <h2 id="b2b-detail" ref={heading} tabIndex={-1} className="font-heading text-lg font-semibold normal-case">
        {meeting.slot.label}, {meeting.location ?? "lieu attribué à l’acceptation"}
      </h2>
      <p className="mt-1">
        <span className="font-semibold">{meeting.requester.name}</span>
        {meeting.requester.subtitle && <span className="text-muted"> ({meeting.requester.subtitle})</span>} avec <span className="font-semibold">{meeting.target.name}</span>
        {meeting.target.subtitle && <span className="text-muted"> ({meeting.target.subtitle})</span>}
      </p>
      <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold">
        <Icon name={meeting.status === "accepted" ? "check" : "alert"} />
        {STATUS_LABELS[meeting.status]}
        {meeting.conflict && <span className="text-danger">: deux rendez-vous à la même table, déplacez-en un.</span>}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {meeting.canMove && meeting.freeTables.length > 0 && (
          <>
            <div>
              <label htmlFor="b2b-table" className="block text-sm font-semibold">
                Déplacer vers
              </label>
              <select id="b2b-table" className={controlClass()} value={table || String(meeting.freeTables[0])} onChange={(event) => setTable(event.target.value)}>
                {meeting.freeTables.map((free) => (
                  <option key={free} value={free}>
                    Table {free}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => onMove(meeting, Number(table || meeting.freeTables[0]))}>
              Déplacer
            </button>
          </>
        )}
        {meeting.canMove && meeting.freeTables.length === 0 && <p className="text-sm text-muted">Aucune table libre sur ce créneau{current?.closed ? " (créneau fermé)" : ""}.</p>}
        {meeting.canCancel && !cancelling && (
          <button type="button" className={buttonDanger} onClick={() => setCancelling(true)}>
            Annuler le rendez-vous
          </button>
        )}
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Fermer
        </button>
      </div>

      {cancelling && (
        <div role="alertdialog" aria-labelledby="b2b-cancel" className="mt-4 rounded-lg bg-surface p-4">
          <p id="b2b-cancel" className="font-semibold">
            Annuler ce rendez-vous ?
          </p>
          <p className="text-sm text-muted">Les deux personnes reçoivent un e-mail. Le motif, facultatif, y figure.</p>
          <label htmlFor="b2b-reason" className="mt-3 block text-sm font-semibold">
            Motif (facultatif)
          </label>
          <input id="b2b-reason" maxLength={200} className={controlClass()} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={buttonDanger} disabled={busy} onClick={() => onCancel(meeting, reason)}>
              Confirmer l’annulation
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setCancelling(false)}>
              Garder le rendez-vous
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
