'use strict';

/**
 * Connexion par code à six chiffres, lot V3-G (14-lots-finalisation.md) : I-44, F-142 (côté API et e-mail).
 *
 *   - critère 1 : un client sans aucun cookie du demandeur saisit le code de l'e-mail et obtient la session ;
 *   - critère 2 : cinq essais faux invalident le code, le sixième est refusé même avec le bon code ;
 *   - critère 3 : même réponse (statut, corps, 303, cookies) pour une adresse inconnue, non inscrite ou un code faux, et temps proche ;
 *   - critère 4 : les limites de la demande de lien (V1-B) ne bougent pas, celles du code (30 par IP, 10 par adresse) sont à part ;
 *   - expiration à 30 minutes (horloge passée au service), usage unique, lien et code s'invalident l'un l'autre, autre édition refusée,
 *     formulaire sans JavaScript (303), code absent des journaux et des adresses.
 *
 * Le parcours navigateur (champ, libellés, deux contextes) est dans web/tests/e2e/espace-acces-code.spec.ts.
 * Aucun réseau hors localhost ; adresses en @example.org.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { SESSION_COOKIE, cookieHeader, freshIp, parseSetCookie, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition } = require('../helpers/espace-data');

const SENT_COOKIE = 'jib_espace_sent';
const INVALID_MESSAGE = 'Ce code n’est pas valable. Vérifiez-le ou demandez un nouveau lien.';
const consenting = () => ({ consentAt: new Date().toISOString() });

/** Un code différent du vrai, toujours de six chiffres. */
const wrongOf = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** Le code d'un e-mail : « 1 2 3 4 5 6 » dans le texte, rendu en six chiffres. */
const codeOf = (mail) => {
  const match = mail.text.match(/(?<!\d)(\d) (\d) (\d) (\d) (\d) (\d)(?!\d)/);
  return match ? match.slice(1, 7).join('') : undefined;
};

function useWorld(overrides) {
  const espace = useEspace(overrides ? { overrides } : undefined);

  /** Demande de lien JSON puis lecture de l'e-mail : { code, link, mail }. */
  async function issue(edition, attendee, { ip } = {}) {
    const { outbox, request, waitForMail, linkOf } = espace();
    const since = outbox().length;
    const asked = await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: edition.slug, email: attendee.email }, ip });
    assert.equal(asked.status, 202, asked.text);
    const mail = await waitForMail((candidate) => candidate.to.email === attendee.email, { since });
    return { code: codeOf(mail), link: linkOf(mail), mail };
  }

  /** POST /verify-code, JSON par défaut, formulaire avec `form: true`. */
  const verifyCode = (edition, email, code, { ip, cookie, form = false, next, omitEmail = false } = {}) => {
    const body = { editionSlug: edition.slug, ...(omitEmail ? {} : { email }), code, ...(next ? { next } : {}) };
    return espace().request('/api/espace/auth/verify-code', { method: 'POST', ...(form ? { form: body } : { json: body }), ip, cookie });
  };

  return { espace, issue, verifyCode };
}

describe('I-44 : l’e-mail et le stockage du code (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-mail', title: 'Édition code mail' }));

  it('l’e-mail porte « Votre code de connexion » et un code à six chiffres espacés, avec le lien toujours présent', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code, link, mail } = await issue(ed, attendee);
    assert.match(code, /^[0-9]{6}$/);
    assert.ok(mail.text.includes('Votre code de connexion'), mail.text);
    assert.ok(mail.text.includes(code.split('').join(' ')));
    assert.ok(mail.html.includes('Votre code de connexion'));
    assert.ok(mail.html.includes(code.split('').join(' ')), 'code espacé dans le HTML');
    assert.ok(link?.token, 'le lien reste dans l’e-mail');
  });

  it('deux demandes donnent deux codes valables 30 minutes ; en base, aucun code en clair, forme c1:<id du lien>:<HMAC>', async () => {
    const ed = await world();
    const { app, query } = espace();
    const attendee = await createAttendee(app, ed, consenting());
    const t0 = Date.now();
    const { code } = await issue(ed, attendee);
    const rows = await query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId } } });
    assert.equal(rows.length, 2, 'le lien et son code');
    const codeRow = rows.find((row) => row.tokenHash.startsWith('c1:'));
    const linkRow = rows.find((row) => !row.tokenHash.startsWith('c1:'));
    assert.ok(codeRow && linkRow);
    assert.match(codeRow.tokenHash, /^c1:[^:]+:[0-9a-f]{64}$/);
    assert.equal(codeRow.tokenHash.split(':')[1], linkRow.documentId, 'le code nomme son lien');
    assert.equal(codeRow.kind, 'link');
    for (const row of rows) {
      assert.ok(!JSON.stringify(row).includes(code), 'code en clair en base');
      const ttl = new Date(row.expiresAt).getTime() - t0;
      assert.ok(ttl > 29 * 60_000 && ttl < 31 * 60_000 + 5000, `échéance à ${ttl} ms`);
    }
  });

  it('deux demandes de la même adresse ont des empreintes différentes (sel = lien)', async () => {
    const ed = await world();
    const { app, query } = espace();
    const attendee = await createAttendee(app, ed, consenting());
    await issue(ed, attendee);
    await issue(ed, attendee);
    const hashes = (await query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId } } })).filter((row) => row.tokenHash.startsWith('c1:')).map((row) => row.tokenHash);
    assert.equal(new Set(hashes).size, 2);
  });
});

describe('critère 1, I-44 : le code ouvre la session sans aucun cookie du demandeur (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-ok', title: 'Édition code ok' }));
  const person = async () => createAttendee(espace().app, await world(), consenting());

  it('JSON : 200 { me, redirect }, cookie de session posé, /me répond avec ce cookie', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee, { ip: freshIp() });
    const response = await verifyCode(ed, attendee.email, code, { ip: freshIp() });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(Object.keys(response.json).sort(), ['me', 'redirect']);
    assert.equal(response.json.me.id, attendee.documentId);
    assert.equal(new URL(response.json.redirect, espace().publicUrl).pathname, `/espace/${ed.slug}/`);
    const session = response.setCookies.map(parseSetCookie).find((cookie) => cookie.name === SESSION_COOKIE);
    assert.ok(session?.value, 'cookie de session');
    assert.ok(session.attributes.httponly, 'HttpOnly');
    const me = await espace().request('/api/espace/me', { cookie: cookieHeader(response.setCookies) });
    assert.equal(me.status, 200);
  });

  it('l’adresse peut venir du cookie éphémère jib_espace_sent quand le corps n’en porte pas', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    const cookie = `${SENT_COOKIE}=${encodeURIComponent(attendee.email)}`;
    const response = await verifyCode(ed, attendee.email, code, { omitEmail: true, cookie });
    assert.equal(response.status, 200, response.text);
  });

  it('ni adresse dans le corps ni cookie : 400 CODE_INVALID', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    const response = await verifyCode(ed, attendee.email, code, { omitEmail: true });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'CODE_INVALID');
  });

  it('le code accepte les espaces et les tirets : « 1 2 3 4 5 6 », « 123 456 », « 123-456 »', async () => {
    const ed = await world();
    for (const format of [(c) => c.split('').join(' '), (c) => `${c.slice(0, 3)} ${c.slice(3)}`, (c) => `${c.slice(0, 3)}-${c.slice(3)}`, (c) => ` ${c} `]) {
      const attendee = await person();
      const { code } = await issue(ed, attendee);
      const response = await verifyCode(ed, attendee.email, format(code));
      assert.equal(response.status, 200, `${format(code)} : ${response.text}`);
    }
  });

  it('l’adresse est reconnue sans tenir compte de la casse ni des espaces autour', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    const response = await verifyCode(ed, `  ${attendee.email.toUpperCase()} `, code);
    assert.equal(response.status, 200, response.text);
  });

  it('l’inscrit sans consentement est mené vers /bienvenue', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed);
    const { code } = await issue(ed, attendee);
    const response = await verifyCode(ed, attendee.email, code);
    assert.equal(response.status, 200);
    assert.equal(new URL(response.json.redirect, espace().publicUrl).pathname, `/espace/${ed.slug}/bienvenue`);
  });

  it('`next` interne à l’édition est suivi, un `next` externe est ignoré', async () => {
    const ed = await world();
    const a = await person();
    const b = await person();
    const { code: ca } = await issue(ed, a);
    const { code: cb } = await issue(ed, b);
    const inside = await verifyCode(ed, a.email, ca, { next: `/espace/${ed.slug}/agenda` });
    assert.equal(new URL(inside.json.redirect, espace().publicUrl).pathname, `/espace/${ed.slug}/agenda`);
    const outside = await verifyCode(ed, b.email, cb, { next: 'https://exemple.org' });
    assert.equal(new URL(outside.json.redirect, espace().publicUrl).hostname, new URL(espace().publicUrl).hostname);
  });

  it('un participant d’une édition fermée n’obtient pas de session par le code', async () => {
    const { app } = espace();
    const closed = await createEdition(app, { slug: 'edition-code-fermee', title: 'Édition code fermée', enabled: false });
    const attendee = await createAttendee(app, closed, consenting());
    // Aucun e-mail n'est envoyé à un participant d'une édition fermée : un code ne peut exister que fabriqué.
    const response = await verifyCode(closed, attendee.email, '123456');
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'CODE_INVALID');
  });
});

describe('F-103 : l’organisateur d’une édition fermée se connecte par le code (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld({ ORGANIZER_EMAILS: 'code.orga@example.org' });

  it('la session ouverte donne accès aux routes d’administration, la redirection va au pilotage', async () => {
    const { app, request } = espace();
    const ed = await createEdition(app, { slug: 'edition-code-orga', title: 'Édition code orga', enabled: false });
    const orga = await createAttendee(app, ed, { role: 'organizer', email: 'code.orga@example.org', ...consenting() });
    const { code } = await issue(ed, orga);
    const response = await verifyCode(ed, orga.email, code);
    assert.equal(response.status, 200, response.text);
    assert.equal(new URL(response.json.redirect, espace().publicUrl).pathname, `/espace/${ed.slug}/organisateur`);
    assert.equal((await request(`/api/espace/admin/${ed.slug}/sync-runs`, { cookie: cookieHeader(response.setCookies) })).status, 200);
  });
});

describe('usage unique, expiration, lien et code s’invalident l’un l’autre (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-vie', title: 'Édition code vie' }));
  const person = async () => createAttendee(espace().app, await world(), consenting());
  const verifyLink = (token) => espace().request('/api/espace/auth/verify', { method: 'POST', json: { token } });

  it('usage unique : le même code, rejoué, est refusé', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    assert.equal((await verifyCode(ed, attendee.email, code)).status, 200);
    const again = await verifyCode(ed, attendee.email, code);
    assert.equal(again.status, 400);
    assert.equal(again.json.error.code, 'CODE_INVALID');
    assert.equal(again.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).length, 0, 'aucun cookie de session sur un refus');
  });

  it('le lien consommé invalide le code de la même demande', async () => {
    const ed = await world();
    const attendee = await person();
    const { code, link } = await issue(ed, attendee);
    assert.equal((await verifyLink(link.token)).status, 200);
    const refused = await verifyCode(ed, attendee.email, code);
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.code, 'CODE_INVALID');
  });

  it('le code consommé invalide le lien de la même demande', async () => {
    const ed = await world();
    const attendee = await person();
    const { code, link } = await issue(ed, attendee);
    assert.equal((await verifyCode(ed, attendee.email, code)).status, 200);
    const refused = await verifyLink(link.token);
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.code, 'TOKEN_INVALID');
  });

  it('deux demandes : consommer le lien de la première laisse le code de la seconde valable, et tue celui de la première', async () => {
    const ed = await world();
    const attendee = await person();
    const first = await issue(ed, attendee);
    const second = await issue(ed, attendee);
    assert.notEqual(first.code, second.code);
    assert.equal((await verifyLink(first.link.token)).status, 200);
    assert.equal((await verifyCode(ed, attendee.email, first.code)).status, 400);
    assert.equal((await verifyCode(ed, attendee.email, second.code)).status, 200);
  });

  it('expiration à 30 minutes : accepté à +29 min, refusé à +31 min (horloge passée au service)', async () => {
    const ed = await world();
    const { app } = espace();
    const auth = app.service('api::espace.auth');
    const early = await person();
    const late = await person();
    const { code: earlyCode } = await issue(ed, early);
    const { code: lateCode } = await issue(ed, late);
    const call = (attendee, code, minutes) =>
      auth.verifyCode({ editionSlug: ed.slug, email: attendee.email, code, ip: freshIp(), now: new Date(Date.now() + minutes * 60_000) });

    await assert.rejects(call(late, lateCode, 31), (error) => error.status === 400 && error.code === 'CODE_INVALID');
    const opened = await call(early, earlyCode, 29);
    assert.ok(opened.sessionToken, 'session ouverte à +29 min');
  });

  it('expiration en base : un code dont l’échéance est passée reçoit 400 CODE_INVALID, lien compris', async () => {
    const ed = await world();
    const { query } = espace();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    await query(UID.magicToken).updateMany({ where: { attendee: { documentId: attendee.documentId } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const response = await verifyCode(ed, attendee.email, code);
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'CODE_INVALID');
  });

  it('un code d’une autre édition est refusé, et reste valable dans la sienne', async () => {
    const { app } = espace();
    const a = await world();
    const b = await createEdition(app, { slug: 'edition-code-vie-b', title: 'Édition code vie B' });
    const email = 'code.deux.editions@example.org';
    const inA = await createAttendee(app, a, { email, ...consenting() });
    const inB = await createAttendee(app, b, { email, ...consenting() });
    const fromA = await issue(a, inA);
    const fromB = await issue(b, inB);

    const crossed = await verifyCode(b, email, fromA.code);
    assert.equal(crossed.status, 400);
    assert.equal(crossed.json.error.code, 'CODE_INVALID');
    assert.equal((await verifyCode(b, email, fromB.code)).status, 200, 'le code de B ouvre B');
    assert.equal((await verifyCode(a, email, fromA.code)).status, 200, 'le code de A, non entamé par l’essai croisé, ouvre A');
  });

  it('une adresse inscrite dans une autre édition seulement est refusée', async () => {
    const { app } = espace();
    const a = await world();
    const other = await createEdition(app, { slug: 'edition-code-vie-c', title: 'Édition code vie C' });
    const attendee = await person();
    const { code } = await issue(a, attendee);
    const response = await verifyCode(other, attendee.email, code);
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'CODE_INVALID');
  });
});

describe('critère 2 : cinq essais faux invalident le code (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-essais', title: 'Édition code essais' }));
  const person = async () => createAttendee(espace().app, await world(), consenting());

  it('cinq essais faux puis le bon code : refusé (sixième essai)', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    for (let i = 0; i < 5; i += 1) {
      const wrong = await verifyCode(ed, attendee.email, wrongOf(code));
      assert.equal(wrong.status, 400, `essai ${i + 1}`);
    }
    const sixth = await verifyCode(ed, attendee.email, code);
    assert.equal(sixth.status, 400);
    assert.equal(sixth.json.error.code, 'CODE_INVALID');
    assert.equal(sixth.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).length, 0);
  });

  it('quatre essais faux puis le bon code : accepté (limite à la frontière)', async () => {
    const ed = await world();
    const attendee = await person();
    const { code } = await issue(ed, attendee);
    for (let i = 0; i < 4; i += 1) assert.equal((await verifyCode(ed, attendee.email, wrongOf(code))).status, 400);
    assert.equal((await verifyCode(ed, attendee.email, code)).status, 200);
  });

  it('après l’invalidation, le lien de la même demande fonctionne toujours', async () => {
    const ed = await world();
    const attendee = await person();
    const { code, link } = await issue(ed, attendee);
    for (let i = 0; i < 5; i += 1) await verifyCode(ed, attendee.email, wrongOf(code));
    const opened = await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token: link.token } });
    assert.equal(opened.status, 200);
  });

  it('un nouveau lien apporte un nouveau code qui fonctionne après l’invalidation du précédent', async () => {
    const ed = await world();
    const attendee = await person();
    const first = await issue(ed, attendee);
    for (let i = 0; i < 5; i += 1) await verifyCode(ed, attendee.email, wrongOf(first.code));
    const second = await issue(ed, attendee);
    assert.equal((await verifyCode(ed, attendee.email, first.code)).status, 400);
    assert.equal((await verifyCode(ed, attendee.email, second.code)).status, 200);
  });
});

describe('critère 3, F-02 : la réponse est identique pour une adresse inscrite ou non (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-f02', title: 'Édition code F02' }));

  const shape = (response) => ({ status: response.status, json: response.json, sessionCookies: response.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).length });

  it('JSON : adresse inconnue, annulée, code faux sur inscrit avec ou sans code en attente, code mal formé : même statut, même corps', async () => {
    const ed = await world();
    const { app } = espace();
    const pending = await createAttendee(app, ed, consenting());
    const idle = await createAttendee(app, ed, consenting());
    const cancelled = await createAttendee(app, ed, { status: 'cancelled', ...consenting() });
    const { code } = await issue(ed, pending);

    const cases = {
      inconnue: await verifyCode(ed, 'inconnue.f02@example.org', wrongOf(code)),
      annulee: await verifyCode(ed, cancelled.email, wrongOf(code)),
      inscritSansCode: await verifyCode(ed, idle.email, wrongOf(code)),
      inscritAvecCode: await verifyCode(ed, pending.email, wrongOf(code)),
      malForme: await verifyCode(ed, pending.email, 'abc'),
      vide: await verifyCode(ed, pending.email, ''),
    };
    const reference = shape(cases.inconnue);
    assert.equal(reference.status, 400);
    assert.equal(reference.json.error.code, 'CODE_INVALID');
    assert.equal(reference.json.error.message, INVALID_MESSAGE);
    for (const [name, response] of Object.entries(cases)) assert.deepEqual(shape(response), reference, name);
  });

  it('une édition inconnue ne se distingue pas non plus', async () => {
    const ed = await world();
    const unknownEdition = await verifyCode({ slug: 'edition-qui-nexiste-pas' }, 'inconnue.f02@example.org', '123456');
    const known = await verifyCode(ed, 'inconnue.f02@example.org', '123456');
    assert.deepEqual(shape(unknownEdition), shape(known));
  });

  it('formulaire : la même redirection 303 pour une adresse inconnue et un code faux, et le même cookie d’adresse', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee);
    const unknown = await verifyCode(ed, 'inconnue.f02.form@example.org', wrongOf(code), { form: true });
    const wrong = await verifyCode(ed, attendee.email, wrongOf(code), { form: true });
    assert.equal(unknown.status, 303);
    assert.equal(wrong.status, 303);
    assert.equal(unknown.location, wrong.location);
    assert.equal(new URL(wrong.location).pathname, `/espace/${ed.slug}/connexion`);
    assert.equal(new URL(wrong.location).search, '?envoye=1&erreur=code');
    const names = (response) => response.setCookies.map((line) => parseSetCookie(line).name).sort();
    assert.deepEqual(names(unknown), names(wrong));
  });

  it('le temps de réponse d’un code faux est à peu près le même pour une adresse inconnue, inscrite sans code et inscrite avec code', async () => {
    const ed = await world();
    const { app } = espace();
    const pending = await createAttendee(app, ed, consenting());
    const idle = await createAttendee(app, ed, consenting());
    const { code } = await issue(ed, pending);
    const sample = async (email, tries) => {
      const times = [];
      for (let i = 0; i < tries; i += 1) {
        const start = process.hrtime.bigint();
        const response = await verifyCode(ed, email, wrongOf(code));
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
        assert.equal(response.status, 400);
      }
      return times.sort((x, y) => x - y)[Math.floor(times.length / 2)];
    };
    // Quatre essais au plus par code : le cinquième l'invaliderait et fausserait la mesure.
    await sample(pending.email, 1);
    const medians = {
      inconnue: await sample('inconnue.temps@example.org', 4),
      sansCode: await sample(idle.email, 4),
      avecCode: await sample(pending.email, 3),
    };
    const values = Object.values(medians);
    assert.ok(Math.max(...values) - Math.min(...values) < 100, `médianes en ms : ${JSON.stringify(medians)}`);
  });
});

describe('critère 4, NF-03 : limites du code (30 par IP, 10 par adresse) et limites de V1-B inchangées (V3-G)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-debit', title: 'Édition code débit' }));
  const askLink = (slug, email, ip) => espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: slug, email }, ip });

  it('30 essais depuis une IP sont traités, le 31e reçoit 429 RATE_LIMITED, y compris avec le bon code ; le code reste valable ailleurs', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee, { ip: '198.51.100.201' });
    const ip = '198.51.100.200';
    const statuses = [];
    for (let i = 1; i <= 30; i += 1) statuses.push((await verifyCode(ed, `limite.ip.${i}@example.org`, '123456', { ip })).status);
    assert.deepEqual(statuses, Array(30).fill(400));
    const blocked = await verifyCode(ed, attendee.email, code, { ip });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'RATE_LIMITED');
    assert.equal((await verifyCode(ed, attendee.email, code, { ip: '198.51.100.202' })).status, 200, 'le 429 n’a pas entamé le code');
  });

  it('10 essais pour une adresse depuis dix IP sont traités, le 11e reçoit 429 même avec le bon code', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee);
    const statuses = [];
    // Codes mal formés : ils comptent dans la limite sans consommer les cinq essais du code.
    for (let i = 0; i < 10; i += 1) statuses.push((await verifyCode(ed, attendee.email, 'abc', { ip: `198.51.100.${210 + i}` })).status);
    assert.deepEqual(statuses, Array(10).fill(400));
    const blocked = await verifyCode(ed, attendee.email, code, { ip: '198.51.100.230' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error.code, 'RATE_LIMITED');
  });

  it('formulaire : 429 devient un 303 vers ?envoye=1&erreur=trop', async () => {
    const ed = await world();
    const email = 'limite.formulaire@example.org';
    for (let i = 0; i < 10; i += 1) await verifyCode(ed, email, 'abc');
    const blocked = await verifyCode(ed, email, '123456', { form: true });
    assert.equal(blocked.status, 303);
    assert.equal(new URL(blocked.location).pathname, `/espace/${ed.slug}/connexion`);
    assert.equal(new URL(blocked.location).search, '?envoye=1&erreur=trop');
  });

  it('les essais de code n’entament pas le budget des demandes de lien de la même adresse (5), et la sixième demande reste refusée', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    for (let i = 0; i < 10; i += 1) await verifyCode(ed, attendee.email, 'abc');
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await askLink(ed.slug, attendee.email, freshIp())).status);
    assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  });

  it('les demandes de lien n’entament pas le budget des essais de code de l’adresse (10)', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    for (let i = 0; i < 5; i += 1) await askLink(ed.slug, attendee.email, freshIp());
    const statuses = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await verifyCode(ed, attendee.email, 'abc')).status);
    assert.deepEqual(statuses, Array(10).fill(400));
  });

  it('la réponse de la demande de lien reste la même pour une adresse inscrite ou non (F-02)', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const known = await askLink(ed.slug, attendee.email, freshIp());
    const unknown = await askLink(ed.slug, 'inconnue.v1b@example.org', freshIp());
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(known.json, unknown.json);
  });
});

describe('formulaire sans JavaScript : redirections 303 (V3-G, F-142)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-form', title: 'Édition code formulaire' }));

  it('succès : 303 vers l’accueil de l’édition (ou `next`), cookie de session posé, ni code ni adresse dans l’adresse de redirection', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee);
    const response = await verifyCode(ed, attendee.email, code, { form: true, next: `/espace/${ed.slug}/agenda` });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.location).pathname, `/espace/${ed.slug}/agenda`);
    assert.ok(!response.location.includes(code) && !response.location.includes(encodeURIComponent(attendee.email)), response.location);
    assert.ok(response.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`) && parseSetCookie(line).value));
  });

  it('succès d’un inscrit sans consentement : 303 vers /bienvenue', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed);
    const { code } = await issue(ed, attendee);
    const response = await verifyCode(ed, attendee.email, code, { form: true });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.location).pathname, `/espace/${ed.slug}/bienvenue`);
  });

  it('échec : 303 vers /connexion?envoye=1&erreur=code, `next` conservé, adresse rappelée par le cookie et jamais par l’adresse, pas de session', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee);
    const next = `/espace/${ed.slug}/agenda`;
    const response = await verifyCode(ed, attendee.email, wrongOf(code), { form: true, next });
    assert.equal(response.status, 303);
    const url = new URL(response.location);
    assert.equal(url.pathname, `/espace/${ed.slug}/connexion`);
    assert.equal(url.searchParams.get('envoye'), '1');
    assert.equal(url.searchParams.get('erreur'), 'code');
    assert.equal(url.searchParams.get('next'), next);
    for (const secret of [attendee.email, encodeURIComponent(attendee.email), wrongOf(code), code]) assert.ok(!response.location.includes(secret), `${secret} dans ${response.location}`);
    const sent = response.setCookies.map(parseSetCookie).find((cookie) => cookie.name === SENT_COOKIE);
    assert.equal(decodeURIComponent(sent.value), attendee.email);
    assert.ok(!response.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`) && parseSetCookie(line).value));
  });

  it('échec avec l’adresse prise dans le cookie : la redirection est la même et le cookie est reposé', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const cookie = `${SENT_COOKIE}=${encodeURIComponent(attendee.email)}`;
    const response = await verifyCode(ed, attendee.email, '000000', { form: true, omitEmail: true, cookie });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.location).search, '?envoye=1&erreur=code');
    assert.ok(response.setCookies.map(parseSetCookie).some((c) => c.name === SENT_COOKIE && decodeURIComponent(c.value) === attendee.email));
  });
});

describe('le code n’apparaît ni dans les journaux ni dans une adresse (V3-G, I-44)', { timeout: 300_000 }, () => {
  const { espace, issue, verifyCode } = useWorld();
  let edition;
  const world = async () => (edition ??= await createEdition(espace().app, { slug: 'edition-code-journaux', title: 'Édition code journaux' }));

  /** Texte écrit sur la sortie standard et d'erreur pendant `run`, le journal de Strapi étant ouvert au niveau le plus bavard. */
  async function captured(run) {
    const { app } = espace();
    const chunks = [];
    const out = process.stdout.write;
    const err = process.stderr.write;
    const previousLevel = app.log.level;
    process.stdout.write = (chunk, ...rest) => (chunks.push(String(chunk)), out.call(process.stdout, chunk, ...rest));
    process.stderr.write = (chunk, ...rest) => (chunks.push(String(chunk)), err.call(process.stderr, chunk, ...rest));
    app.log.level = 'debug';
    try {
      await run();
    } finally {
      app.log.level = previousLevel;
      process.stdout.write = out;
      process.stderr.write = err;
    }
    return chunks.join('');
  }

  it('demande, essais faux et connexion par code : aucun journal ne contient le code, juste ou faux', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    let code;
    const log = await captured(async () => {
      ({ code } = await issue(ed, attendee));
      await verifyCode(ed, attendee.email, wrongOf(code));
      await verifyCode(ed, attendee.email, wrongOf(code), { form: true });
      await verifyCode(ed, attendee.email, code);
    });
    assert.ok(log.includes('/api/espace/auth/verify-code'), 'le journal des requêtes était bien ouvert');
    for (const secret of [code, code.split('').join(' '), wrongOf(code)]) assert.ok(!log.includes(secret), `« ${secret} » dans le journal`);
  });

  it('les adresses de redirection ne contiennent jamais le code, ni en succès ni en échec', async () => {
    const ed = await world();
    const attendee = await createAttendee(espace().app, ed, consenting());
    const { code } = await issue(ed, attendee);
    const failed = await verifyCode(ed, attendee.email, code.slice(0, 5) + String((Number(code[5]) + 1) % 10), { form: true });
    const opened = await verifyCode(ed, attendee.email, code, { form: true });
    for (const response of [failed, opened]) assert.ok(!(response.location ?? '').includes(code));
  });
});
