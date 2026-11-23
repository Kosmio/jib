'use strict';

const NBSP = ' ';

/** `welcome` (I-31, A-17): sent once per attendee when the space is open ; the button is a 72 hour action link to the edition home. */
module.exports = ({ firstName, url, validityHours }) => ({
  subject: firstName ? `${firstName}, votre espace participant est prêt` : 'Votre espace participant est prêt',
  preheader: 'Profil, annuaire, rendez-vous B2B et messages, en un seul lien.',
  title: 'Bienvenue dans votre espace',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `Votre inscription aux Journées de l’Innovation Filière Bois est enregistrée. Votre espace participant vous aide à préparer la journée${NBSP}:`,
    {
      ul: [
        `complétez votre profil et choisissez ce que les autres participants voient${NBSP};`,
        `parcourez l’annuaire et proposez des rendez-vous pendant les pauses B2B${NBSP};`,
        'écrivez aux autres participants.',
      ],
    },
    { button: { label: 'Accéder à mon espace', url } },
    `Ce lien personnel est valable ${validityHours} heures et ne fonctionne qu’une seule fois. Pas de mot de passe à retenir${NBSP}: ensuite, demandez un nouveau lien depuis la page de connexion, avec l’adresse de votre inscription.`,
    `Le bouton ne s’ouvre pas${NBSP}? Copiez cette adresse dans votre navigateur${NBSP}:`,
    { url },
  ],
});
