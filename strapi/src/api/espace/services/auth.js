'use strict';

const { EspaceError } = require('../lib/errors');
const { normalizeEmail } = require('../lib/import');
const { createRateLimiter } = require('../lib/rate-limit');
const { COOKIE_NAME, sessionCookieOptions } = require('../lib/session');
const { generateToken, hashToken, linkUrl } = require('../lib/tokens');

const TOKEN = 'api::espace.magic-token';
const ATTENDEE = 'api::espace.attendee';
const LINK_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * DAY_MS;

// Identity given to an organizer created from ORGANIZER_EMAILS (I-23): the required fields of Attendee, so that E2 passes as it is.
const ORGANIZER_PROFILE = { firstName: 'Organisateur', lastName: 'JIB', company: 'Xylofutur' };

module.exports = ({ strapi }) => {
  // One limiter per Strapi instance (NF-03): a Strapi restarted by the tests starts from zero.
  const limiter = createRateLimiter();
  const documents = (uid) => strapi.documents(uid);
  const settings = () => strapi.config.get('server.espace');

  const isListed = (email) => settings().organizerEmails.some((listed) => listed.trim().toLowerCase() === email.toLowerCase());
  const isOrganizer = (attendee) => attendee.role === 'organizer' || isListed(attendee.email);

  const cookieOptions = () => sessionCookieOptions({ publicUrl: settings().publicUrl, maxAgeMs: SESSION_MS });
  const setCookie = (ctx, token) => ctx.cookies.set(COOKIE_NAME, token, cookieOptions());
  const clearCookie = (ctx) => ctx.cookies.set(COOKIE_NAME, null, cookieOptions());
  // A-25: Koa refuses a Secure cookie on a request it sees in http, such as the internal call of the server-side rendering.
  const canSetCookie = (ctx) => ctx.request.secure || !cookieOptions().secure;

  /** Published edition of an edition document (the draft row may differ, NF-52), or null. */
  const publishedEdition = (documentId) => (documentId ? documents('api::edition.edition').findOne({ documentId, status: 'published' }) : null);

  const findAttendee = (editionDocumentId, email) =>
    documents(ATTENDEE).findFirst({ filters: { edition: { documentId: editionDocumentId }, email: { $eqi: email } } });

  /** A-16: the check and the creation run under the lock, so that two requests create one organizer. */
  const createOrganizer = (editionDocumentId, email) =>
    strapi.service('api::espace.locks').withLock(
      `attendee:${editionDocumentId}`,
      async () =>
        (await findAttendee(editionDocumentId, email)) ??
        documents(ATTENDEE).create({ data: { ...ORGANIZER_PROFILE, email, role: 'organizer', edition: { documentId: editionDocumentId } } })
    );

  /** Link token found by its hash, with its attendee and the published edition: { link, edition }, empty when unknown. */
  async function loadLink(token) {
    if (typeof token !== 'string' || !token || token.length > 200) return {};
    const link = await documents(TOKEN).findFirst({
      filters: { tokenHash: hashToken(token), kind: 'link' },
      populate: { attendee: { populate: { edition: { fields: ['documentId', 'slug'] } } } },
    });
    return { link, edition: await publishedEdition(link?.attendee?.edition?.documentId) };
  }

  const isUsable = ({ link, edition }, now) =>
    !link.usedAt && new Date(link.expiresAt) > now && link.attendee.status === 'active' && Boolean(edition?.participantSpaceEnabled);

  /** Sends the access link when the address belongs to an active attendee (or is an organizer's) of an open edition. */
  async function deliverLink({ editionSlug, email, ip, now }) {
    const edition = await strapi.service('api::espace.editions').findPublished(editionSlug);
    if (!edition?.participantSpaceEnabled) return;

    let attendee = await findAttendee(edition.documentId, email);
    if (!attendee && isListed(email)) attendee = await createOrganizer(edition.documentId, email);
    if (attendee?.status !== 'active') return;

    const { publicUrl } = settings();
    const token = await strapi.service('api::espace.tokens').issueLink(attendee.documentId, { ttlMinutes: LINK_MINUTES, ip, now });
    await strapi.service('api::espace.mailer').send({
      attendee,
      template: 'access-link',
      data: {
        edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
        publicUrl,
        firstName: attendee.firstName,
        url: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/` }),
        validityMinutes: LINK_MINUTES,
      },
      now,
    });
  }

  return {
    setCookie,

    /**
     * F-01, F-02, NF-03. Throws 400 EMAIL_INVALID or 429 RATE_LIMITED, otherwise returns at once: the lookup and the
     * sending are detached (A-19), so the response time does not tell a known address from an unknown one.
     * The counters of the address and of the IP are incremented before any lookup.
     */
    requestLink({ editionSlug, email, ip, now = new Date() }) {
      if (typeof editionSlug !== 'string') throw new EspaceError(400, 'VALIDATION', 'Édition non valable.');
      const address = normalizeEmail(email);
      if (!address) throw new EspaceError(400, 'EMAIL_INVALID', 'Saisissez une adresse e-mail valide.');
      if (![`email:${address}`, `ip:${ip}`].map((key) => limiter.hit(key)).every(Boolean)) {
        throw new EspaceError(429, 'RATE_LIMITED', 'Trop de demandes, réessayez dans quelques minutes.');
      }
      deliverLink({ editionSlug, email: address, ip, now }).catch((error) =>
        strapi.log.error(`[auth] access link not sent: ${error.message.split('\n')[0]}`)
      );
    },

    /** A-18: state of a link without consuming it. The address is returned only for an expired or used link of an active attendee of an open edition. */
    async linkState(token, { now = new Date() } = {}) {
      const loaded = await loadLink(token);
      if (!loaded.link) return { valid: false };
      const { attendee } = loaded.link;
      const editionSlug = attendee.edition?.slug;
      if (isUsable(loaded, now)) return { valid: true, editionSlug };
      return attendee.status === 'active' && loaded.edition?.participantSpaceEnabled ? { valid: false, editionSlug, email: attendee.email } : { valid: false, editionSlug };
    },

    /**
     * I-20, I-22: consumes the link and opens a session -> { attendee, edition, isOrganizer, sessionToken } ; 400 TOKEN_INVALID otherwise.
     * The consumption is one UPDATE conditioned by usedAt and expiresAt (the only call outside the Document Service):
     * two simultaneous requests cannot both succeed.
     */
    async verify(token, { ip, now = new Date() } = {}) {
      const invalid = new EspaceError(400, 'TOKEN_INVALID', 'Ce lien n’est plus valable.');
      const loaded = await loadLink(token);
      if (!loaded.link || !isUsable(loaded, now)) throw invalid;

      const { link, edition } = loaded;
      const { count } = await strapi.db.query(TOKEN).updateMany({ where: { id: link.id, usedAt: null, expiresAt: { $gt: now } }, data: { usedAt: now } });
      if (!count) throw invalid;

      const sessionToken = generateToken();
      await documents(TOKEN).create({
        data: {
          attendee: { documentId: link.attendee.documentId },
          kind: 'session',
          tokenHash: hashToken(sessionToken),
          expiresAt: new Date(now.getTime() + SESSION_MS),
          ip,
        },
      });
      const attendee = await documents(ATTENDEE).update({
        documentId: link.attendee.documentId,
        data: { lastSeenAt: now, activatedAt: link.attendee.activatedAt ?? now },
      });
      return { attendee, edition, isOrganizer: isOrganizer(attendee), sessionToken };
    },

    /**
     * Called by the context middleware: the session of the signed cookie -> { attendee, edition, session, isOrganizer }, or null (401).
     * Valid: unexpired session token, active attendee, published edition with the space open (NF-52).
     * The expiry slides by 30 days at most once a day, cookie included, and only on a request that can receive the cookie (A-25).
     */
    async loadSession(ctx, { now = new Date() } = {}) {
      const token = ctx.cookies.get(COOKIE_NAME, { signed: true });
      if (!token) return null;

      const session = await documents(TOKEN).findFirst({
        filters: { tokenHash: hashToken(token), kind: 'session', expiresAt: { $gt: now } },
        populate: { attendee: { populate: { edition: { fields: ['documentId'] } } } },
      });
      const attendee = session?.attendee;
      const edition = attendee?.status === 'active' ? await publishedEdition(attendee.edition?.documentId) : null;
      if (!edition?.participantSpaceEnabled) return null;

      if (new Date(session.expiresAt).getTime() - now.getTime() < SESSION_MS - DAY_MS && canSetCookie(ctx)) {
        await documents(TOKEN).update({ documentId: session.documentId, data: { expiresAt: new Date(now.getTime() + SESSION_MS) } });
        setCookie(ctx, token);
      }
      return { attendee, edition, session, isOrganizer: isOrganizer(attendee) };
    },

    /** Revokes the session of the request, if any, and removes the cookie when the request can receive it (A-25). Never fails for lack of a session. */
    async logout(ctx) {
      const session = ctx.state.espace?.session;
      if (session) await documents(TOKEN).delete({ documentId: session.documentId });
      if (canSetCookie(ctx)) clearCookie(ctx);
    },
  };
};
