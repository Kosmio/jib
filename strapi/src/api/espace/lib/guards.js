'use strict';

const { EspaceError } = require('./errors');

/** Session loaded by the context middleware: { attendee, edition, session, isOrganizer }. */
function requireSession(ctx) {
  const session = sessionOf(ctx);
  // F-103: on a closed edition the session of an organizer opens the dashboard (/admin/*) and the profile it displays (GET /me), nothing else. R-44, NF-12: erasure and export of one's own data stay open to any valid session.
  if ('participantSpaceEnabled' in session.edition && !session.edition.participantSpaceEnabled && !(/\/admin\//.test(ctx.path) || (ctx.method === 'GET' && ctx.path.endsWith('/me')) || /\/me\/(erase|export)$/.test(ctx.path))) {
    throw new EspaceError(403, 'FORBIDDEN', 'L’espace de cette édition est fermé.');
  }
  return session;
}

function sessionOf(ctx) {
  const session = ctx.state.espace;
  if (!session) throw new EspaceError(401, 'UNAUTHENTICATED', 'Connexion requise.');
  return session;
}

/** Organizer of the edition named in the URL (NF-01): another edition's organizer is refused too. */
function requireOrganizer(ctx, editionSlug) {
  const session = requireSession(ctx);
  if (!session.isOrganizer || session.edition.slug !== editionSlug) {
    throw new EspaceError(403, 'FORBIDDEN', 'Accès réservé aux organisateurs de cette édition.');
  }
  return session;
}

module.exports = { requireSession, requireOrganizer };
