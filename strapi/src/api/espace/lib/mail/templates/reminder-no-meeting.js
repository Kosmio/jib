'use strict';

const NBSP = '\u00a0';

const sentence = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0]);

/**
 * `reminder-no-meeting` (R-70 b): no meeting accepted or pending. The button is a 72 hour action link to the directory.
 * data = { firstName, suggestions: [{ displayName, subtitle, initials }], daysLeft, pauses: ['10h45', …], directoryUrl }
 */
module.exports = ({ firstName, suggestions = [], daysLeft, pauses = [], directoryUrl }) => ({
  subject: `${firstName ? `${firstName}, ` : ''}prenez rendez-vous avant les Journées`,
  preheader: 'Les créneaux B2B se remplissent : proposez un rendez-vous en deux minutes.',
  title: daysLeft > 1 ? `Plus que ${daysLeft} jours` : 'Les Journées approchent',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `Vous n’avez pas encore de rendez-vous. Les pauses B2B sont le moment pour rencontrer les participants, les intervenants et les exposants${NBSP}: proposez un créneau depuis l’annuaire.`,
    ...(suggestions.length ? [{ people: { title: 'Ils partagent vos sujets', items: suggestions.map(({ displayName, subtitle, initials }) => ({ name: displayName, subtitle, initials })) } }] : []),
    { button: { label: 'Parcourir l’annuaire', url: directoryUrl } },
    ...(pauses.length ? [{ small: `Les créneaux de rendez-vous se tiennent pendant les pauses B2B de ${sentence(pauses)}.` }] : []),
  ],
});
