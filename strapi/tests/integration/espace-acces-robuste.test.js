'use strict';

/**
 * Accès robustes, lot V1-B (14-lots-finalisation.md) : NF-61, F-100 à F-103 (côté API). Tests d'abord : chaque groupe porte
 * `pending('V1-B')` jusqu'à la livraison du lot.
 *
 *   - NF-61 : 5 demandes / 15 min par adresse, `LINK_RATE_IP_MAX` (défaut 60) par IP, lu dans la configuration (critère 1) ;
 *   - F-102 : `next` accepté par la demande de lien (JSON et formulaire), validé (chemin interne à l'édition, sinon ignoré),
 *     porté par le lien de l'e-mail (critère 4) ;
 *   - F-103 : espace fermé (participantSpaceEnabled false) : l'organisateur reçoit un lien, ouvre une session et atteint les
 *     routes `/admin/{édition}/*` ; le participant garde la réponse actuelle (critère 5) ;
 *   - critère 6 : aucun 500 sur un appel interne en http avec PUBLIC_URL en https (garde A-25).
 *
 * Les redirections 303 de `/connexion` et `/verifier` (F-100, F-101) et F-104 sont des pages Astro : espace-acces-robuste.spec.ts.
 * Aucun réseau hors localhost ; adresses en @example.org.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { SESSION_COOKIE, cookieHeader, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, findAttendee } = require('../helpers/espace-data');

const ORGANIZERS = ['robuste.orga.un@example.org', 'robuste.orga.deux@example.org', 'robuste.orga.trois@example.org'];
const [ORGANIZER, ORGANIZER_2, ORGANIZER_3] = ORGANIZERS;
const MARKER = 'V1-B';

/** Demande de lien JSON (Origin admis par défaut), `next` facultatif. */
const askLink = (espace, editionSlug, email, { next, ip } = {}) =>
  espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug, email, ...(next !== undefined ? { next } : {}) }, ip });

describe('NF-61 : limitation de débit de la demande de lien, par adresse et par IP (V1-B)', { timeout: 300_000 }, () => {
  const espace = useEspace();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-debit', title: 'Édition débit' }));

  it('60 demandes pour 60 adresses depuis une même IP sont admises, la 61e reçoit 429 RATE_LIMITED (critère 1)', pending(MARKER), async () => {
    const { slug } = await world();
    const statuses = [];
    let last;
    for (let i = 1; i <= 61; i += 1) {
      last = await askLink(espace, slug, `debit.ip.${i}@example.org`, { ip: '198.51.100.61' });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses.slice(0, 60), Array(60).fill(202));
    assert.equal(statuses[60], 429);
    assert.equal(last.json.error.code, 'RATE_LIMITED');
  });

  it('une autre IP repart à zéro quand la première est épuisée', pending(MARKER), async () => {
    const { slug } = await world();
    assert.equal((await askLink(espace, slug, 'debit.ip.autre@example.org', { ip: '198.51.100.62' })).status, 202);
  });

  it('six demandes pour une même adresse depuis six IP différentes : la 6e est refusée (limite par adresse inchangée)', pending(MARKER), async () => {
    const { slug } = await world();
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await askLink(espace, slug, 'debit.adresse@example.org', { ip: `198.51.100.${100 + i}` })).status);
    assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  });
});

describe('NF-61 : la limite par IP est lue dans la configuration, LINK_RATE_IP_MAX=3 (V1-B)', { timeout: 180_000 }, () => {
  const espace = useEspace({ overrides: { LINK_RATE_IP_MAX: '3' } });

  it('la 4e demande depuis une même IP reçoit 429, la 3e est admise', pending(MARKER), async () => {
    const { slug } = await createEdition(espace().app, { slug: 'edition-debit-config', title: 'Édition débit configuré' });
    const statuses = [];
    for (let i = 1; i <= 4; i += 1) statuses.push((await askLink(espace, slug, `config.ip.${i}@example.org`, { ip: '198.51.100.70' })).status);
    assert.deepEqual(statuses, [202, 202, 202, 429]);
  });
});

describe('F-102 : `next` survit à une nouvelle demande de lien (V1-B)', { timeout: 300_000 }, () => {
  const espace = useEspace();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-next', title: 'Édition next' }));

  /** Demande avec `next`, puis le lien de l'e-mail reçu ; `form` envoie le formulaire sans JavaScript. */
  async function linkAfterRequest({ next, form = false }) {
    const { app, outbox, request, waitForMail, linkOf } = espace();
    const ed = await world();
    const attendee = await createAttendee(app, ed, { consentAt: new Date().toISOString() });
    const since = outbox().length;
    const response = form
      ? await request('/api/espace/auth/request-link', { method: 'POST', form: { editionSlug: ed.slug, email: attendee.email, ...(next !== undefined ? { next } : {}) } })
      : await askLink(espace, ed.slug, attendee.email, { next });
    const link = linkOf(await waitForMail((mail) => mail.to.email === attendee.email, { since }));
    return { response, link, attendee, ed };
  }

  it('JSON : le lien envoyé porte le `next` interne à l’édition', pending(MARKER), async () => {
    const ed = await world();
    const next = `/espace/${ed.slug}/agenda`;
    const { response, link } = await linkAfterRequest({ next });
    assert.equal(response.status, 202);
    assert.equal(link.next, next);
  });

  it('formulaire sans JavaScript : le champ `next` est lu, 303 vers ?envoye=1, et le lien porte le `next` (critère 4)', pending(MARKER), async () => {
    const ed = await world();
    const next = `/espace/${ed.slug}/agenda`;
    const { response, link } = await linkAfterRequest({ next, form: true });
    assert.equal(response.status, 303);
    assert.ok(new URL(response.location).searchParams.get('envoye') === '1', response.location);
    assert.equal(link.next, next);
  });

  // Un lien sans `next` utile peut ne rien porter ou porter l'accueil de l'édition : les deux ouvrent l'accueil.
  const isHomeOrNone = (value, ed) => value === null || value === `/espace/${ed.slug}/`;

  it('sans `next` : le lien n’en porte pas, ou porte l’accueil de l’édition', pending(MARKER), async () => {
    const { link, ed } = await linkAfterRequest({});
    assert.ok(isHomeOrNone(link.next, ed), link.url);
  });

  it('un `next` hors de l’édition est ignoré sans erreur : réponse 202 et lien sans ce `next`', pending(MARKER), async () => {
    const ed = await world();
    for (const next of ['https://exemple.org', '//exemple.org', '/\\exemple.org', '/espace/autre-edition/agenda', `/espace/${ed.slug}/../../admin`, '/admin', 42, '']) {
      const { response, link } = await linkAfterRequest({ next });
      assert.equal(response.status, 202, String(next));
      assert.ok(isHomeOrNone(link.next, ed), `next ${JSON.stringify(next)} recopié : ${link.url}`);
    }
  });

  it('bout en bout : le lien porte `next`, le vérifier redirige vers ce chemin', pending(MARKER), async () => {
    const { request } = espace();
    const ed = await world();
    const next = `/espace/${ed.slug}/agenda`;
    const { link } = await linkAfterRequest({ next });
    const verified = await request('/api/espace/auth/verify', { method: 'POST', json: { token: link.token, next: link.next } });
    assert.equal(verified.status, 200);
    assert.equal(new URL(verified.json.redirect, espace().publicUrl).pathname, next);
  });
});

describe('F-103 : un organisateur accède au pilotage quand l’espace est fermé (V1-B)', { timeout: 300_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: ORGANIZERS.join(',') } });
  let closedEdition;
  const world = async () => (closedEdition ??= await createEdition(espace().app, { slug: 'edition-fermee-orga', title: 'Édition fermée orga', enabled: false }));
  const adminUrl = (slug) => `/api/espace/admin/${slug}/sync-runs`;

  it('une adresse de ORGANIZER_EMAILS reçoit un lien, se connecte et devient Attendee organizer (critère 5)', pending(MARKER), async () => {
    const { slug, documentId } = await world();
    const { app, signIn } = espace();
    assert.equal(await findAttendee(app, { documentId }, ORGANIZER), null);
    const { me } = await signIn(slug, ORGANIZER);
    assert.equal(me.isOrganizer, true);
    assert.equal((await findAttendee(app, { documentId }, ORGANIZER)).role, 'organizer');
  });

  it('la session ouverte donne accès aux routes /admin/{édition}/* de l’édition fermée', pending(MARKER), async () => {
    const { slug } = await world();
    const { request, signIn } = espace();
    const { cookie } = await signIn(slug, ORGANIZER_2);
    assert.equal((await request(adminUrl(slug), { cookie })).status, 200);
  });

  it('un Attendee de rôle organizer hors ORGANIZER_EMAILS obtient aussi un lien et l’accès', pending(MARKER), async () => {
    const { slug } = await world();
    const { app, request, signIn } = espace();
    const boss = await createAttendee(app, await world(), { role: 'organizer', email: 'robuste.responsable@example.org' });
    const { cookie } = await signIn(slug, boss.email);
    assert.equal((await request(adminUrl(slug), { cookie })).status, 200);
  });

  it('un participant de l’édition fermée reçoit la réponse actuelle : 202, aucun e-mail, aucun lien', pending(MARKER), async () => {
    const ed = await world();
    const { app, outbox, mailsSince, query } = espace();
    const attendee = await createAttendee(app, ed);
    const since = outbox().length;
    const response = await askLink(espace, ed.slug, attendee.email);
    assert.equal(response.status, 202);
    assert.deepEqual(response.json, { status: 'accepted' });
    assert.deepEqual(await mailsSince(since, { to: attendee.email }), []);
    assert.equal((await query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId } } })).length, 0);
  });

  it('un participant ne passe pas : 401 sur /me et sur les routes admin même avec une session ouverte avant la fermeture', pending(MARKER), async () => {
    const { app, request, signIn } = espace();
    const edition = await createEdition(app, { slug: 'edition-fermee-apres', title: 'Édition fermée après' });
    const attendee = await createAttendee(app, edition, { consentAt: new Date().toISOString() });
    const { cookie } = await signIn(edition.slug, attendee.email);
    await app.documents(UID.edition).update({ documentId: edition.documentId, data: { participantSpaceEnabled: false } });
    await app.documents(UID.edition).publish({ documentId: edition.documentId });
    assert.equal((await request('/api/espace/me', { cookie })).status, 401);
    assert.equal((await request(adminUrl(edition.slug), { cookie })).status, 401);
  });

  it('l’organisateur ne voit pas les autres écrans de l’espace fermé : l’annuaire reste refusé', pending(MARKER), async () => {
    const { slug } = await world();
    const { request, signIn } = espace();
    const { cookie } = await signIn(slug, ORGANIZER_3);
    const response = await request(`/api/espace/directory?edition=${slug}`, { cookie });
    assert.ok([401, 403].includes(response.status), `annuaire : ${response.status}`);
  });

  it('une session d’organisateur reste cloisonnée : aucun accès aux routes admin d’une autre édition', pending(MARKER), async () => {
    const { slug } = await world();
    const { app, request, signIn } = espace();
    const other = await createEdition(app, { slug: 'edition-ouverte-orga', title: 'Édition ouverte orga' });
    const { cookie } = await signIn(slug, ORGANIZER);
    const response = await request(adminUrl(other.slug), { cookie });
    assert.equal(response.status, 403);
  });

  it('édition ouverte : le comportement des participants et des organisateurs ne change pas', pending(MARKER), async () => {
    const { app, request, signIn } = espace();
    const open = await createEdition(app, { slug: 'edition-ouverte-stable', title: 'Édition ouverte stable' });
    const attendee = await createAttendee(app, open, { consentAt: new Date().toISOString() });
    const participant = await signIn(open.slug, attendee.email);
    assert.equal((await request('/api/espace/me', { cookie: participant.cookie })).status, 200);
    assert.equal((await request(adminUrl(open.slug), { cookie: participant.cookie })).status, 403);
    const organizer = await signIn(open.slug, ORGANIZER);
    assert.equal((await request(adminUrl(open.slug), { cookie: organizer.cookie })).status, 200);
  });
});

describe('critère 6 : cookie Secure, aucun 500 sur un appel interne en http (garde A-25 conservée) (V1-B)', { timeout: 180_000 }, () => {
  const HTTPS = 'https://journees.example.org';
  const PROTO = { 'x-forwarded-proto': 'https' };
  const DAY = 24 * 3600 * 1000;
  const secure = useEspace({ overrides: { PUBLIC_URL: HTTPS, CORS_ORIGINS: HTTPS, ORGANIZER_EMAILS: ORGANIZER } });

  it('organisateur d’une édition fermée : demande avec `next`, connexion et route admin en http interne répondent sans 500, sans Set-Cookie', pending(MARKER), async () => {
    const { app, request, outbox, waitForMail, linkOf, query } = secure();
    const edition = await createEdition(app, { slug: 'edition-https-fermee', title: 'Édition https fermée', enabled: false });
    const next = `/espace/${edition.slug}/organisateur`;
    const since = outbox().length;

    // Appel interne du rendu serveur : pas d'en-tête X-Forwarded-Proto.
    const internal = await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: edition.slug, email: ORGANIZER, next } });
    assert.equal(internal.status, 202, internal.text);
    const link = linkOf(await waitForMail((mail) => mail.to.email === ORGANIZER, { since }));
    assert.equal(link.next, next);
    assert.ok(link.url.startsWith(`${HTTPS}/espace/verifier?token=`), link.url);

    // Le navigateur passe par Traefik, donc en https ; la session est ensuite à prolonger.
    const verified = await request('/api/espace/auth/verify', { method: 'POST', json: { token: link.token, next }, headers: PROTO });
    assert.equal(verified.status, 200, verified.text);
    const cookie = cookieHeader(verified.setCookies);
    assert.ok(cookie.includes(SESSION_COOKIE));
    const attendee = await findAttendee(app, edition, ORGANIZER);
    for (const row of await query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId }, kind: 'session' } })) {
      await query(UID.magicToken).update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 20 * DAY) } });
    }

    const response = await request(`/api/espace/admin/${edition.slug}/sync-runs`, { cookie });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)), [], 'cookie posé sur une requête http');
  });
});
