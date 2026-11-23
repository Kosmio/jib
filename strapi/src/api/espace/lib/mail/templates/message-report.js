'use strict';

const NBSP = ' ';

/**
 * `message-report` (F-75, R-63): sent to the organizers when a participant reports a message.
 * Carries no content of the message nor of the report ; `pilotageUrl` is a 72 hour action link to the dashboard.
 */
module.exports = ({ firstName, pilotageUrl }) => ({
  subject: 'Un message a été signalé',
  preheader: 'Un signalement attend votre décision dans le pilotage.',
  title: 'Message signalé',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    'Un participant a signalé un message. Le motif et le message signalé se lisent dans le pilotage.',
    { button: { label: 'Ouvrir le pilotage', url: pilotageUrl } },
    `Le bouton ne s’ouvre pas${NBSP}? Copiez cette adresse dans votre navigateur${NBSP}:`,
    { url: pilotageUrl },
  ],
  footer: 'Vous recevez ce message car vous organisez cette édition.',
  manage: false,
});
