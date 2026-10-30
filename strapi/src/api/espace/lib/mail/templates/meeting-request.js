'use strict';

const NBSP = ' ';

/**
 * `meeting-request` (F-52, A-31, A-33): a request to a person or to an exhibitor's representatives. `slotLabel` is already
 * formatted ("jeudi 3 décembre à 10h45"). `counter` is set when the request answers a refused one with another slot.
 * Each button carries its own 72 hour action link, and neither acts by itself: both open the agenda (Q-13).
 * data = { edition, publicUrl, firstName, requesterName, requesterSubtitle, slotLabel, sessionTitle, message, counter: null | { previousSlotLabel }, acceptUrl, viewUrl }
 */
module.exports = ({ firstName, requesterName, requesterSubtitle, slotLabel, sessionTitle, message, counter, acceptUrl, viewUrl }) => ({
  subject: counter ? `Nouvelle proposition de rendez-vous${NBSP}: ${requesterName}` : `Demande de rendez-vous${NBSP}: ${requesterName}`,
  preheader: `${requesterName} vous propose un rendez-vous le ${slotLabel}.`,
  title: counter ? 'Nouvelle proposition' : 'Demande de rendez-vous',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    counter
      ? `${requesterName}${requesterSubtitle ? ` (${requesterSubtitle})` : ''} n’est pas disponible le ${counter.previousSlotLabel} et vous propose un autre créneau${NBSP}: le ${slotLabel}.`
      : `${requesterName}${requesterSubtitle ? ` (${requesterSubtitle})` : ''} souhaite vous rencontrer le ${slotLabel}${sessionTitle ? `, pendant la pause « ${sessionTitle} »` : ''}.`,
    ...(message ? [`Son message${NBSP}: « ${message} »`] : []),
    'Vous pouvez accepter ou refuser depuis votre agenda. Une table ou un stand est attribué à l’acceptation.',
    { button: { label: 'Accepter', url: acceptUrl } },
    { button: { label: 'Voir la demande', url: viewUrl } },
  ],
});
