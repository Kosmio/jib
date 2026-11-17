'use strict';

const NBSP = ' ';

/**
 * `meeting-declined` (F-61, R-15, A-30): the request is refused, or closed because the slot is no longer available.
 * `reason` is only shown when given. The button leads to the person's card when she still exists (`profileUrl`, F-127), else to the directory.
 * data = { edition, publicUrl, firstName, counterpartName, slotLabel, reason, directoryUrl, profileUrl? }
 */
module.exports = ({ firstName, counterpartName, slotLabel, reason, directoryUrl, profileUrl }) => ({
  subject: `Demande de rendez-vous refusée${NBSP}: ${slotLabel}`,
  preheader: 'Vous pouvez proposer un autre créneau.',
  title: 'Demande refusée',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `${counterpartName} ne peut pas donner suite à votre demande de rendez-vous du ${slotLabel}.`,
    ...(reason ? [`Motif${NBSP}: ${reason}`] : []),
    'Il reste d’autres créneaux et d’autres profils. Vous pouvez proposer un nouveau rendez-vous depuis l’annuaire.',
    profileUrl ? { button: { label: `Voir la fiche de ${counterpartName}`, url: profileUrl } } : { button: { label: 'Parcourir l’annuaire', url: directoryUrl } },
  ],
});
