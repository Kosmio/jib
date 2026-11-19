'use strict';

const NBSP = ' ';

/**
 * `meeting-accepted` (F-60, R-19, A-33, I-41): the meeting is confirmed ; the .ics of the meeting is attached by the sender.
 * `location` is "Table 3" or "Stand 12" ; `venue` is the name of the place of the edition, or empty. `booking`: a dedicated
 * table reserved directly (R-19), both parties receive this e-mail.
 * data = { edition, publicUrl, firstName, counterpartName, slotLabel, location, venue, agendaUrl, booking }
 */
module.exports = ({ firstName, counterpartName, slotLabel, location, venue, agendaUrl, booking }) => ({
  subject: `Rendez-vous confirmé${NBSP}: ${slotLabel}`,
  preheader: `${counterpartName}, ${slotLabel}, ${location}.`,
  title: 'Rendez-vous confirmé',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    booking
      ? `Votre rendez-vous avec ${counterpartName} est réservé à une table dédiée, sans validation nécessaire.`
      : `Votre rendez-vous avec ${counterpartName} est confirmé.`,
    {
      ul: [
        `Quand${NBSP}: ${slotLabel}`,
        `Où${NBSP}: ${location}${venue ? `, ${venue}` : ''}`,
        `Avec${NBSP}: ${counterpartName}`,
      ],
    },
    'L’invitation de calendrier (.ics) est jointe à ce message. Vous pouvez aussi retrouver le rendez-vous dans votre agenda, et l’annuler jusqu’au début du créneau.',
    { button: { label: 'Voir mon agenda', url: agendaUrl } },
  ],
});
