'use strict';

const { EspaceError } = require('../lib/errors');
const { normalizeEmail } = require('../lib/import');
const { createRateLimiter } = require('../lib/rate-limit');
const { COOKIE_NAME, safeNextPath, sessionCookieOptions } = require('../lib/session');
const { CODE_PREFIX, generateToken, hashCode, hashToken, linkUrl, normalizeCode, sameHash, spacedCode } = require('../lib/tokens');

const TOKEN = 'api::espace.magic-token';
const ATTENDEE = 'api::espace.attendee';
const LINK_MINUTES = 30;
const SENT_COOKIE = 'jib_espace_sent';
// I-44: wrong tries before a code is void, and the ceilings of code tries per IP and per address in a 15-minute window (NF-03).
const CODE_MAX_FAILURES = 5;
const CODE_IP_MAX = 30;
const CODE_EMAIL_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * DAY_MS;

// Identity given to an organizer created from ORGANIZER_EMAILS (I-23): its name from its address (lib/people.js).
const { organizerProfile } = require('../lib/people');

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const settings = () => strapi.config.get('server.espace');
  // Secret of the code hashes (I-44): the first application key, which Strapi already requires.
  const codeSecret = () => strapi.config.get('server.app.keys')[0];
  // One pair of limiters per Strapi instance (NF-03): a Strapi restarted by the tests starts from zero. NF-61: the IP ceiling comes from the settings.
  const emailLimiter = createRateLimiter();
  const ipLimiter = createRateLimiter({ max: settings().linkRateIpMax });
  const codeIpLimiter = createRateLimiter({ max: CODE_IP_MAX });
  const codeEmailLimiter = createRateLimiter({ max: CODE_EMAIL_MAX });
  // Wrong tries per code row (I-44), in memory like the limiters: a restart gives a fresh count, never a longer lease than the rows themselves.
  const codeFailures = new Map();

  const isListed = (email) => settings().organizerEmails.some((listed) => listed.trim().toLowerCase() === email.toLowerCase());
  const isOrganizer = (attendee) => attendee.role === 'organizer' || isListed(attendee.email);
  // F-103: a closed edition stays open to its organizers (the dashboard), to nobody else.
  const isOpenFor = (edition, attendee) => Boolean(edition) && (Boolean(edition.participantSpaceEnabled) || isOrganizer(attendee));

  const cookieOptions = () => sessionCookieOptions({ publicUrl: settings().publicUrl, maxAgeMs: SESSION_MS });
  const setCookie = (ctx, token) => ctx.cookies.set(COOKIE_NAME, token, cookieOptions());
  const clearCookie = (ctx) => ctx.cookies.set(COOKIE_NAME, null, cookieOptions());
  // The address of a request, kept 5 minutes for the "link sent" page, out of the URL (history, proxy logs, Referer). A-25 applies.
  const rememberEmail = (ctx, email) => {
    if (!canSetCookie(ctx)) return;
    ctx.cookies.set(SENT_COOKIE, encodeURIComponent(email), { httpOnly: true, sameSite: 'lax', path: '/espace', secure: cookieOptions().secure, overwrite: true, maxAge: 5 * 60 * 1000 });
  };
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
        documents(ATTENDEE).create({ data: { ...organizerProfile(email), email, role: 'organizer', meetingsOptIn: false, edition: { documentId: editionDocumentId } } })
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
    !link.usedAt && new Date(link.expiresAt) > now && link.attendee.status === 'active' && isOpenFor(edition, link.attendee);

  /** Sends the access link when the address belongs to an active attendee (or is an organizer's) of an open edition. */
  async function deliverLink({ editionSlug, email, next, ip, now }) {
    const edition = await strapi.service('api::espace.editions').findPublished(editionSlug);
    if (!edition) return;

    let attendee = await findAttendee(edition.documentId, email);
    if (!attendee && isListed(email)) attendee = await createOrganizer(edition.documentId, email);
    if (attendee?.status !== 'active' || !isOpenFor(edition, attendee)) return;

    const { publicUrl } = settings();
    const { token, code } = await strapi
      .service('api::espace.tokens')
      .issueLoginLink(attendee.documentId, { ttlMinutes: LINK_MINUTES, ip, now, secret: codeSecret() });
    await strapi.service('api::espace.mailer').send({
      attendee,
      template: 'access-link',
      data: {
        edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
        publicUrl,
        firstName: attendee.firstName,
        url: linkUrl({ publicUrl, token, next: safeNextPath(next, edition.slug) }),
        validityMinutes: LINK_MINUTES,
        code: spacedCode(code),
      },
      now,
    });
  }

  /** I-22: session token of an attendee who proved their address (by the link or by the code) -> { attendee, edition, isOrganizer, sessionToken }. */
  async function openSession({ attendee: who, edition, ip, now }) {
    const sessionToken = generateToken();
    await documents(TOKEN).create({
      data: {
        attendee: { documentId: who.documentId },
        kind: 'session',
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(now.getTime() + SESSION_MS),
        ip,
      },
    });
    const attendee = await documents(ATTENDEE).update({ documentId: who.documentId, data: { lastSeenAt: now, activatedAt: who.activatedAt ?? now } });
    return { attendee, edition, isOrganizer: isOrganizer(attendee), sessionToken };
  }

  return {
    setCookie,
    rememberEmail,

    /**
     * F-01, F-02, NF-03. `next` (F-102) is kept when it stays inside the edition. Throws 400 EMAIL_INVALID or 429 RATE_LIMITED, otherwise returns at once: the lookup and the
     * sending are detached (A-19), so the response time does not tell a known address from an unknown one.
     * The counters of the address and of the IP are incremented before any lookup.
     */
    requestLink({ editionSlug, email, next, ip, now = new Date() }) {
      if (typeof editionSlug !== 'string') throw new EspaceError(400, 'VALIDATION', 'Édition non valable.');
      const address = normalizeEmail(email);
      if (!address) throw new EspaceError(400, 'EMAIL_INVALID', 'Saisissez une adresse e-mail valide.');
      if (![emailLimiter.hit(address), ipLimiter.hit(ip)].every(Boolean)) {
        throw new EspaceError(429, 'RATE_LIMITED', 'Trop de demandes, réessayez dans quelques minutes.');
      }
      deliverLink({ editionSlug, email: address, next, ip, now }).catch((error) =>
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
      return attendee.status === 'active' && isOpenFor(loaded.edition, attendee) ? { valid: false, editionSlug, email: attendee.email } : { valid: false, editionSlug };
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
      // I-44: the code of this request dies with its link.
      await strapi.db.query(TOKEN).updateMany({ where: { tokenHash: { $startsWith: `${CODE_PREFIX}${link.documentId}:` }, usedAt: null }, data: { usedAt: now } });
      return openSession({ attendee: link.attendee, edition, ip, now });
    },

    /**
     * I-44, F-142: opens a session with the six-digit code of an e-mail -> same result as verify ; 400 CODE_INVALID otherwise, 429 RATE_LIMITED past the ceilings.
     * The answer is the same for an unknown address, an unregistered one, a wrong code and a void one (F-02). The counters are incremented before any lookup.
     * The link row is the single gate, as in verify: the code and the link of a request cannot both open a session. Five wrong tries void the codes of the address.
     */
    async verifyCode({ editionSlug, email, code, ip, now = new Date() }) {
      const invalid = new EspaceError(400, 'CODE_INVALID', 'Ce code n’est pas valable. Vérifiez-le ou demandez un nouveau lien.');
      const address = normalizeEmail(email);
      if (![codeIpLimiter.hit(ip), codeEmailLimiter.hit(address || '')].every(Boolean)) {
        throw new EspaceError(429, 'RATE_LIMITED', 'Trop d’essais, réessayez dans quelques minutes.');
      }
      const digits = normalizeCode(code);
      const edition = address && typeof editionSlug === 'string' ? await strapi.service('api::espace.editions').findPublished(editionSlug) : null;
      const attendee = edition ? await findAttendee(edition.documentId, address) : null;
      if (!digits || !attendee || attendee.status !== 'active' || !isOpenFor(edition, attendee)) throw invalid;

      const rows = await documents(TOKEN).findMany({
        filters: { attendee: { documentId: attendee.documentId }, kind: 'link', usedAt: { $null: true }, expiresAt: { $gt: now }, tokenHash: { $startsWith: CODE_PREFIX } },
      });
      const secret = codeSecret();
      const match = rows.find((row) => sameHash(row.tokenHash, hashCode(digits, { linkDocumentId: row.tokenHash.split(':')[1], secret })));
      if (!match) {
        for (const row of rows) {
          const failures = (codeFailures.get(row.documentId) ?? 0) + 1;
          codeFailures.set(row.documentId, failures);
          if (failures >= CODE_MAX_FAILURES) {
            await strapi.db.query(TOKEN).updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
            codeFailures.delete(row.documentId);
          }
        }
        throw invalid;
      }

      const { count } = await strapi.db
        .query(TOKEN)
        .updateMany({ where: { documentId: match.tokenHash.split(':')[1], kind: 'link', usedAt: null, expiresAt: { $gt: now } }, data: { usedAt: now } });
      if (!count) throw invalid;
      await strapi.db.query(TOKEN).updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: now } });
      codeFailures.delete(match.documentId);
      return openSession({ attendee, edition, ip, now });
    },

    /**
     * Called by the context middleware: the session of the signed cookie -> { attendee, edition, session, isOrganizer }, or null (401).
     * Valid: unexpired session token, active attendee, published edition with the space open (NF-52).
     * The expiry slides by 30 days at most once a day, cookie included, and only on a request that can receive the cookie (A-25).
     */
    async loadSession(ctx, { now = new Date(), allowClosed = false } = {}) {
      const token = ctx.cookies.get(COOKIE_NAME, { signed: true });
      if (!token) return null;

      const session = await documents(TOKEN).findFirst({
        filters: { tokenHash: hashToken(token), kind: 'session', expiresAt: { $gt: now } },
        populate: { attendee: { populate: { edition: { fields: ['documentId'] } } } },
      });
      const attendee = session?.attendee;
      const edition = attendee?.status === 'active' ? await publishedEdition(attendee.edition?.documentId) : null;
      // R-44, NF-12: `allowClosed` (erasure and export routes only) keeps the session of a participant of a closed edition.
      if (!(allowClosed && edition) && !isOpenFor(edition, attendee)) return null;

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
