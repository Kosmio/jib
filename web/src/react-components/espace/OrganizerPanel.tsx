import React, { useState } from "react";
import { getStats, getSyncRuns, type Stats, type SyncRun } from "../../lib/espace/admin";
import AttendeesCard from "./organizer/AttendeesCard";
import BadgesCard from "./organizer/BadgesCard";
import ExhibitorsCard from "./organizer/ExhibitorsCard";
import ExportsCard from "./organizer/ExportsCard";
import MeetingsCard from "./organizer/MeetingsCard";
import ReportsCard from "./organizer/ReportsCard";
import RemindersCard from "./organizer/RemindersCard";
import ServiceCard from "./organizer/ServiceCard";
import SlotsCard from "./organizer/SlotsCard";
import StatsCards from "./organizer/StatsCards";
import SyncCard from "./organizer/SyncCard";
import SyncHistory from "./organizer/SyncHistory";
import WarningsCard from "./organizer/WarningsCard";
import WelcomeCard from "./organizer/WelcomeCard";

// E9, tableau de bord organisateur (A-39) : assembleur des cartes de `organizer/`. Chaque carte reçoit `{ edition, strapiUrl }`.
// Les statistiques et l'historique de synchronisation, lus par le rendu serveur, sont partagés par les cartes existantes ;
// les cartes nouvelles (service, bienvenue, relances, participants, rendez-vous) chargent leurs données elles-mêmes.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  /** Instant du rendu serveur : l'ancienneté de la synchronisation s'affiche pareil au serveur et à l'hydratation. */
  nowIso: string;
  /** Couleur d'édition déjà validée (`bannerColor`) pour les barres, ou null (`bg-title`). */
  themeColor: string | null;
  initialStats: Stats;
  initialRuns: SyncRun[];
};

export default function OrganizerPanel({ strapiUrl, editionSlug, nowIso, themeColor, initialStats, initialRuns }: Props) {
  const [stats, setStats] = useState(initialStats);
  const [runs, setRuns] = useState(initialRuns);
  const card = { edition: editionSlug, strapiUrl };

  const refreshStats = async () => setStats(await getStats(strapiUrl, editionSlug));
  const refreshAll = async () => {
    const [freshStats, freshRuns] = await Promise.all([getStats(strapiUrl, editionSlug), getSyncRuns(strapiUrl, editionSlug)]);
    setStats(freshStats);
    setRuns(freshRuns);
  };

  return (
    <div className="space-y-6">
      <ServiceCard {...card} />
      <SyncCard {...card} lastSync={stats.lastSync} nowIso={nowIso} onRefresh={refreshAll} />
      <WelcomeCard {...card} />
      <StatsCards {...card} stats={stats} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <SlotsCard {...card} slots={stats.slots} themeColor={themeColor} onRefresh={refreshStats} />
        <ExhibitorsCard {...card} stats={stats} />
      </div>
      <ExportsCard {...card} />
      <BadgesCard {...card} />
      <RemindersCard {...card} />
      <AttendeesCard {...card} />
      <MeetingsCard {...card} />
      <ReportsCard {...card} />
      <WarningsCard {...card} stats={stats} />
      <SyncHistory {...card} runs={runs} />
    </div>
  );
}
