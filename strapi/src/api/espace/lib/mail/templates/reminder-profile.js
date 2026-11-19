'use strict';

const NBSP = '\u00a0';

const sentence = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts[0]);

/** "Plus que 16 jours" */
const countdown = (daysLeft) => (daysLeft > 1 ? `Plus que ${daysLeft} jours` : daysLeft === 1 ? 'Plus qu’un jour' : 'Les Journées approchent');

/**
 * `reminder-profile` (R-70 a, 08-relance): the profile is under 70 %. The button is a 72 hour action link to the profile.
 * data = { firstName, completion, missing: ['votre photo', …], suggestions: [{ displayName, subtitle, initials }], daysLeft, city, pauses: ['10h45', …], profileUrl }
 */
module.exports = ({ firstName, completion, missing = [], suggestions = [], daysLeft, city, pauses = [], profileUrl }) => ({
  subject: suggestions.length
    ? `${firstName ? `${firstName}, ` : ''}${suggestions.length} ${suggestions.length > 1 ? 'rencontres vous attendent' : 'rencontre vous attend'}${city ? ` à ${city}` : ''}`
    : `${firstName ? `${firstName}, ` : ''}complétez votre profil avant les Journées`,
  preheader: `Votre profil est complet à ${completion}${NBSP}%.`,
  title: countdown(daysLeft),
  blocks: [
    firstName ? `Bonjour ${firstName},` : 'Bonjour,',
    `Votre profil est complet à ${completion}${NBSP}%.${missing.length ? ` Il manque ${sentence(missing)}${NBSP}: avec ${missing.length > 1 ? 'eux' : 'lui'}, les autres participants vous trouvent plus facilement dans l’annuaire.` : ''}`,
    ...(suggestions.length ? [{ people: { title: 'Ils partagent vos sujets', items: suggestions.map(({ displayName, subtitle, initials }) => ({ name: displayName, subtitle, initials })) } }] : []),
    { button: { label: 'Compléter mon profil et prendre rendez-vous', url: profileUrl } },
    ...(pauses.length ? [{ small: `Les créneaux de rendez-vous se tiennent pendant les pauses B2B de ${sentence(pauses)}.` }] : []),
  ],
});
