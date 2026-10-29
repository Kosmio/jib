'use strict';

// access-link: login link of E0 (I-20). Texts of phase-1-design.md, Q5 ; no "Gérer mes notifications" (manage: false).
// data = { edition: { slug, title, themeColor }, publicUrl, firstName, url, validityMinutes }
module.exports = ({ edition, firstName, url, validityMinutes }) => ({
  subject: 'Votre lien de connexion à l’espace participant',
  preheader: `Valable ${validityMinutes} minutes, à usage unique.`,
  title: 'Votre lien de connexion',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    'Voici votre lien pour ouvrir votre espace participant des Journées de l’Innovation Filière Bois.',
    { button: { label: 'Me connecter', url } },
    `Ce lien est valable ${validityMinutes} minutes et ne fonctionne qu’une seule fois. Ensuite, demandez-en un nouveau depuis la page de connexion.`,
    'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : personne ne peut se connecter sans ce lien.',
    'Le bouton ne s’ouvre pas ? Copiez cette adresse dans votre navigateur :',
    { url },
  ],
  footer: `Vous recevez ce message car un lien de connexion a été demandé avec cette adresse pour l’édition ${edition.title}.`,
  manage: false,
});
