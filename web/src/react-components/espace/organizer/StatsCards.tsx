import React from "react";
import { percent, type Stats } from "../../../lib/espace/admin";
import { plural } from "../../../lib/espace/format";
import { number, percentLabel, type CardProps } from "./shared";

// Indicateurs (F-90), calculés par `GET /admin/{edition}/stats` ; aucun contenu de message (R-63).

function Indicator({ label, value, lines }: { label: string; value: string; lines: string[] }) {
  return (
    <li className="rounded-xl border border-surface-alt bg-white p-5">
      <h3 className="font-heading font-semibold">{label}</h3>
      <p className="mt-1 font-heading text-4xl font-semibold text-title">{value}</p>
      {lines.map((line) => (
        <p key={line} className="mt-1 text-muted">
          {line}
        </p>
      ))}
    </li>
  );
}

export default function StatsCards({ stats }: CardProps & { stats: Stats }) {
  const { attendees, meetings } = stats;
  const byRole = attendees.byRole ?? {};
  const closed = meetings.declined + meetings.cancelled + meetings.expired;

  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <Indicator
        label="Inscrits importés"
        value={number(attendees.active)}
        lines={[
          `dont ${plural(byRole.exhibitor_rep ?? 0, "représentant d’exposant", "représentants d’exposants")} et ${plural(byRole.speaker ?? 0, "intervenant")}`,
          ...(attendees.cancelled ? [plural(attendees.cancelled, "inscription annulée", "inscriptions annulées")] : []),
        ]}
      />
      <Indicator
        label="Espaces activés"
        value={number(stats.activated)}
        lines={[
          `sur ${plural(attendees.active, "inscrit")} (${percentLabel(percent(stats.activated, attendees.active))})`,
          `${plural(stats.consented, "choix de visibilité enregistré", "choix de visibilité enregistrés")}`,
        ]}
      />
      <Indicator
        label="Profils complets"
        value={percentLabel(percent(stats.profilesComplete, attendees.active))}
        lines={[`${plural(stats.profilesComplete, "profil")} sur ${number(attendees.active)}`]}
      />
      <Indicator
        label="Annuaire"
        value={number(stats.directoryOptIn)}
        lines={[`${stats.directoryOptIn < 2 ? "participant visible" : "participants visibles"} dans l’annuaire`]}
      />
      <Indicator
        label="Rendez-vous"
        value={number(meetings.accepted + meetings.pending)}
        lines={[
          `${plural(meetings.accepted, "accepté")}, ${plural(meetings.pending, "en attente", "en attente")}`,
          ...(closed ? [`${plural(closed, "refusé, annulé ou expiré", "refusés, annulés ou expirés")}`] : []),
        ]}
      />
      <Indicator label="Messages" value={number(stats.messages)} lines={["messages échangés"]} />
    </ul>
  );
}
