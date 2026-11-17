import React, { useState } from "react";
import { groupSlots, percent, regenerateSlots, type SlotFill, type SlotsReport } from "../../../lib/espace/admin";
import { EspaceApiError } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { Card, FeedbackArea, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// Remplissage par pause B2B et régénération des créneaux (R-02, F-94).

type Props = CardProps & {
  slots: SlotFill[];
  /** Couleur d'édition déjà validée (`bannerColor`) pour les barres, ou null (`bg-title`). */
  themeColor: string | null;
  /** Relit les statistiques ; rejette si la lecture échoue. */
  onRefresh: () => Promise<void>;
};

/** Pauses B2B écartées par le calcul des créneaux (R-01) : la pause n'a aucun créneau. */
const SLOT_WARNING_LABELS: Record<string, string> = {
  MISSING_END: "pas d’heure de fin",
  INVALID_TIME: "horaires invalides",
  TOO_SHORT: "plus courte qu’un créneau",
  OVERLAP: "chevauche une autre pause B2B",
};

const SLOTS_FAILED = "Les créneaux n’ont pas pu être régénérés. Vérifiez votre connexion et réessayez.";

/** Compte rendu de R-02 : pauses écartées et créneaux conservés parce qu'ils portent encore des rendez-vous. */
function slotsSummary(report: SlotsReport): Feedback {
  const lines = [
    ...report.warnings.map(
      ({ title, code }) => `« ${title} » : ${SLOT_WARNING_LABELS[code] ?? code}, aucun créneau.`,
    ),
    ...report.orphans.map(
      ({ label, activeMeetings }) =>
        `Le créneau de ${label} ne correspond plus à aucune pause, mais porte encore ${plural(activeMeetings, "rendez-vous", "rendez-vous")} accepté${activeMeetings > 1 ? "s" : ""} ou en attente : il est conservé.`,
    ),
  ];
  if (report.created + report.kept + report.orphans.length === 0) {
    return {
      kind: "alert",
      text: `Aucun créneau : le programme publié de l’édition n’a pas de pause B2B utilisable. Dans Strapi, donnez le type b2b_break aux séquences des pauses, avec leurs heures de début et de fin.${report.removed ? ` ${plural(report.removed, "créneau supprimé", "créneaux supprimés")}.` : ""}`,
      lines,
    };
  }
  const counts = `${plural(report.created, "créneau créé", "créneaux créés")}, ${plural(report.kept, "conservé")}, ${plural(report.removed, "supprimé")}`;
  return { kind: lines.length ? "alert" : "status", text: `Créneaux régénérés : ${counts}.`, lines };
}

export default function SlotsCard({ edition: editionSlug, strapiUrl, slots, themeColor, onRefresh }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [slotsNotice, setSlotsNotice] = useState<Feedback | null>(null);

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setSlotsNotice(null);
    let report: SlotsReport;
    try {
      report = await regenerateSlots(strapiUrl, editionSlug);
    } catch (failure) {
      setRegenerating(false);
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(editionSlug)}/connexion`);
        return;
      }
      setSlotsNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || SLOTS_FAILED });
      return;
    }
    const summary = slotsSummary(report);
    try {
      await onRefresh();
      setSlotsNotice(summary);
    } catch {
      setSlotsNotice({ ...summary, kind: "alert", text: `${summary.text} ${LOAD_FAILED}` });
    }
    setRegenerating(false);
  }

  const groups = groupSlots(slots);
  const tables = [...new Set(slots.map((slot) => slot.tables))];
  const acceptedColor = themeColor ? { backgroundColor: themeColor } : undefined;

  return (
      <Card heading="Rendez-vous par pause B2B">
        {groups.length === 0 ? (
          <p className="mt-4 text-muted">Aucun créneau B2B pour cette édition.</p>
        ) : (
          <>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`size-3 ${themeColor ? "" : "bg-title"}`} style={acceptedColor} />
                Acceptés
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 bg-wood" />
                En attente
              </span>
            </p>
            <ul className="mt-4 space-y-5">
              {groups.map((group, index) => {
                const requests = group.accepted + group.pending;
                const acceptedShare = percent(group.accepted, group.capacity);
                const pendingShare = Math.min(percent(group.pending, group.capacity), 100 - acceptedShare);
                return (
                  <li key={`${group.firstLabel}-${index}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <h3 className="font-heading font-semibold">
                        {group.title}, {group.firstLabel} ({plural(group.slots, "créneau", "créneaux")})
                      </h3>
                      <p className="text-muted">{plural(requests, "demande")}</p>
                    </div>
                    <div className="mt-2 flex h-4 gap-0.5 overflow-hidden rounded-lg bg-surface-alt">
                      <span
                        className={`block h-full ${themeColor ? "" : "bg-title"}`}
                        style={{ width: `${acceptedShare}%`, ...acceptedColor }}
                      />
                      <span className="block h-full bg-wood" style={{ width: `${pendingShare}%` }} />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {plural(group.accepted, "accepté")}, {group.pending} en attente, capacité de {plural(group.capacity, "rendez-vous", "rendez-vous")}
                    </p>
                  </li>
                );
              })}
            </ul>
            {tables.length === 1 && (
              <p className="mt-4 text-muted">Capacité de {plural(tables[0], "table")} par créneau.</p>
            )}
          </>
        )}
        <div className="mt-6 border-t border-surface-alt pt-4">
          <p className="text-muted">
            Les créneaux sont calculés à partir des pauses B2B du programme. Régénérez-les après avoir ajouté une pause ou changé ses
            horaires dans Strapi&nbsp;: un créneau qui porte un rendez-vous n’est jamais supprimé.
          </p>
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            aria-busy={regenerating}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            {regenerating ? "Régénération en cours…" : "Régénérer les créneaux"}
          </button>
          <FeedbackArea feedback={slotsNotice} />
        </div>
      </Card>
  );
}
