'use strict';

const NBSP = ' ';

/**
 * `new-message` (R-62, F-73): sent when a message is still unread after 5 minutes, at most once per conversation and recipient every 30 minutes.
 * `excerpt` is the beginning of the message, 200 characters at most ; `threadUrl` is a 72 hour action link to the conversation (I-21).
 * The e-mail never carries more than the excerpt (R-63).
 */
module.exports = ({ firstName, authorName, excerpt, threadUrl }) => ({
  subject: `Nouveau message${NBSP}: ${authorName}`,
  preheader: excerpt,
  title: 'Nouveau message',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `${authorName} vous a écrit${NBSP}:`,
    `«${NBSP}${excerpt}${NBSP}»`,
    { button: { label: 'Lire et répondre', url: threadUrl } },
    `Le bouton ne s’ouvre pas${NBSP}? Copiez cette adresse dans votre navigateur${NBSP}:`,
    { url: threadUrl },
  ],
  footer: 'Vous recevez ce message car vous avez un message non lu dans votre espace participant.',
});
