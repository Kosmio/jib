import React, { useEffect, useState } from "react";
import { agoLabel, getServiceStatus, type ServiceStatus } from "../../../lib/espace/admin";
import { plural } from "../../../lib/espace/format";
import { Card, Icon, LOAD_FAILED, type CardProps } from "./shared";

// F-106, carte « État du service » : une ligne rouge par anomalie, avec ce qu'il faut faire.

type Line = { key: string; text: string };

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function anomalies({ mail, helloasso, cron }: ServiceStatus): Line[] {
  const lines: Line[] = [];
  if (!mail.senderConfigured && mail.provider !== "console") {
    lines.push({ key: "sender", text: "L’adresse d’expédition est absente, aucun e-mail ne peut partir. Renseignez EMAIL_FROM sur le serveur, puis redémarrez Strapi." });
  }
  if (mail.failedLast24h > 0) {
    const reason = mail.lastError ? ` Dernière erreur : ${sentence(mail.lastError)}` : "";
    lines.push({ key: "failed", text: `${plural(mail.failedLast24h, "e-mail en échec", "e-mails en échec")} ces dernières 24 heures.${reason} Vérifiez la clé et le domaine d’envoi chez le fournisseur.` });
  }
  if (mail.abandoned?.length) {
    lines.push({
      key: "abandoned",
      text: `Trois échecs de suite, plus de nouvel essai pour ${mail.abandoned.map(({ email }) => email).join(", ")}. Vérifiez ces adresses, puis relancez l’envoi de bienvenue.`,
    });
  }
  if (!helloasso.configured) {
    lines.push({ key: "helloasso", text: "HelloAsso n’est pas configuré pour cette édition. Renseignez son formulaire HelloAsso dans Strapi." });
  } else if (helloasso.lastRunStatus === "error") {
    lines.push({ key: "run", text: "La dernière synchronisation HelloAsso a échoué. Consultez l’historique des synchronisations ci-dessous." });
  }
  if (!cron.enabled) {
    lines.push({ key: "cron", text: "Les tâches planifiées sont désactivées, la synchronisation automatique ne tourne pas. Réglez CRON_ENABLED à true sur le serveur, puis redémarrez Strapi." });
  }
  return lines;
}

export default function ServiceCard({ edition, strapiUrl }: CardProps) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getServiceStatus(strapiUrl, edition).then(
      (value) => current && setStatus(value),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [edition, strapiUrl]);

  const lines = status ? anomalies(status) : [];

  return (
    <Card heading="État du service">
      <div aria-live="polite">
        {failed && <p className="mt-4 text-muted">{LOAD_FAILED}</p>}
        {!status && !failed && <p className="mt-4 text-muted">Chargement…</p>}
        {status && (
          <>
            {lines.length === 0 ? (
              <p className="mt-4 flex items-center gap-3 text-muted">
                <span className="text-primary-ink">
                  <Icon name="check" />
                </span>
                Aucune anomalie.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {lines.map(({ key, text }) => (
                  <li key={key} className="flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
                    <span className="text-danger">
                      <Icon name="alert" />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-muted">
              Espace participant {status.space.enabled ? "ouvert" : "fermé"}. E-mail de bienvenue{" "}
              {status.space.welcomeStartedAt ? `envoyé ${agoLabel(status.space.welcomeStartedAt)}` : "pas encore envoyé"}.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
