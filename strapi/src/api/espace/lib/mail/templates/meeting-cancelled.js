'use strict';

const NBSP = ' ';

/**
 * `meeting-cancelled` (T-06, R-18): `slotLabel` is already formatted ("jeudi 3 décembre à 10h45").
 * `byOrganizer` (F-140): the organization cancelled the meeting, the text says so. `reason` is only shown when given ; R-18 does not give it, "Inscription annulée" would read as the recipient's own.
 */
module.exports = ({ firstName, slotLabel, counterpartName, reason, byOrganizer, agendaUrl }) => ({
  subject: `Rendez-vous annulé${NBSP}: ${slotLabel}`,
  preheader: 'Le créneau est de nouveau libre.',
  title: 'Rendez-vous annulé',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    byOrganizer
      ? `Votre rendez-vous avec ${counterpartName} prévu le ${slotLabel} a été annulé par l’organisation.`
      : `Votre rendez-vous avec ${counterpartName} prévu le ${slotLabel} est annulé.`,
    ...(reason ? [`Motif${NBSP}: ${reason}`] : []),
    'Le créneau est de nouveau libre. Vous pouvez proposer un autre rendez-vous depuis l’annuaire ou consulter votre agenda.',
    { button: { label: 'Voir mon agenda', url: agendaUrl } },
  ],
});
