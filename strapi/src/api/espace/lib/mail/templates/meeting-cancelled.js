'use strict';

const NBSP = ' ';

/**
 * `meeting-cancelled` (T-06, R-18): `slotLabel` is already formatted ("jeudi 3 décembre à 10h45").
 * `reason` is only shown when given ; R-18 does not give it, "Inscription annulée" would read as the recipient's own.
 */
module.exports = ({ firstName, slotLabel, counterpartName, reason, agendaUrl }) => ({
  subject: `Rendez-vous annulé${NBSP}: ${slotLabel}`,
  preheader: 'Le créneau est de nouveau libre.',
  title: 'Rendez-vous annulé',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `Votre rendez-vous avec ${counterpartName} prévu le ${slotLabel} est annulé.`,
    ...(reason ? [`Motif${NBSP}: ${reason}`] : []),
    'Le créneau est de nouveau libre. Vous pouvez proposer un autre rendez-vous depuis l’annuaire ou consulter votre agenda.',
    { button: { label: 'Voir mon agenda', url: agendaUrl } },
  ],
});
