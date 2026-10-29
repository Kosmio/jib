'use strict';

/**
 * Accès à l'espace, lot 5 de la phase 1 (tests d'abord) : T-01 à T-04, I-20 à I-23, F-01 à F-04 (côté API), NF-01 à NF-04,
 * NF-52, Q-13, A-16 à A-19, plus l'accès croisé de la section 7 du plan (NF-01 sur /me).
 *
 *   - demande de lien (T-01, T-02, T-04), états d'un lien (A-18, T-03), vérification et session (I-20 à I-22) ;
 *   - cookie jib_espace : attributs, signature, glissement, déconnexion ;
 *   - organisateurs (I-23) ; routes admin refusées aux participants et aux autres éditions ;
 *   - profil : GET et PATCH /me, PUT /me/consent ; accès croisés ; minimisation ;
 *   - gel de l'édition (NF-52) ; redirections 303 absolues sur PUBLIC_URL.
 *
 * Strapi démarre une fois sur TEST_DATABASE ; chaque requête choisit son IP par X-Forwarded-For (IS_PROXIED=true).
 * Les e-mails arrivent dans la boîte de sortie du fournisseur console. Aucun réseau hors localhost.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const { SESSION_COOKIE, cookieHeader, parseSetCookie, sha256, sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, findAttendee } = require('../helpers/espace-data');
const { pending } = require('../helpers/pending');

const DAY = 24 * 3600 * 1000;
// Plusieurs organisateurs : la limitation de débit compte les demandes par adresse (5 par 15 minutes), chaque test a la sienne.
const ORGANIZERS = ['organisation@example.org', 'orga.deux@example.org', 'orga.trois@example.org', 'orga.quatre@example.org'];
const [ORGANIZER, ORGANIZER_2, ORGANIZER_3, ORGANIZER_4] = ORGANIZERS;
const ME_KEYS = ['company', 'consent', 'edition', 'firstName', 'id', 'isOrganizer', 'jobTitle', 'lastName', 'role'];

describe('accès à l’espace (lot 5)', { timeout: 300_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: ORGANIZERS.join(',') } });

  // Données partagées, créées à la première utilisation : deux éditions ouvertes et une fermée.
  let worldPromise;
  const world = () =>
    (worldPromise ??= (async () => {
      const { app } = espace();
      return {
        a: await createEdition(app, { slug: 'edition-a', title: 'Édition A' }),
        c: await createEdition(app, { slug: 'edition-c', title: 'Édition C' }),
        closed: await createEdition(app, { slug: 'edition-fermee', title: 'Édition fermée', enabled: false }),
      };
    })());

  /** Crée un Attendee de l'édition (champs surchargeables) et ouvre sa session par le parcours réel : demande, lien, vérification. */
  async function person(edition, fields = {}, options) {
    const { app, signIn } = espace();
    const attendee = await createAttendee(app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await signIn(edition.slug, attendee.email, options)) };
  }

  const askLink = (editionSlug, email, options = {}) => espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug, email }, ...options });
  const me = (cookie, options = {}) => espace().request('/api/espace/me', { cookie, ...options });
  const sessionsOf = (attendee) => espace().query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId }, kind: 'session' } });
  /** Met à jour les lignes `session` d'un Attendee (par identifiant : pas de filtre de relation dans une mise à jour). */
  const updateSessions = async (attendee, data) => {
    for (const row of await sessionsOf(attendee)) await espace().query(UID.magicToken).update({ where: { id: row.id }, data });
  };
  const linksOf = (attendee) => espace().query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId }, kind: 'link' } });

  describe('T-01 : demande de lien pour un inscrit (I-20, F-01, F-02)', pending('lot 5'), () => {
    it('répond 202 { status: accepted } et dépose un e-mail à l’inscrit dans la boîte de sortie', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail } = espace();
      const attendee = await createAttendee(app, a, { firstName: 'Léa' });
      const since = outbox().length;
      const response = await askLink(a.slug, attendee.email);
      assert.equal(response.status, 202);
      assert.deepEqual(response.json, { status: 'accepted' });
      const mail = await waitForMail((candidate) => candidate.to.email === attendee.email, { since });
      assert.ok(mail.subject.length > 0);
      assert.ok(mail.html.includes('Léa') && mail.text.includes('Léa'));
    });

    it('place dans l’e-mail un lien {PUBLIC_URL}/espace/verifier?token=… dont le jeton compte 43 caractères base64url (32 octets)', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail, linkOf, publicUrl } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      await askLink(a.slug, attendee.email);
      const found = linkOf(await waitForMail((mail) => mail.to.email === attendee.email, { since }));
      assert.ok(found.url.startsWith(`${publicUrl}/espace/verifier?token=`), found.url);
      assert.match(found.token, /^[A-Za-z0-9_-]{43}$/);
    });

    it('le lien vaut 30 minutes (I-20) et ne figure en base que sous forme d’empreinte SHA-256 (NF-02)', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail, linkOf } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      const t0 = Date.now();
      await askLink(a.slug, attendee.email);
      const mail = await waitForMail((candidate) => candidate.to.email === attendee.email, { since });
      const t1 = Date.now();
      const { token } = linkOf(mail);

      const [row] = await linksOf(attendee);
      assert.equal(row.tokenHash, sha256(token));
      assert.equal(row.usedAt ?? null, null);
      const expiresAt = new Date(row.expiresAt).getTime();
      assert.ok(expiresAt >= t0 + 30 * 60_000 - 1000 && expiresAt <= t1 + 30 * 60_000 + 1000, `échéance ${new Date(expiresAt).toISOString()}`);
      const everything = JSON.stringify(await app.db.query(UID.magicToken).findMany({}));
      assert.ok(!everything.includes(token), 'jeton en clair stocké dans MagicToken');
      const logs = JSON.stringify(await app.db.query(UID.emailLog).findMany({}));
      assert.ok(!logs.includes(token), 'jeton en clair dans EmailLog');
    });

    it('journalise l’envoi dans EmailLog : gabarit access-link, statut sent (I-31)', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      await askLink(a.slug, attendee.email);
      await waitForMail((mail) => mail.to.email === attendee.email, { since });
      await sleep(200);
      const logs = await app.db.query(UID.emailLog).findMany({ where: { attendee: { documentId: attendee.documentId } } });
      assert.equal(logs.length, 1);
      assert.equal(logs[0].template, 'access-link');
      assert.equal(logs[0].status, 'sent');
    });

    it('reconnaît l’adresse malgré les majuscules et les espaces', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      const response = await askLink(a.slug, `  ${attendee.email.toUpperCase()}  `);
      assert.equal(response.status, 202);
      await waitForMail((mail) => mail.to.email === attendee.email, { since });
    });

    it('échappe un prénom contenant du HTML dans l’e-mail (NF-05)', async () => {
      const { a } = await world();
      const { app, outbox, waitForMail } = espace();
      const attendee = await createAttendee(app, a, { firstName: '<script>alert(1)</script>' });
      const since = outbox().length;
      await askLink(a.slug, attendee.email);
      const mail = await waitForMail((candidate) => candidate.to.email === attendee.email, { since });
      assert.ok(!mail.html.includes('<script>alert(1)'));
    });

    it('répond 400 EMAIL_INVALID à une adresse mal formée, sans envoi', async () => {
      const { a } = await world();
      const { outbox, mailsSince } = espace();
      const since = outbox().length;
      const invalid = ['pas-un-email', 'a@', '@example.org', 'a b@example.org'];
      for (const email of ['pas-un-email', '', 'a@', '@example.org', 'a b@example.org']) {
        const response = await askLink(a.slug, email);
        assert.equal(response.status, 400, JSON.stringify(email));
        assert.equal(response.json.error.code, 'EMAIL_INVALID', JSON.stringify(email));
      }
      assert.deepEqual(await mailsSince(since, { to: invalid }), []);
    });

    it('exige un Origin admis : sans Origin, 403 ORIGIN_REFUSED et aucun envoi (NF-04)', async () => {
      const { a } = await world();
      const { app, outbox, mailsSince } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      const response = await askLink(a.slug, attendee.email, { origin: null });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
      assert.deepEqual(await mailsSince(since, { to: attendee.email }), []);
      assert.equal((await linksOf(attendee)).length, 0);
    });

    describe('formulaire sans JavaScript (NF-31) : redirection 303 absolue sur PUBLIC_URL', () => {
      const submit = (fields, options = {}) => espace().request('/api/espace/auth/request-link', { method: 'POST', form: fields, ...options });

      it('adresse valable : 303 vers /espace/{édition}/connexion?envoye=1', async () => {
        const { a } = await world();
        const attendee = await createAttendee(espace().app, a);
        const response = await submit({ editionSlug: a.slug, email: attendee.email });
        assert.equal(response.status, 303);
        assert.equal(response.location, `${espace().publicUrl}/espace/${a.slug}/connexion?envoye=1`);
      });

      it('adresse inconnue : même redirection ?envoye=1 (pas d’énumération)', async () => {
        const { a } = await world();
        const response = await submit({ editionSlug: a.slug, email: 'inconnu.formulaire@example.org' });
        assert.equal(response.status, 303);
        assert.equal(response.location, `${espace().publicUrl}/espace/${a.slug}/connexion?envoye=1`);
      });

      it('adresse mal formée : 303 vers ?erreur=email', async () => {
        const { a } = await world();
        const response = await submit({ editionSlug: a.slug, email: 'pas-un-email' });
        assert.equal(response.status, 303);
        assert.equal(response.location, `${espace().publicUrl}/espace/${a.slug}/connexion?erreur=email`);
      });

      it('trop de demandes : 303 vers ?erreur=trop', async () => {
        const { a } = await world();
        const email = 'rafale.formulaire@example.org';
        const locations = [];
        for (let i = 0; i < 6; i += 1) locations.push((await submit({ editionSlug: a.slug, email })).location);
        assert.equal(locations.at(-1), `${espace().publicUrl}/espace/${a.slug}/connexion?erreur=trop`);
        assert.equal(locations[0], `${espace().publicUrl}/espace/${a.slug}/connexion?envoye=1`);
      });

      it('ne redirige jamais hors de PUBLIC_URL, même avec un identifiant d’édition hostile', async () => {
        for (const editionSlug of ['../../evil.example.org', '//evil.example.org', 'a\\@evil.example.org', 'https://evil.example.org']) {
          const response = await submit({ editionSlug, email: 'hostile.formulaire@example.org' });
          assert.equal(response.status, 303, `statut pour ${editionSlug}`);
          assert.equal(new URL(response.location).origin, new URL(espace().publicUrl).origin, response.location);
        }
      });
    });
  });

  describe('T-02 : demande de lien sans suite (F-02, NF-52) : même réponse, aucun e-mail', pending('lot 5'), () => {
    const sameAnswer = async (editionSlug, email) => {
      const { outbox, mailsSince } = espace();
      const since = outbox().length;
      const response = await askLink(editionSlug, email);
      assert.equal(response.status, 202, email);
      assert.deepEqual(response.json, { status: 'accepted' }, email);
      assert.deepEqual(await mailsSince(since, { to: email }), [], `e-mail envoyé à ${email}`);
    };

    it('adresse inconnue de l’édition', async () => {
      await sameAnswer((await world()).a.slug, 'personne.inconnue@example.org');
    });

    it('Attendee annulé (cancelled)', async () => {
      const { a } = await world();
      const attendee = await createAttendee(espace().app, a, { status: 'cancelled' });
      await sameAnswer(a.slug, attendee.email);
      assert.equal((await linksOf(attendee)).length, 0);
    });

    it('édition inconnue', async () => {
      const { a } = await world();
      const attendee = await createAttendee(espace().app, a);
      await sameAnswer('edition-qui-n-existe-pas', attendee.email);
    });

    it('édition fermée (participantSpaceEnabled false, NF-52), même pour un inscrit', async () => {
      const { closed } = await world();
      const attendee = await createAttendee(espace().app, closed);
      await sameAnswer(closed.slug, attendee.email);
      assert.equal((await linksOf(attendee)).length, 0);
    });

    it('inscrit d’une autre édition : l’adresse n’est pas reconnue dans celle-ci', async () => {
      const { a, c } = await world();
      const attendee = await createAttendee(espace().app, c);
      await sameAnswer(a.slug, attendee.email);
    });

    it('adresse hors ORGANIZER_EMAILS sans Attendee : aucun Attendee créé', async () => {
      const { a } = await world();
      const email = 'curieux.sans.billet@example.org';
      await sameAnswer(a.slug, email);
      assert.equal(await findAttendee(espace().app, a, email), null);
    });
  });

  describe('A-19 : la réponse n’attend pas l’envoi de l’e-mail (F-02)', pending('lot 5'), () => {
    // Le temps de réponse ne doit pas distinguer une adresse connue d'une adresse inconnue. On bloque donc l'envoi : la boîte de
    // sortie devient un tube nommé, où le fournisseur console n'écrit qu'une fois un lecteur ouvert. Une réponse qui attendrait
    // l'envoi ne reviendrait pas tant que le test ne lit pas le tube.
    it('répond 202 en moins de 3 secondes alors que l’envoi est bloqué, puis l’e-mail part une fois le blocage levé', async () => {
      const { a } = await world();
      const { app, outboxFile } = espace();
      const attendee = await createAttendee(app, a);
      fs.rmSync(outboxFile, { force: true });
      execFileSync('mkfifo', [outboxFile]);
      let outcome;
      let received = '';
      try {
        outcome = await Promise.race([askLink(a.slug, attendee.email), sleep(3000).then(() => 'bloquée')]);
      } finally {
        // Lève le blocage : lire le tube laisse le fournisseur écrire sa ligne.
        for await (const chunk of fs.createReadStream(outboxFile)) {
          received += chunk;
          if (received.includes('\n')) break;
        }
        await sleep(100);
        fs.rmSync(outboxFile, { force: true });
      }
      assert.notEqual(outcome, 'bloquée', 'la réponse attend l’envoi de l’e-mail');
      assert.equal(outcome.status, 202);
      assert.equal(JSON.parse(received.split('\n')[0]).to.email, attendee.email);
    });
  });

  describe('T-04 : limitation de débit de la demande de lien (NF-03, F-02)', pending('lot 5'), () => {
    it('refuse la 6e demande en 15 minutes pour une même adresse : 429 RATE_LIMITED', async () => {
      const { a } = await world();
      const attendee = await createAttendee(espace().app, a);
      const statuses = [];
      let last;
      for (let i = 0; i < 6; i += 1) {
        last = await askLink(a.slug, attendee.email);
        statuses.push(last.status);
      }
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
      assert.equal(last.json.error.code, 'RATE_LIMITED');
      assert.equal(last.json.error.message, 'Trop de demandes, réessayez dans quelques minutes.');
    });

    it('n’envoie pas d’e-mail à la demande refusée : 5 e-mails pour 6 demandes', async () => {
      const { a } = await world();
      const { app, outbox, mailsSince } = espace();
      const attendee = await createAttendee(app, a);
      const since = outbox().length;
      for (let i = 0; i < 6; i += 1) await askLink(a.slug, attendee.email);
      const sent = (await mailsSince(since, { settleMs: 800 })).filter((mail) => mail.to.email === attendee.email);
      assert.equal(sent.length, 5);
    });

    it('compte aussi les adresses inconnues : la 6e demande pour une adresse sans billet reçoit 429 (pas d’énumération)', async () => {
      const { a } = await world();
      const statuses = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await askLink(a.slug, 'inconnue.en.rafale@example.org')).status);
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
    });

    it('compte la normalisation de l’adresse : majuscules et espaces ne contournent pas la limite', async () => {
      const { a } = await world();
      const statuses = [];
      for (const variant of ['Rafale.Casse@Example.org', 'rafale.casse@example.org', ' rafale.casse@example.org', 'RAFALE.CASSE@EXAMPLE.ORG', 'rafale.casse@example.org ', 'Rafale.casse@example.org']) {
        statuses.push((await askLink(a.slug, variant)).status);
      }
      assert.equal(statuses.at(-1), 429);
    });

    it('limite aussi par IP : 6 adresses différentes depuis la même IP, la 6e reçoit 429', async () => {
      const { a } = await world();
      const statuses = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await askLink(a.slug, `ip.partagee.${i}@example.org`, { ip: '198.51.100.7' })).status);
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
    });

    it('lit l’IP du client dans X-Forwarded-For : une IP différente repart à zéro', async () => {
      const { a } = await world();
      for (let i = 0; i < 6; i += 1) await askLink(a.slug, `ip.epuisee.${i}@example.org`, { ip: '198.51.100.8' });
      assert.equal((await askLink(a.slug, 'ip.autre@example.org', { ip: '198.51.100.9' })).status, 202);
    });

    it('ne se laisse pas contourner par de fausses IP en tête de X-Forwarded-For : seule la dernière entrée compte (proxy.maxIpsCount)', async () => {
      const { a } = await world();
      const statuses = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await askLink(a.slug, `usurpation.${i}@example.org`, { ip: `203.0.113.${i + 10}, 198.51.100.10` })).status);
      assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
    });
  });

  describe('A-18 : état d’un lien sans le consommer (GET /auth/link)', pending('lot 5'), () => {
    async function freshLink(edition) {
      const { app, outbox, waitForMail, linkOf } = espace();
      const attendee = await createAttendee(app, edition);
      const since = outbox().length;
      await askLink(edition.slug, attendee.email);
      const found = linkOf(await waitForMail((mail) => mail.to.email === attendee.email, { since }));
      return { attendee, ...found };
    }
    const state = (token) => espace().request(`/api/espace/auth/link?token=${encodeURIComponent(token)}`);

    it('lien valable : 200 { valid: true, editionSlug }, sans adresse', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      const response = await state(token);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { valid: true, editionSlug: a.slug });
    });

    it('ne consomme pas le lien : lu plusieurs fois, il reste valable et se vérifie ensuite (Q-13)', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      for (let i = 0; i < 3; i += 1) assert.equal((await state(token)).json.valid, true);
      assert.equal((await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token } })).status, 200);
    });

    it('lien déjà utilisé : { valid: false, editionSlug, email } pour préremplir le formulaire (F-04)', async () => {
      const { a } = await world();
      const { attendee, token } = await freshLink(a);
      await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token } });
      const response = await state(token);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { valid: false, editionSlug: a.slug, email: attendee.email });
    });

    it('lien expiré : même état que le lien utilisé (T-03)', async () => {
      const { a } = await world();
      const { attendee, token } = await freshLink(a);
      await espace().query(UID.magicToken).update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const response = await state(token);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { valid: false, editionSlug: a.slug, email: attendee.email });
    });

    it('lien inconnu, vide ou absent : 200 { valid: false } sans rien d’autre', async () => {
      for (const path of [`/api/espace/auth/link?token=${'x'.repeat(43)}`, '/api/espace/auth/link?token=', '/api/espace/auth/link']) {
        const response = await espace().request(path);
        assert.equal(response.status, 200, path);
        assert.deepEqual(response.json, { valid: false }, path);
      }
    });

    it('est une lecture : GET sans Origin accepté', async () => {
      const response = await espace().request('/api/espace/auth/link?token=abc', { origin: null });
      assert.equal(response.status, 200);
    });
  });

  describe('T-03, I-20, I-21 : vérification du lien et ouverture de session (POST /auth/verify)', pending('lot 5'), () => {
    async function freshLink(edition, fields = {}) {
      const { app, outbox, waitForMail, linkOf } = espace();
      const attendee = await createAttendee(app, edition, fields);
      const since = outbox().length;
      await askLink(edition.slug, attendee.email);
      return { attendee, ...linkOf(await waitForMail((mail) => mail.to.email === attendee.email, { since })) };
    }
    const verify = (body, options = {}) => espace().request('/api/espace/auth/verify', { method: 'POST', json: body, ...options });

    it('200 { me, redirect } avec le cookie de session ; première connexion sans consentement : redirection vers /bienvenue', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      const response = await verify({ token });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['me', 'redirect']);
      assert.equal(new URL(response.json.redirect, espace().publicUrl).pathname, `/espace/${a.slug}/bienvenue`);
      assert.ok(response.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`)));
    });

    it('me : prénom, nom, fonction, entreprise, rôle, édition et consentements, sans e-mail ni identifiant HelloAsso', async () => {
      const { a } = await world();
      const { attendee, token } = await freshLink(a, { firstName: 'Mathis', lastName: 'Lagrange', jobTitle: 'Dirigeant', company: 'Pinède & Fils' });
      const { json } = await verify({ token });
      assert.deepEqual(Object.keys(json.me).sort(), ME_KEYS);
      assert.equal(json.me.id, attendee.documentId);
      assert.deepEqual([json.me.firstName, json.me.lastName, json.me.jobTitle, json.me.company, json.me.role, json.me.isOrganizer], ['Mathis', 'Lagrange', 'Dirigeant', 'Pinède & Fils', 'participant', false]);
      assert.deepEqual(json.me.edition, { slug: a.slug, title: 'Édition A' });
      assert.deepEqual(json.me.consent, { directoryOptIn: false, meetingsOptIn: false, newsOptIn: false, consentAt: null });
      const text = JSON.stringify(json);
      assert.ok(!text.includes(attendee.email), 'e-mail dans la réponse');
      assert.ok(!text.includes(attendee.helloassoItemId) && !text.includes(attendee.helloassoOrderId), 'identifiants HelloAsso dans la réponse');
    });

    it('un lien ne sert qu’une fois : la seconde vérification donne 400 TOKEN_INVALID', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      assert.equal((await verify({ token })).status, 200);
      const second = await verify({ token });
      assert.equal(second.status, 400);
      assert.equal(second.json.error.code, 'TOKEN_INVALID');
      assert.equal(second.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`) && !/max-age=0|expires=Thu, 01 Jan 1970/i.test(line)).length, 0, 'cookie posé malgré l’échec');
    });

    it('un lien expiré donne 400 TOKEN_INVALID (T-03)', async () => {
      const { a } = await world();
      const { attendee, token } = await freshLink(a);
      await espace().query(UID.magicToken).update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const response = await verify({ token });
      assert.equal(response.status, 400);
      assert.equal(response.json.error.code, 'TOKEN_INVALID');
      assert.equal((await sessionsOf(attendee)).length, 0);
    });

    it('un jeton inconnu, vide ou absent donne 400 TOKEN_INVALID', async () => {
      for (const body of [{ token: 'x'.repeat(43) }, { token: '' }, {}, { token: null }, { token: 42 }]) {
        const response = await verify(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.json.error.code, 'TOKEN_INVALID', JSON.stringify(body));
      }
    });

    it('une empreinte n’est pas un jeton : présenter le hachage stocké est refusé (NF-02)', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      assert.equal((await verify({ token: sha256(token) })).status, 400);
    });

    it('deux vérifications simultanées du même lien : une réussit, l’autre échoue, une seule session en base (A-16)', async () => {
      const { a } = await world();
      const { attendee, token } = await freshLink(a);
      const results = await Promise.all(Array.from({ length: 6 }, () => verify({ token })));
      assert.equal(results.filter((response) => response.status === 200).length, 1);
      assert.equal(results.filter((response) => response.status === 400).length, 5);
      assert.equal((await sessionsOf(attendee)).length, 1);
    });

    it('ouvre une session de 30 jours avec l’IP de la vérification, marque le lien utilisé, pose activatedAt et lastSeenAt', async () => {
      const { a } = await world();
      const { app } = espace();
      const { attendee, token } = await freshLink(a);
      const t0 = Date.now();
      assert.equal((await verify({ token }, { ip: '198.51.100.55' })).status, 200);
      const [session] = await sessionsOf(attendee);
      assert.equal(session.kind, 'session');
      assert.equal(session.ip, '198.51.100.55');
      assert.ok(Math.abs(new Date(session.expiresAt).getTime() - (t0 + 30 * DAY)) < 60_000, 'échéance à 30 jours');
      assert.ok(new Date((await linksOf(attendee))[0].usedAt).getTime() >= t0 - 1000, 'lien non marqué utilisé');
      const stored = await app.documents(UID.attendee).findOne({ documentId: attendee.documentId });
      assert.ok(stored.activatedAt, 'activatedAt vide');
      assert.ok(stored.lastSeenAt, 'lastSeenAt vide');
    });

    it('garde activatedAt à la première connexion : une seconde connexion ne le modifie pas', async () => {
      const { a } = await world();
      const { app, signIn } = espace();
      const { attendee, token } = await freshLink(a);
      await verify({ token });
      const first = (await app.documents(UID.attendee).findOne({ documentId: attendee.documentId })).activatedAt;
      await sleep(30);
      await signIn(a.slug, attendee.email);
      assert.equal(new Date((await app.documents(UID.attendee).findOne({ documentId: attendee.documentId })).activatedAt).toISOString(), new Date(first).toISOString());
    });

    it('lien d’action de 72 heures (I-21) : accepté, avec redirection vers le chemin `next` de l’édition', async () => {
      const { a } = await world();
      const { app } = espace();
      const attendee = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const token = await app.service('api::espace.tokens').issueLink(attendee.documentId, { ttlMinutes: 72 * 60, ip: '10.1.1.1', now: new Date() });
      const response = await verify({ token, next: `/espace/${a.slug}/rendez-vous` });
      assert.equal(response.status, 200);
      assert.equal(new URL(response.json.redirect, espace().publicUrl).pathname, `/espace/${a.slug}/rendez-vous`);
    });

    it('un lien d’action émis il y a 71 heures est encore valable, celui de 73 heures ne l’est plus (I-21)', async () => {
      const { a } = await world();
      const { app } = espace();
      const tokens = app.service('api::espace.tokens');
      const attendee = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const recent = await tokens.issueLink(attendee.documentId, { ttlMinutes: 72 * 60, ip: '10.1.1.2', now: new Date(Date.now() - 71 * 3600_000) });
      const old = await tokens.issueLink(attendee.documentId, { ttlMinutes: 72 * 60, ip: '10.1.1.3', now: new Date(Date.now() - 73 * 3600_000) });
      assert.equal((await verify({ token: old })).status, 400);
      assert.equal((await verify({ token: recent })).status, 200);
    });

    it('avec consentement déjà donné et sans `next` : redirection vers l’accueil de l’édition', async () => {
      const { a } = await world();
      const { token } = await freshLink(a, { consentAt: new Date().toISOString() });
      const { json } = await verify({ token });
      assert.equal(new URL(json.redirect, espace().publicUrl).pathname, `/espace/${a.slug}/`);
    });

    it('ramène un `next` hors de l’édition à l’accueil de l’édition : aucune redirection ouverte (critère 6)', async () => {
      const { a } = await world();
      for (const next of ['https://evil.example.org/', '//evil.example.org', '/espace/edition-c/', `/espace/${a.slug}/../../admin`, '/\\evil.example.org']) {
        const { token } = await freshLink(a, { consentAt: new Date().toISOString() });
        const { json } = await verify({ token, next });
        assert.equal(new URL(json.redirect, espace().publicUrl).pathname, `/espace/${a.slug}/`, next);
        assert.ok(!json.redirect.includes('evil'), json.redirect);
      }
    });

    it('exige un Origin admis : sans Origin, 403 ORIGIN_REFUSED, et le lien reste intact (NF-04)', async () => {
      const { a } = await world();
      const { token } = await freshLink(a);
      const refused = await verify({ token }, { origin: null });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error.code, 'ORIGIN_REFUSED');
      assert.equal((await verify({ token })).status, 200);
    });

    describe('formulaire sans JavaScript (Q-13, NF-31) : 303 absolues sur PUBLIC_URL', () => {
      const submit = (fields) => espace().request('/api/espace/auth/verify', { method: 'POST', form: fields });

      it('succès, sans consentement : 303 vers /espace/{édition}/bienvenue, avec le cookie', async () => {
        const { a } = await world();
        const { token } = await freshLink(a);
        const response = await submit({ token });
        assert.equal(response.status, 303);
        assert.equal(response.location, `${espace().publicUrl}/espace/${a.slug}/bienvenue`);
        assert.ok(response.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`)));
      });

      it('succès, consentement donné : 303 vers le chemin `next` de l’édition', async () => {
        const { a } = await world();
        const { token } = await freshLink(a, { consentAt: new Date().toISOString() });
        const response = await submit({ token, next: `/espace/${a.slug}/profil` });
        assert.equal(response.status, 303);
        assert.equal(response.location, `${espace().publicUrl}/espace/${a.slug}/profil`);
      });

      it('échec : 303 vers /espace/verifier?token=…&next=… sur PUBLIC_URL, sans adresse dans l’URL (A-18)', async () => {
        const { a } = await world();
        const { token } = await freshLink(a);
        await submit({ token });
        const response = await submit({ token, next: `/espace/${a.slug}/` });
        assert.equal(response.status, 303);
        const target = new URL(response.location);
        assert.equal(target.origin, new URL(espace().publicUrl).origin);
        assert.equal(target.pathname, '/espace/verifier');
        assert.equal(target.searchParams.get('token'), token);
        assert.equal(target.searchParams.get('next'), `/espace/${a.slug}/`);
        assert.ok(!/@|email/i.test(response.location), 'adresse e-mail dans l’URL');
        assert.equal(response.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).length, 0);
      });
    });
  });

  describe('I-22 : cookie de session jib_espace', pending('lot 5'), () => {
    it('est HttpOnly, SameSite=Lax, Path=/, signé, valable 30 jours, sans Secure en http local', async () => {
      const { a } = await world();
      const { setCookies } = (await person(a)).response;
      const cookies = setCookies.map(parseSetCookie);
      const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      const signature = cookies.find((cookie) => cookie.name === `${SESSION_COOKIE}.sig`);
      assert.ok(session, 'cookie jib_espace absent');
      assert.ok(signature, 'cookie de signature absent : le cookie doit être signé');
      for (const cookie of [session, signature]) {
        assert.equal(cookie.attributes.httponly, true, `${cookie.name} HttpOnly`);
        assert.match(String(cookie.attributes.samesite), /^lax$/i, `${cookie.name} SameSite`);
        assert.equal(cookie.attributes.path, '/', `${cookie.name} Path`);
        assert.ok(!('secure' in cookie.attributes), `${cookie.name} ne doit pas être Secure en http`);
      }
      const lifetime = cookie => (cookie.attributes['max-age'] ? Number(cookie.attributes['max-age']) * 1000 : new Date(cookie.attributes.expires).getTime() - Date.now());
      assert.ok(Math.abs(lifetime(session) - 30 * DAY) < 5 * 60_000, `durée ${lifetime(session) / DAY} jours`);
    });

    it('ne contient ni l’adresse e-mail ni l’identifiant de l’Attendee en clair', async () => {
      const { a } = await world();
      const { attendee, response } = await person(a);
      const value = decodeURIComponent(response.setCookies.map(parseSetCookie).find((cookie) => cookie.name === SESSION_COOKIE).value);
      assert.ok(!value.includes(attendee.email) && !value.includes(attendee.documentId));
    });

    it('donne accès à /me pour son propriétaire seulement', async () => {
      const { a } = await world();
      const alice = await person(a, { firstName: 'Alice' });
      const bob = await person(a, { firstName: 'Bob' });
      assert.equal((await me(alice.cookie)).json.firstName, 'Alice');
      assert.equal((await me(bob.cookie)).json.firstName, 'Bob');
    });

    it('refuse sans cookie : 401 UNAUTHENTICATED', async () => {
      const response = await me(undefined);
      assert.equal(response.status, 401);
      assert.equal(response.json.error.code, 'UNAUTHENTICATED');
    });

    it('refuse un cookie dont la signature est retirée, altérée ou échangée (NF-01)', async () => {
      const { a } = await world();
      const alice = await person(a);
      const bob = await person(a);
      const pairs = (cookie) => Object.fromEntries(cookie.split('; ').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
      const A = pairs(alice.cookie);
      const B = pairs(bob.cookie);
      const header = (jar) => Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
      assert.equal((await me(alice.cookie)).status, 200);

      const unsigned = { [SESSION_COOKIE]: A[SESSION_COOKIE] };
      const flipped = { ...A, [`${SESSION_COOKIE}.sig`]: `${A[`${SESSION_COOKIE}.sig`].slice(0, -2)}${A[`${SESSION_COOKIE}.sig`].endsWith('AA') ? 'BB' : 'AA'}` };
      const altered = { ...A, [SESSION_COOKIE]: `${A[SESSION_COOKIE].slice(0, -1)}${A[SESSION_COOKIE].endsWith('a') ? 'b' : 'a'}` };
      const swapped = { [SESSION_COOKIE]: B[SESSION_COOKIE], [`${SESSION_COOKIE}.sig`]: A[`${SESSION_COOKIE}.sig`] };
      for (const [label, jar] of Object.entries({ unsigned, flipped, altered, swapped })) {
        assert.equal((await me(header(jar))).status, 401, label);
      }
      assert.equal((await me(`${SESSION_COOKIE}=n-importe-quoi`)).status, 401);
    });

    it('refuse une session expirée en base : 401', async () => {
      const { a } = await world();
      const alice = await person(a);
      await updateSessions(alice.attendee, { expiresAt: new Date(Date.now() - 1000) });
      assert.equal((await me(alice.cookie)).status, 401);
    });

    it('refuse la session d’un Attendee annulé (status cancelled) : 401', async () => {
      const { a } = await world();
      const alice = await person(a);
      assert.equal((await me(alice.cookie)).status, 200);
      await espace().app.documents(UID.attendee).update({ documentId: alice.attendee.documentId, data: { status: 'cancelled' } });
      assert.equal((await me(alice.cookie)).status, 401);
    });

    it('glissement : prolonge la session à 30 jours au plus une fois par jour, cookie compris', async () => {
      const { a } = await world();
      const alice = await person(a);
      const expiry = async () => new Date((await sessionsOf(alice.attendee))[0].expiresAt).getTime();

      const initial = await expiry();
      const fresh = await me(alice.cookie);
      assert.equal(fresh.status, 200);
      assert.equal(await expiry(), initial, 'session neuve : aucune écriture à chaque requête');

      await updateSessions(alice.attendee, { expiresAt: new Date(Date.now() + 20 * DAY) });
      const slid = await me(alice.cookie);
      assert.equal(slid.status, 200);
      const extended = await expiry();
      assert.ok(Math.abs(extended - (Date.now() + 30 * DAY)) < 5 * 60_000, `prolongée jusqu’à ${new Date(extended).toISOString()}`);
      assert.ok(slid.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`)), 'cookie renouvelé avec la prolongation');

      await me(alice.cookie);
      assert.equal(await expiry(), extended, 'une seule prolongation par jour');
    });

    it('déconnexion : 204, cookie supprimé, session retirée de la base, et le même cookie reçoit ensuite 401', async () => {
      const { a } = await world();
      const alice = await person(a);
      const { request } = espace();
      const out = await request('/api/espace/auth/logout', { method: 'POST', cookie: alice.cookie });
      assert.equal(out.status, 204);
      assert.ok(out.setCookies.some((line) => line.startsWith(`${SESSION_COOKIE}=`) && (/max-age=0/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line) || line.startsWith(`${SESSION_COOKIE}=;`))), 'cookie non supprimé');
      assert.equal((await sessionsOf(alice.attendee)).length, 0);
      assert.equal((await me(alice.cookie)).status, 401);
    });

    it('déconnexion sans session : même réponse 204', async () => {
      assert.equal((await espace().request('/api/espace/auth/logout', { method: 'POST' })).status, 204);
    });

    it('déconnexion d’un seul appareil : les autres sessions du même Attendee restent ouvertes', async () => {
      const { a } = await world();
      const { signIn } = espace();
      const first = await person(a);
      const second = await signIn(a.slug, first.attendee.email);
      await espace().request('/api/espace/auth/logout', { method: 'POST', cookie: first.cookie });
      assert.equal((await me(first.cookie)).status, 401);
      assert.equal((await me(second.cookie)).status, 200);
    });

    it('exige un Origin admis : sans Origin, 403 ORIGIN_REFUSED et la session reste ouverte (NF-04)', async () => {
      const { a } = await world();
      const alice = await person(a);
      const refused = await espace().request('/api/espace/auth/logout', { method: 'POST', cookie: alice.cookie, origin: null });
      assert.equal(refused.status, 403);
      assert.equal((await me(alice.cookie)).status, 200);
    });

    it('formulaire de déconnexion (champ editionSlug) : 303 vers /espace/{édition}/connexion?deconnecte=1, avec ou sans session', async () => {
      const { a } = await world();
      const alice = await person(a);
      const { request, publicUrl } = espace();
      const withSession = await request('/api/espace/auth/logout', { method: 'POST', cookie: alice.cookie, form: { editionSlug: a.slug } });
      assert.equal(withSession.status, 303);
      assert.equal(withSession.location, `${publicUrl}/espace/${a.slug}/connexion?deconnecte=1`);
      assert.equal((await me(alice.cookie)).status, 401);
      const without = await request('/api/espace/auth/logout', { method: 'POST', form: { editionSlug: a.slug } });
      assert.equal(without.status, 303);
      assert.equal(without.location, `${publicUrl}/espace/${a.slug}/connexion?deconnecte=1`);
    });
  });

  describe('I-23 : organisateurs', pending('lot 5'), () => {
    it('une adresse de ORGANIZER_EMAILS sans billet reçoit un lien et devient Attendee organizer : invisible et sans consentement', async () => {
      const { a } = await world();
      const { app, signIn } = espace();
      assert.equal(await findAttendee(app, a, ORGANIZER), null);
      const { me: profile } = await signIn(a.slug, ORGANIZER);
      const organizer = await findAttendee(app, a, ORGANIZER);
      assert.equal(organizer.role, 'organizer');
      assert.equal(organizer.status, 'active');
      assert.deepEqual([organizer.directoryOptIn, organizer.meetingsOptIn, organizer.newsOptIn], [false, false, false]);
      assert.equal(organizer.consentAt ?? null, null);
      assert.equal(profile.isOrganizer, true);
      assert.equal(profile.role, 'organizer');
    });

    it('ne crée qu’un Attendee organisateur, quelle que soit la casse de l’adresse et le nombre de demandes', async () => {
      const { c } = await world();
      const { app, signIn } = espace();
      await signIn(c.slug, ORGANIZER_2);
      await signIn(c.slug, ORGANIZER_2.toUpperCase());
      const rows = await app.documents(UID.attendee).findMany({ filters: { email: ORGANIZER_2, edition: { documentId: c.documentId } } });
      assert.equal(rows.length, 1);
    });

    it('ne crée aucun organisateur dans une édition fermée', async () => {
      const { closed } = await world();
      const { app, outbox, mailsSince } = espace();
      const since = outbox().length;
      assert.equal((await askLink(closed.slug, ORGANIZER_3)).status, 202);
      assert.deepEqual(await mailsSince(since, { to: ORGANIZER_3 }), []);
      assert.equal(await findAttendee(app, closed, ORGANIZER_3), null);
    });

    it('un Attendee dont l’adresse est dans ORGANIZER_EMAILS est organisateur sans changer de rôle', async () => {
      const { app, signIn } = espace();
      const edition = await createEdition(app, { slug: 'edition-organisateur-inscrit', title: 'Édition organisateur inscrit' });
      await createAttendee(app, edition, { email: ORGANIZER_4, role: 'participant' });
      const { me: profile } = await signIn(edition.slug, ORGANIZER_4);
      assert.equal(profile.isOrganizer, true);
      assert.equal(profile.role, 'participant');
    });

    it('le rôle organizer d’un Attendee suffit, hors ORGANIZER_EMAILS', async () => {
      const { a } = await world();
      const boss = await person(a, { role: 'organizer', email: 'responsable.interne@example.org' });
      assert.equal(boss.me.isOrganizer, true);
    });

    it('un participant ordinaire n’est pas organisateur', async () => {
      const { a } = await world();
      const alice = await person(a);
      assert.equal(alice.me.isOrganizer, false);
    });

    it('routes admin : 403 FORBIDDEN pour un participant, 401 sans session, accès pour l’organisateur de l’édition', async () => {
      const { a } = await world();
      const { request, signIn } = espace();
      const url = `/api/espace/admin/${a.slug}/slots/regenerate`;
      const participant = await person(a);
      const denied = await request(url, { method: 'POST', cookie: participant.cookie });
      assert.equal(denied.status, 403);
      assert.equal(denied.json.error.code, 'FORBIDDEN');
      assert.equal((await request(url, { method: 'POST' })).status, 401);

      const organizer = await signIn(a.slug, ORGANIZER);
      const allowed = await request(url, { method: 'POST', cookie: organizer.cookie });
      assert.equal(allowed.status, 200);
    });

    it('cloisonnement : la session d’une autre édition ne donne accès à aucune route admin de celle-ci (NF-01)', async () => {
      const { a, c } = await world();
      const { request } = espace();
      const url = `/api/espace/admin/${a.slug}/slots/regenerate`;
      const participantOfC = await person(c);
      const organizerOfC = await person(c, { role: 'organizer', email: 'organisateur.c@example.org' });
      assert.equal((await request(url, { method: 'POST', cookie: participantOfC.cookie })).status, 403);
      const crossing = await request(url, { method: 'POST', cookie: organizerOfC.cookie });
      assert.equal(crossing.status, 403);
      assert.equal(crossing.json.error.code, 'FORBIDDEN');
    });
  });

  describe('NF-01 sur /me : accès croisés entre A, B (même édition) et C (autre édition), section 7 du plan', pending('lot 5'), () => {
    it('A ne voit que lui-même sur GET /me ; B et C voient le leur', async () => {
      const { a, c } = await world();
      const A = await person(a, { firstName: 'Anna', lastName: 'Alpha' });
      const B = await person(a, { firstName: 'Basile', lastName: 'Bravo' });
      const C = await person(c, { firstName: 'Camille', lastName: 'Charlie' });
      const [ra, rb, rc] = await Promise.all([me(A.cookie), me(B.cookie), me(C.cookie)]);
      assert.deepEqual([ra.json.id, rb.json.id, rc.json.id], [A.attendee.documentId, B.attendee.documentId, C.attendee.documentId]);
      assert.equal(ra.json.lastName, 'Alpha');
      assert.equal(rc.json.edition.slug, 'edition-c');
      assert.deepEqual(Object.keys(ra.json).sort(), ME_KEYS);
    });

    it('un paramètre ou un en-tête désignant B ne change pas la personne servie', async () => {
      const { a } = await world();
      const A = await person(a);
      const B = await person(a);
      const viaQuery = await me(A.cookie);
      const hijack = await espace().request(`/api/espace/me?id=${B.attendee.documentId}&documentId=${B.attendee.documentId}`, {
        cookie: A.cookie,
        headers: { 'x-attendee-id': B.attendee.documentId },
      });
      assert.equal(hijack.json.id, A.attendee.documentId);
      assert.equal(viaQuery.json.id, A.attendee.documentId);
    });

    it('PATCH /me modifie A seulement : id, email, role, edition et status du corps sont ignorés', async () => {
      const { a, c } = await world();
      const { app, request } = espace();
      const A = await person(a, { firstName: 'Anna', lastName: 'Alpha', jobTitle: 'Ancienne fonction' });
      const B = await person(a, { firstName: 'Basile', lastName: 'Bravo', jobTitle: 'Fonction de B' });
      const response = await request('/api/espace/me', {
        method: 'PATCH',
        cookie: A.cookie,
        json: {
          jobTitle: 'Nouvelle fonction',
          id: B.attendee.documentId,
          documentId: B.attendee.documentId,
          email: 'pirate@example.org',
          role: 'organizer',
          edition: c.documentId,
          status: 'cancelled',
          directoryOptIn: true,
          helloassoItemId: '1',
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.json.id, A.attendee.documentId);
      assert.equal(response.json.jobTitle, 'Nouvelle fonction');
      assert.equal(response.json.role, 'participant');
      assert.equal(response.json.isOrganizer, false);

      const storedA = await app.documents(UID.attendee).findOne({ documentId: A.attendee.documentId, populate: ['edition'] });
      assert.equal(storedA.email, A.attendee.email);
      assert.equal(storedA.role, 'participant');
      assert.equal(storedA.status, 'active');
      assert.equal(storedA.edition.documentId, a.documentId);
      assert.equal(storedA.directoryOptIn, false, 'les consentements ne passent que par PUT /me/consent');
      assert.equal(storedA.helloassoItemId, A.attendee.helloassoItemId);
      const storedB = await app.documents(UID.attendee).findOne({ documentId: B.attendee.documentId });
      assert.deepEqual([storedB.firstName, storedB.jobTitle, storedB.email], ['Basile', 'Fonction de B', B.attendee.email]);
    });

    it('PATCH /me accepte les quatre champs du profil et les renvoie dans Me', async () => {
      const { a } = await world();
      const A = await person(a);
      const response = await espace().request('/api/espace/me', {
        method: 'PATCH',
        cookie: A.cookie,
        json: { firstName: 'Anne', lastName: 'Alphonse', jobTitle: 'Cheffe de projet', company: 'Coopérative Fictive' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual([response.json.firstName, response.json.lastName, response.json.jobTitle, response.json.company], ['Anne', 'Alphonse', 'Cheffe de projet', 'Coopérative Fictive']);
      assert.deepEqual((await me(A.cookie)).json.firstName, 'Anne');
    });

    it('PATCH /me ajoute le champ importé modifié à editedFields et seulement lui (R-31)', async () => {
      const { a } = await world();
      const A = await person(a, { firstName: 'Anna', jobTitle: 'Ancienne fonction', company: 'Société' });
      await espace().request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { jobTitle: 'Fonction corrigée' } });
      const stored = await espace().app.documents(UID.attendee).findOne({ documentId: A.attendee.documentId });
      assert.ok(stored.editedFields.includes('jobTitle'));
      assert.ok(!stored.editedFields.includes('company') && !stored.editedFields.includes('firstName'));
    });

    it('PATCH /me : 400 VALIDATION avec error.fields quand le prénom, le nom ou l’entreprise manquent (F-30)', async () => {
      const { a } = await world();
      const { request } = espace();
      const A = await person(a);
      for (const field of ['firstName', 'lastName', 'company']) {
        const response = await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { [field]: '   ' } });
        assert.equal(response.status, 400, field);
        assert.equal(response.json.error.code, 'VALIDATION', field);
        assert.equal(typeof response.json.error.fields[field], 'string', `message du champ ${field}`);
      }
    });

    it('PATCH /me : l’entreprise manquante à l’import doit être saisie (F-30) ; la fonction peut rester vide', async () => {
      const { a } = await world();
      const { request } = espace();
      const A = await person(a, { company: null, jobTitle: null });
      const noCompany = await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { jobTitle: 'Consultante' } });
      assert.equal(noCompany.status, 400);
      assert.ok(noCompany.json.error.fields.company);
      const filled = await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { company: 'Cabinet Fictif' } });
      assert.equal(filled.status, 200);
    });

    it('PATCH /me : 400 VALIDATION au-delà de 100 caractères, 100 admis', async () => {
      const { a } = await world();
      const { request } = espace();
      const A = await person(a);
      const tooLong = await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { jobTitle: 'x'.repeat(101) } });
      assert.equal(tooLong.status, 400);
      assert.equal(tooLong.json.error.code, 'VALIDATION');
      assert.ok(tooLong.json.error.fields.jobTitle);
      assert.equal((await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { jobTitle: 'x'.repeat(100) } })).status, 200);
    });

    it('PATCH /me : un champ qui n’est pas un texte est refusé (400), jamais enregistré', async () => {
      const { a } = await world();
      const A = await person(a);
      for (const value of [42, true, { x: 1 }, ['a']]) {
        const response = await espace().request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { firstName: value } });
        assert.equal(response.status, 400, JSON.stringify(value));
      }
    });

    it('PATCH /me et PUT /me/consent exigent une session (401) puis un Origin admis (403)', async () => {
      const { request } = espace();
      for (const [method, path, json] of [['PATCH', '/api/espace/me', { firstName: 'X' }], ['PUT', '/api/espace/me/consent', { directoryOptIn: true, meetingsOptIn: true, newsOptIn: true }]]) {
        assert.equal((await request(path, { method, json })).status, 401, `${method} ${path}`);
        const noOrigin = await request(path, { method, json, origin: null });
        assert.equal(noOrigin.status, 403, `${method} ${path} sans Origin`);
        assert.equal(noOrigin.json.error.code, 'ORIGIN_REFUSED');
      }
    });

    it('PUT /me/consent enregistre les trois choix, horodate consentAt et renvoie Me', async () => {
      const { a } = await world();
      const { app, request } = espace();
      const A = await person(a, { consentAt: null });
      const t0 = Date.now();
      const response = await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: { directoryOptIn: true, meetingsOptIn: false, newsOptIn: true } });
      assert.equal(response.status, 200);
      assert.equal(response.json.id, A.attendee.documentId);
      assert.deepEqual({ ...response.json.consent, consentAt: undefined }, { directoryOptIn: true, meetingsOptIn: false, newsOptIn: true, consentAt: undefined });
      assert.ok(Math.abs(new Date(response.json.consent.consentAt).getTime() - t0) < 10_000, 'consentAt = maintenant');
      const stored = await app.documents(UID.attendee).findOne({ documentId: A.attendee.documentId });
      assert.deepEqual([stored.directoryOptIn, stored.meetingsOptIn, stored.newsOptIn], [true, false, true]);
      assert.ok(stored.consentAt);
    });

    it('PUT /me/consent est révocable : un nouveau choix remplace l’ancien et rafraîchit consentAt (R-40)', async () => {
      const { a } = await world();
      const { request } = espace();
      const A = await person(a);
      await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: { directoryOptIn: true, meetingsOptIn: true, newsOptIn: true } });
      await sleep(20);
      const second = await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: { directoryOptIn: false, meetingsOptIn: false, newsOptIn: false } });
      assert.deepEqual({ ...second.json.consent, consentAt: undefined }, { directoryOptIn: false, meetingsOptIn: false, newsOptIn: false, consentAt: undefined });
    });

    it('PUT /me/consent : 400 VALIDATION quand un des trois booléens manque ou n’en est pas un', async () => {
      const { a } = await world();
      const { request } = espace();
      const A = await person(a);
      for (const body of [{}, { directoryOptIn: true, meetingsOptIn: true }, { directoryOptIn: 'oui', meetingsOptIn: true, newsOptIn: true }, { directoryOptIn: 1, meetingsOptIn: 0, newsOptIn: 1 }, { directoryOptIn: null, meetingsOptIn: true, newsOptIn: true }]) {
        const response = await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: body });
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.json.error.code, 'VALIDATION', JSON.stringify(body));
      }
    });

    it('PUT /me/consent ne modifie que A, même avec l’identifiant de B dans le corps', async () => {
      const { a } = await world();
      const { app, request } = espace();
      const A = await person(a);
      const B = await person(a);
      await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: { id: B.attendee.documentId, directoryOptIn: true, meetingsOptIn: true, newsOptIn: true } });
      const storedB = await app.documents(UID.attendee).findOne({ documentId: B.attendee.documentId });
      assert.deepEqual([storedB.directoryOptIn, storedB.meetingsOptIn, storedB.newsOptIn], [false, false, false]);
    });

    it('aucune réponse ne contient d’e-mail, de jeton en clair, d’empreinte ni d’identifiant HelloAsso (minimisation)', async () => {
      const { a, c } = await world();
      const { request } = espace();
      const A = await person(a);
      const B = await person(a);
      const C = await person(c);
      const forbidden = [A, B, C].flatMap(({ attendee, token }) => [attendee.email, token, sha256(token), attendee.helloassoItemId, attendee.helloassoOrderId]);
      const responses = [
        await me(A.cookie),
        await request('/api/espace/me', { method: 'PATCH', cookie: A.cookie, json: { jobTitle: 'Poste' } }),
        await request('/api/espace/me/consent', { method: 'PUT', cookie: A.cookie, json: { directoryOptIn: true, meetingsOptIn: true, newsOptIn: true } }),
        await me(C.cookie),
      ];
      for (const response of responses) {
        for (const secret of forbidden) assert.ok(!response.text.includes(secret), `« ${secret} » dans une réponse : ${response.text}`);
        assert.ok(!/helloasso|tokenHash/i.test(response.text), response.text);
      }
    });
  });

  describe('NF-52 : gel de l’édition (participantSpaceEnabled)', pending('lot 5'), () => {
    const setEnabled = async (edition, enabled) => {
      const { app } = espace();
      await app.documents(UID.edition).update({ documentId: edition.documentId, data: { participantSpaceEnabled: enabled } });
      await app.documents(UID.edition).publish({ documentId: edition.documentId });
    };

    it('fermer l’édition coupe les sessions ouvertes (401), la rouvrir les rétablit', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-gel', title: 'Édition gel' });
      const alice = await person(edition);
      assert.equal((await me(alice.cookie)).status, 200);
      await setEnabled(edition, false);
      const frozen = await me(alice.cookie);
      assert.equal(frozen.status, 401);
      assert.equal(frozen.json.error.code, 'UNAUTHENTICATED');
      await setEnabled(edition, true);
      assert.equal((await me(alice.cookie)).status, 200);
    });

    it('un lien émis avant la fermeture est refusé (400 TOKEN_INVALID) une fois l’édition fermée', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-gel-lien', title: 'Édition gel lien' });
      const attendee = await createAttendee(app, edition);
      const token = await app.service('api::espace.tokens').issueLink(attendee.documentId, { ttlMinutes: 30, ip: '10.2.2.2', now: new Date() });
      await setEnabled(edition, false);
      const refused = await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token } });
      assert.equal(refused.status, 400);
      assert.equal(refused.json.error.code, 'TOKEN_INVALID');
      assert.equal((await sessionsOf(attendee)).length, 0);
    });

    it('une édition qui n’est plus publiée coupe aussi les sessions', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-depubliee', title: 'Édition dépubliée' });
      const alice = await person(edition);
      await app.documents(UID.edition).unpublish({ documentId: edition.documentId });
      assert.equal((await me(alice.cookie)).status, 401);
    });

    it('le gel ne touche pas l’API publique de l’édition ni le site', async () => {
      const { closed } = await world();
      assert.equal((await espace().request(`/api/espace/editions/${closed.slug}`)).status, 200);
      assert.equal((await espace().request('/api/espace/health')).status, 200);
    });
  });
});

describe('I-22 : cookie Secure quand PUBLIC_URL est en https (lot 5)', { timeout: 180_000 }, () => {
  const HTTPS = 'https://journees.example.org';
  const secure = useEspace({ overrides: { PUBLIC_URL: HTTPS, CORS_ORIGINS: HTTPS } });

  it('pose le cookie jib_espace avec l’attribut Secure et redirige vers une URL https', pending('lot 5'), async () => {
    const { app, request, waitForMail, linkOf, outbox } = secure();
    const edition = await createEdition(app, { slug: 'edition-https', title: 'Édition https' });
    const attendee = await createAttendee(app, edition);
    const proto = { 'x-forwarded-proto': 'https' };
    const since = outbox().length;
    assert.equal((await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: edition.slug, email: attendee.email }, headers: proto })).status, 202);
    const { token, url } = linkOf(await waitForMail((mail) => mail.to.email === attendee.email, { since }));
    assert.ok(url.startsWith(`${HTTPS}/espace/verifier?token=`), url);

    const verified = await request('/api/espace/auth/verify', { method: 'POST', form: { token }, headers: proto });
    assert.equal(verified.status, 303);
    assert.ok(verified.location.startsWith(`${HTTPS}/espace/`), verified.location);
    const cookie = verified.setCookies.map(parseSetCookie).find(({ name }) => name === SESSION_COOKIE);
    assert.ok(cookie, 'cookie absent');
    assert.equal(cookie.attributes.secure, true);
    assert.equal(cookie.attributes.httponly, true);
    assert.ok(cookieHeader(verified.setCookies).includes(SESSION_COOKIE));
  });
});
