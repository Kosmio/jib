'use strict';

const { EspaceError } = require('./errors');

/** Session loaded by the context middleware: { attendee, edition, session, isOrganizer }. */
function requireSession(ctx) {
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
