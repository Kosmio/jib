'use strict';

const NBSP = '\u00a0';

/**
 * `reminder-eve` (R-70 c, R-17, 08-relance): the day before, 16h00. Accepted meetings of the day (the .ics is attached by the sender),
 * requests that expired when the window closed, place and access. Without any meeting: the short form.
 * data = { firstName, dayLabel: 'jeudi 3 décembre', meetings: [{ time, counterpartName, location }], expired: [{ time, counterpartName }],
 *          venue: { name, address, mapUrl, description } | null, agendaUrl }
 */
module.exports = ({ firstName, dayLabel, meetings = [], expired = [], venue, agendaUrl }) => {
  const hello = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const place = venue ? [venue.name, venue.address && String(venue.address).replace(/\s*\r?\n\s*/g, ', ')].filter(Boolean).join(', ') : '';
  const where = [
    ...(place ? [`Lieu${NBSP}: ${place}`] : []),
    ...(venue?.description ? [`Accès${NBSP}: ${String(venue.description).replace(/\s*\r?\n\s*/g, ' ')}`] : []),
  ];
  const lines = (items) => items.map(({ time, counterpartName, location }) => `${time}${NBSP}: ${counterpartName}${location ? `, ${location}` : ''}`);

  return {
    subject: meetings.length
      ? `${firstName ? `${firstName}, ` : ''}${meetings.length > 1 ? `vos ${meetings.length} rendez-vous` : 'votre rendez-vous'} du ${dayLabel}`
      : `${firstName ? `${firstName}, ` : ''}les Journées, c’est le ${dayLabel}`,
    preheader: meetings.length ? `Votre agenda du ${dayLabel}, le lieu et l’accès.` : `Rendez-vous le ${dayLabel}${place ? `, ${place}` : ''}.`,
    title: meetings.length ? 'Votre agenda' : 'À très vite',
    blocks: [
      hello,
      meetings.length
        ? `Les Journées de l’Innovation Filière Bois ont lieu le ${dayLabel}. Vos rendez-vous acceptés${NBSP}:`
        : `Les Journées de l’Innovation Filière Bois ont lieu le ${dayLabel}. Vous n’avez pas de rendez-vous prévu${NBSP}: les pauses B2B restent ouvertes à la rencontre sur place.`,
      ...(meetings.length ? [{ ul: lines(meetings) }, 'L’invitation de calendrier (.ics) est jointe à ce message.'] : []),
      ...(expired.length
        ? [`Ces demandes n’ont pas reçu de réponse avant la fermeture des demandes${NBSP}:`, { ul: lines(expired) }]
        : []),
      ...(where.length ? [{ heading: 'Lieu et accès' }, { ul: where }] : []),
      ...(venue?.mapUrl ? [{ url: venue.mapUrl }] : []),
      { button: { label: 'Voir mon agenda', url: agendaUrl } },
    ],
  };
};
