import { useEffect } from "react";

// F-150 : rafraîchit à la minute les repères « En cours » et « À suivre » du programme (E8). Le rendu serveur pose déjà ces repères,
// sans JavaScript (NF-31) : cet îlot ne fait que les tenir à jour dans la page, sans rien afficher lui-même, et ouvre le programme sur
// la séquence en cours. L'heure part de celle du serveur (`now`), qui peut être simulée en test, puis avance avec l'horloge du navigateur.

export type NowSession = { id: string; startsAt: string; until: string };

const LABELS = { current: "En cours", next: "À suivre" } as const;

function stateOf(sessions: NowSession[], now: number): Map<string, "current" | "next"> {
  const states = new Map<string, "current" | "next">();
  let upcoming: number | null = null;
  for (const { id, startsAt, until } of sessions) {
    const start = Date.parse(startsAt);
    if (start <= now && now < Date.parse(until)) states.set(id, "current");
    else if (start > now && (upcoming === null || start === upcoming)) {
      upcoming = start;
      states.set(id, "next");
    }
  }
  return states;
}

function apply(sessions: NowSession[], now: number): void {
  const states = stateOf(sessions, now);
  document.getElementById("en-cours")?.removeAttribute("id");
  for (const item of document.querySelectorAll<HTMLElement>("[data-session-id]")) {
    const state = states.get(item.dataset.sessionId ?? "");
    if (state) item.dataset.state = state;
    else delete item.dataset.state;
    const badge = item.querySelector<HTMLElement>("[data-state-badge]");
    if (!badge) continue;
    badge.hidden = !state;
    badge.textContent = state ? LABELS[state] : "";
    if (state) badge.dataset.state = state;
    else delete badge.dataset.state;
    if (state === "current") item.id = "en-cours";
  }
  const jump = document.querySelector<HTMLElement>("[data-jump-now]");
  if (jump) jump.hidden = ![...states.values()].includes("current");
}

export default function ProgramNow({ sessions, now }: { sessions: NowSession[]; now: string }) {
  useEffect(() => {
    const offset = Date.parse(now) - Date.now();
    const tick = () => apply(sessions, Date.now() + offset);
    // Ouverture sur la séquence en cours (ou, à défaut, la suivante), sauf si l'adresse cible déjà un onglet ou une ancre.
    if (!location.hash) {
      const target = document.querySelector<HTMLElement>('[data-session-id][data-state="current"]') ?? document.querySelector<HTMLElement>('[data-session-id][data-state="next"]');
      target?.scrollIntoView({ block: "center" });
    }
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [sessions, now]);
  return null;
}
