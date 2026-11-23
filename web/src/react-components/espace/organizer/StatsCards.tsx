import React, { useEffect, useRef, useState } from "react";
import { getStats, percent, type Stats } from "../../../lib/espace/admin";
import { plural } from "../../../lib/espace/format";
import { number, percentLabel, type CardProps } from "./shared";

// Indicateurs (F-90), calculés par `GET /admin/{edition}/stats` ; aucun contenu de message (R-63).
// F-125 : les chiffres se rechargent toutes les 60 s quand l'onglet est visible ; les statistiques fraîches sont aussi publiées par
// l'évènement `STATS_EVENT` (détail : le `Stats`), pour les cartes qui n'ont pas leur propre lecture (SlotsCard).

export const STATS_EVENT = "espace:stats";
const REFRESH_MS = 60_000;

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

export default function StatsCards({ edition, strapiUrl, stats: given }: CardProps & { stats: Stats }) {
  const [stats, setStats] = useState(given);
  const lastLoad = useRef(Date.now());
  const loading = useRef(false);

  useEffect(() => {
    setStats(given);
    lastLoad.current = Date.now();
  }, [given]);

  useEffect(() => {
    async function reload() {
      if (loading.current || document.visibilityState !== "visible") return;
      loading.current = true;
      try {
        const fresh = await getStats(strapiUrl, edition);
        lastLoad.current = Date.now();
        setStats(fresh);
        window.dispatchEvent(new CustomEvent(STATS_EVENT, { detail: fresh }));
      } catch {
        // Une lecture manquée garde les chiffres affichés ; la suivante réessaie.
      } finally {
        loading.current = false;
      }
    }
    const timer = window.setInterval(reload, REFRESH_MS);
    // Onglet resté en arrière-plan : les chiffres sont relus dès son retour, sans attendre la prochaine échéance.
    const onVisible = () => {
      if (Date.now() - lastLoad.current >= REFRESH_MS) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [edition, strapiUrl]);

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
        lines={[`${plural(stats.profilesComplete, "profil")} à 70\u00a0% et plus, sur ${number(attendees.active)}`]}
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
