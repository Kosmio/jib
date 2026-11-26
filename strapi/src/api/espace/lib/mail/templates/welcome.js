'use strict';

const NBSP = ' ';

/** `welcome` (I-31, A-17): sent once per attendee when the space is open ; the button is a 72 hour action link to the edition home. */
// Text written by the organizers (Apolline Oswald, Xylofutur, 26/11/2026). The region comes from the edition title.
module.exports = ({ firstName, url, validityHours, edition }) => ({
  subject: firstName ? `${firstName}, votre espace participant est prêt` : 'Votre espace participant est prêt',
  preheader: 'Profil, annuaire, rendez-vous B2B et messages, en un seul lien.',
  title: 'Bienvenue dans votre espace',
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `Votre inscription à la Journée de l’Innovation de la Filière Bois${edition?.title ? ` en ${edition.title}` : ''} a bien été enregistrée. Vous trouverez ci-dessous les informations pour accéder à votre espace participant. Il vous aidera à bien préparer la journée${NBSP}:`,
    {
      ul: [
        `Complétez votre profil et choisissez ce que les autres participants voient${NBSP};`,
        `Parcourez l’annuaire et proposez des rendez-vous pendant les pauses B2B${NBSP};`,
        `Écrivez aux autres participants${NBSP};`,
        'Accédez en un clin d’œil à votre programme personnalisé.',
      ],
    },
    { button: { label: 'Accéder à mon espace', url } },
    `Ce lien personnel est valable ${validityHours} heures et ne fonctionne qu’une seule fois. Pas de mot de passe à retenir${NBSP}: ensuite, demandez un nouveau lien depuis la page de connexion, avec l’adresse de votre inscription.`,
    `Le bouton ne s’ouvre pas${NBSP}? Copiez cette adresse dans votre navigateur${NBSP}:`,
    { url },
  ],
});
