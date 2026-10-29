# Phase 1 : plan d'exécution (données, import, accès)

Rédigé par l'architecte le 29 octobre 2026, pour la phase 1 prévue du 4 au 6 novembre (`09-phases.md`). La phase peut démarrer dès la porte locale de la phase 0, verte (`phase-0.md`). Les décisions A-15 à A-20 complètent celles de `phase-0-plan.md` et remplacent les points de A-03 et A-08 qu'elles citent. `02-modele-donnees.md` (A-15) et `06-api.md` (A-18, redirections) ont été mis à jour dans le même commit.

Principe directeur : le code le plus court qui satisfait les critères. Aucune dépendance nouvelle, ni côté Strapi ni côté front.

## 1. Périmètre

| Bloc | Exigences | Contenu |
|---|---|---|
| Modèle | `02`, A-02, A-03, A-15 | tous les types nouveaux de `02` sauf Notification (P2) ; champs privés de `edition` ; `sequence.kind` ; index `table_key` |
| Créneaux | R-01, R-02 | génération idempotente, route organisateur, appel par le seed |
| HelloAsso | I-10, I-11, I-12, I-14, Q-03, Q-15, NF-11, NF-13 | client, import, synchronisation (cron et route), SyncRun |
| Annulation | R-18, T-06 | Attendee `cancelled`, rendez-vous annulés et notifiés |
| Accès | I-20 à I-23, F-01 à F-04, NF-01, NF-02, NF-03 (demande de lien seulement), NF-04, Q-13 | lien magique, vérification, session, déconnexion, organisateurs, limitation de débit |
| Écrans | E0 (F-01 à F-04), E2 (F-10 à F-12), NF-07, NF-30, NF-31, Q-14 | connexion, vérification, consentement ; E1 provisoire (cible de redirection, déconnexion) |
| E-mails | I-30, I-31 | service d'envoi, gabarits `access-link` et `welcome`, plus `meeting-cancelled`, exigé par T-06 |
| Gel | NF-52 | `participantSpaceEnabled` coupe pages, sessions et envois de l'édition |
| Seed | `10-recette.md`, A-13 | tout ce que les types de la phase 1 permettent de charger (section 4.4) |

Hors phase 1 : I-13 (webhook, P1) et F-05 (bandeau PWA, P1), en phase 3 ; `/me` complet, E3, E1 complet et service des rendez-vous, en phase 2 ; tableau de bord E9, en phase 3.

## 2. Décisions complémentaires

### A-15. Le thème d'une séquence est porté par Topic

`02` prévoyait `sequence.topic`, une relation ajoutée à un type existant. Elle devient `Topic.sessions` (manyToMany vers `sequence`, unidirectionnelle). Ainsi, toute relation nouvelle part d'un type nouveau, et les types existants ne reçoivent que des champs scalaires : `edition` (9 champs privés) et `sequence.kind`. `strapi/mcp/content-types.json` ne reçoit que `sequence.kind`. L'organisateur rattache les séquences depuis la fiche du thème. Une séquence peut relever de plusieurs thèmes : le programme (phase 3) les affiche tous.

### A-16. Verrous transactionnels seulement ; synchronisation exclusive par SyncRun

Un verrou consultatif de session (`pg_try_advisory_lock`, A-08) n'est pas fiable derrière le pool de connexions de knex : le déverrouillage peut partir sur une autre connexion. Seuls des verrous `pg_advisory_xact_lock(hashtext(clé))` sont donc employés, à l'intérieur d'un `strapi.db.transaction` (requête brute avec `.transacting(trx)`).

- **Synchronisation** : sous le verrou `sync:{editionDocumentId}`, une transaction courte cherche un SyncRun de l'édition sans `endedAt` et commencé depuis moins de 15 minutes. S'il en existe un, la synchronisation répond `SYNC_RUNNING` ; sinon, elle crée le SyncRun. Les appels à HelloAsso se font hors transaction, et le SyncRun est clos à la fin. Un SyncRun resté ouvert après un arrêt brutal est ignoré au bout de 15 minutes.
- **Création d'Attendee** (synchronisation, organisateur) : sous le verrou `attendee:{editionDocumentId}`, avec une nouvelle vérification de l'unicité de l'e-mail et de `helloassoItemId`.
- **Créneaux** : régénération entière dans une transaction, sous le verrou `slots:{editionDocumentId}`.

### A-17. Synchronisation des éditions et e-mail `welcome`

- La tâche planifiée synchronise toute édition **publiée** dont `helloassoOrgSlug` et `helloassoFormSlug` sont renseignés, que l'espace soit ouvert ou non. La phase 5 en a besoin : première synchronisation et contrôle de 5 fiches avant l'ouverture.
- À la fin de chaque synchronisation d'une édition **ouverte** (`participantSpaceEnabled = true`), `welcome` part vers tout Attendee actif, hors rôle `organizer`, qui n'a pas encore d'EmailLog `welcome` au statut `sent`. Cette règle couvre à la fois le nouvel inscrit (I-12) et l'ouverture de l'espace (phase 5). Un envoi en échec est retenté à la synchronisation suivante.
- Le lien de `welcome` est un lien d'action de 72 heures (I-21), vers `/espace/{edition}/`.

### A-18. Vérification du lien en deux états, sans e-mail dans l'URL

`GET /api/espace/auth/link?token=…` renvoie l'état d'un lien sans le consommer. La page `/espace/verifier` l'appelle au rendu serveur :

- lien valable : bouton « Ouvrir mon espace » (Q-13) ;
- lien connu mais expiré ou utilisé : message F-04 et formulaire de demande prérempli avec l'adresse, que l'API ne renvoie que dans ce cas ;
- lien inconnu : message F-04 et formulaire vide, l'édition étant tirée de `next`.

Si `POST /auth/verify` échoue (lien consommé entre-temps), Strapi renvoie par 303 sur la même URL de vérification, qui affiche alors l'état invalide. Il n'y a ni page d'erreur séparée, ni adresse dans une URL.

### A-19. Horloge injectable, envoi du lien non attendu

- Les fonctions de `lib/` et les services prennent `now` en paramètre (défaut : l'heure courante). Les tests ne dépendent pas de la date réelle, ce qui neutralise la fenêtre figée du seed.
- `request-link` répond sans attendre l'envoi de l'e-mail (promesse détachée, erreur journalisée). Le temps de réponse ne distingue donc pas une adresse connue d'une adresse inconnue (F-02). Les tests attendent la ligne dans la boîte de sortie.

### A-20. Fichiers séparés pour travailler en parallèle

- Routes : `routes/espace.js` (santé, édition, créneaux), `routes/sync.js` et `routes/auth.js`. Strapi charge tous les fichiers du dossier.
- Gabarits : un fichier par gabarit, `lib/mail/templates/<nom>.js`, chargé par son nom par `lib/mail/render.js`, sans registre commun.
- Socle partagé, livré par le lot 2 : `lib/errors.js`, `lib/guards.js`, `lib/tokens.js`, `services/tokens.js`, `services/mailer.js`.
- Les tables des types nouveaux s'appellent `espace_<pluriel>` (`collectionName`).

## 3. Modèle

**Piège (mémoire projet).** Changer le type d'une relation existante, par exemple de manyToOne en manyToMany, fait recréer par Strapi la table de liaison, vide, au démarrage qui suit le déploiement. La prod étant éditée directement dans le back-office, les liens saisis seraient perdus, et seule la sauvegarde permettrait de les retrouver. Règles :

1. Aucune définition de relation d'un type existant n'est modifiée (`edition`, `sequence`, `intervention`, `intervenant`, `organisation`, `partenaire`, `tag`, `home-page`, `static-page`).
2. Les types existants ne reçoivent que des champs scalaires : 9 champs `private: true` sur `edition` et `kind` sur `sequence`.
3. Toute relation nouvelle est déclarée sur un type nouveau `api::espace.*`, unidirectionnelle quand elle vise un type existant.
4. Si un changement de relation existante devenait un jour inévitable, il faudrait une décision de l'architecte, un relevé des liens avant le déploiement et une nouvelle liaison après.

Preuves :

- **Test de garde (tester)** : liste figée des relations des types existants ; il échoue si une relation change.
- **Relevé sur la copie de prod (developer, lot 2)** : compte des lignes des tables de liaison de `strapi_espace` avant et après le premier démarrage avec les nouveaux schémas.
- **Test de republication (tester)** : republier une édition, une séquence, un intervenant et une organisation ne détache ni Slot, ni Topic, ni Attendee, ni Exhibitor.

| Type nouveau | Relations (toutes portées par ce type) |
|---|---|
| topic | `edition` → edition ; `sessions` → sequence (manyToMany) |
| slot | `edition` → edition ; `session` → sequence |
| attendee | `edition` → edition ; `speaker` → intervenant ; `exhibitor` ↔ exhibitor (`inversedBy: representatives`) ; `topics` → topic (manyToMany) ; `photo` (média) |
| exhibitor | `edition` → edition ; `organisation` → organisation ; `representatives` (`mappedBy: exhibitor`) ; `topics` → topic (manyToMany) |
| meeting | `edition`, `slot`, `requester`, `targetAttendee`, `targetExhibitor`, `answeredBy` ; champ `tableKey` |
| conversation, message | selon `02` ; créés maintenant, utilisés en phase 3 |
| magic-token | `attendee` ; `kind` (`link`, `session`), `tokenHash` (unique), `expiresAt`, `usedAt`, `ip` |
| email-log | `attendee` ; `template`, `scenarioKey`, `sentAt`, `providerMessageId`, `status` (`sent`, `failed`) |
| sync-run | `edition` ; `startedAt`, `endedAt`, `created`, `updated`, `cancelled`, `errors` (json) |

Champs, valeurs par défaut et règles : `02-modele-donnees.md`. L'index unique `espace_meetings_table_key_uq` est créé au démarrage par `services/schema.js` (`CREATE UNIQUE INDEX IF NOT EXISTS`), appelé depuis le bootstrap.

## 4. Contrats

Le lot de tests d'abord est écrit à partir de ces contrats. Un écart découvert pendant l'implémentation remonte à l'architecte, qui corrige ce plan.

### 4.1 Modules purs de `strapi/src/api/espace/lib/`

| Module | Lot | Exports |
|---|---|---|
| `errors.js` | 2 | `EspaceError(status, code, message, extra?)` ; le middleware le convertit en `{ error: { code, message, ...extra } }` |
| `guards.js` | 2 | `requireSession(ctx)` → `ctx.state.espace` ou 401 `UNAUTHENTICATED` ; `requireOrganizer(ctx, editionSlug)` → 403 `FORBIDDEN` si `isOrganizer` est faux ou si l'édition diffère |
| `time.js` | 2 | `parseProgramTime(text)` → `{ hours, minutes }` ou `null`. Formes admises : `9h15`, `10h45`, `9h` ; tout le reste, `--` compris, donne `null`. `zonedToUtc(dateIso, { hours, minutes }, timeZone = 'Europe/Paris')` → `Date`. Heure inexistante : avancée de la durée du saut ; heure ambiguë : premier instant. `formatTimeLabel(date, timeZone = 'Europe/Paris')` → `9h45`, `13h00` |
| `slots.js` | 2 | `computeSlots({ date, durationMinutes, sessions, timeZone })` → `{ slots: [{ sessionDocumentId, startsAt, endsAt, label }], warnings: [{ sessionDocumentId, title, code }] }`. Seules les séquences `kind = b2b_break` comptent ; le dernier créneau finit au plus tard à `end` (R-01). Codes : `MISSING_END`, `INVALID_TIME`, `TOO_SHORT`, `OVERLAP`. `planSlots({ wanted, existing })` → `{ create, keep, remove, orphans }`. Clé : `startsAt`, `endsAt`, `sessionDocumentId`. Un créneau existant hors clé qui a des rendez-vous `pending` ou `accepted` va dans `orphans`, jamais dans `remove` (R-02) |
| `tokens.js` | 2 | `generateToken()` → 32 octets en base64url (43 caractères) ; `hashToken(token)` → SHA-256 en hexadécimal ; `linkUrl({ publicUrl, token, next })` → `{publicUrl}/espace/verifier?token=…&next=…` |
| `import.js` | 4 | `normalizeEmail(value)` → adresse en minuscules, sans espaces autour, ou `null` si invalide. `mapItem(item, fieldMap)` → `{ helloassoItemId, helloassoOrderId, firstName, lastName, email, jobTitle, company, proposedRole, decision, reason }`. `decision` : `active`, `cancelled` ou `ignored` (Q-15). Nom et prénom : `user`. E-mail : champ `fieldMap.email` s'il est valide, sinon `payer.email`. Rôle proposé : `exhibitor_rep` si le tarif contient « Exposant », `speaker` s'il contient « Intervenant ». `planSync({ items, attendees, fieldMap })` → `{ create, update: [{ documentId, changes }], cancel: [documentId], errors: [{ itemId, code, email?, attendeeDocumentId? }] }`. Billets traités par `id` croissant. Champs de `editedFields` jamais écrasés (R-31). `role`, rattachements et consentements jamais touchés. Billet annulé inconnu : ignoré sans erreur. Billet redevenu actif : `status: 'active'`. Codes : `DUPLICATE_EMAIL` (I-14), `INVALID_EMAIL`, `WAITING`, `UNKNOWN`, `EMAIL_TAKEN` |
| `helloasso.js` | 4 | `createHelloAssoClient({ apiBase, clientId, clientSecret, fetch, now })` → `{ listFormItems({ organizationSlug, formType, formSlug }), getOrder(orderId) }`. Jeton demandé sur `{origine de apiBase}/oauth2/token` (`client_credentials`), gardé jusqu'à `expires_in - 60` s (I-10). Une réponse 401 provoque un renouvellement et un seul nouvel essai. Requêtes `withDetails=true`, `pageSize=100`, `continuationToken` jusqu'à `data: []`, 50 pages au plus. Erreur : `HelloAssoError { status }`, sans secret ni jeton dans le message |
| `session.js` | 5 | `safeNextPath(next, editionSlug)` → `next` s'il commence par `/espace/{editionSlug}/` et ne contient ni `//`, ni `\`, ni `..`, ni schéma ; sinon `/espace/{editionSlug}/`. `sessionCookieOptions({ publicUrl, maxAgeMs })` → `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `signed`, `overwrite`, `secure` si `publicUrl` est en https |
| `rate-limit.js` | 5 | `createRateLimiter({ max = 5, windowMs = 900000, now })` → `{ hit(key) → boolean, reset() }`, fenêtre glissante. L'instance est créée par le service d'authentification, jamais au niveau du module : un Strapi redémarré par les tests repart à zéro |
| `mail/layout.js`, `mail/render.js` | 2 | `escapeHtml`. `renderEmail(name, data)` → `{ subject, html, text }` : le nom est contrôlé par `^[a-z-]+$`, `templates/<name>.js` est chargé, puis le HTML est enveloppé du gabarit commun : 600 px, en-tête couleur d'édition, `{publicUrl}/assets/logo-jib-blanc.png`, pied Xylofutur et lien « Gérer mes notifications » vers `/espace/{slug}/profil` |
| `mail/templates/access-link.js` | 5 | données `{ edition: { slug, title, themeColor }, publicUrl, firstName, url, validityMinutes }` |
| `mail/templates/welcome.js` | 4 | `{ edition, publicUrl, firstName, url, validityHours }` |
| `mail/templates/meeting-cancelled.js` | 4 | `{ edition, publicUrl, firstName, slotLabel, counterpartName, reason, agendaUrl }` |

Services partagés du lot 2 :

- `services/mailer.js` : `send({ attendee, template, data, scenarioKey })` → `{ status, messageId }`. Il rend le gabarit, appelle le fournisseur de la phase 0 (créé une fois, d'après `server.email`), écrit l'EmailLog et ne lève jamais d'erreur sur un échec d'envoi (statut `failed`, journal).
- `services/tokens.js` : `issueLink(attendeeDocumentId, { ttlMinutes, ip, now })` → jeton en clair. Seule l'empreinte est stockée.
- `services/editions.js` : `findPublished(slug)`, champs privés compris.

### 4.2 API de la phase 1

Base `/api/espace`. Formats et codes d'erreur : `06-api.md`. Toute écriture exige un `Origin` présent dans `CORS_ORIGINS` (403 `ORIGIN_REFUSED`). En mode formulaire, toutes les redirections 303 sont absolues, construites sur `PUBLIC_URL`.

| Méthode | Chemin | Accès | Lot | Réponse |
|---|---|---|---|---|
| GET | `/health` | public | 0 | inchangé |
| GET | `/editions/:slug` | public | 2 | `{ slug, title, date, city, venue: { name, address } ou null, themeColor, participantSpaceEnabled, meetingRequestsOpenAt, meetingRequestsCloseAt }` ; 404 `EDITION_NOT_FOUND` si l'édition est absente ou non publiée |
| POST | `/admin/:edition/slots/regenerate` | organisateur | 2 | `{ created, kept, removed, orphans: [{ id, label, activeMeetings }], warnings }` |
| POST | `/admin/:edition/sync` | organisateur | 4 | SyncRun `{ id, startedAt, endedAt, created, updated, cancelled, errors }` ; 409 `SYNC_RUNNING` |
| GET | `/admin/:edition/sync-runs` | organisateur | 4 | les 10 derniers SyncRun, du plus récent au plus ancien |
| POST | `/auth/request-link` | public | 5 | JSON : 202 `{ "status": "accepted" }`, 400 `EMAIL_INVALID` (format), 429 `RATE_LIMITED` (« Trop de demandes, réessayez dans quelques minutes. »). Formulaire : 303 vers `/espace/{slug}/connexion?envoye=1`, `?erreur=trop` ou `?erreur=email` |
| GET | `/auth/link?token=` | public | 5 | A-18 ; toujours 200 |
| POST | `/auth/verify` | public | 5 | JSON `{ token, next? }` : 200 `{ me, redirect }` avec le cookie, ou 400 `TOKEN_INVALID`. Formulaire : 303 vers `/espace/{slug}/bienvenue` si `consentAt` est vide, sinon vers `safeNextPath(next)` ; en cas d'échec, 303 vers `/espace/verifier?token=…&next=…` |
| POST | `/auth/logout` | session | 5 | 204 ; formulaire (champ caché `editionSlug`) : 303 vers `/espace/{slug}/connexion?deconnecte=1` ; même réponse sans session |
| GET | `/me` | session | 5 | `Me` ; 401 `UNAUTHENTICATED` |
| PATCH | `/me` | session | 5 | `{ firstName?, lastName?, jobTitle?, company? }` → `Me`. Tout autre champ est ignoré. 400 `VALIDATION`, avec `error.fields` ({ champ: message }), si le profil qui en résulte n'a pas de prénom, de nom ou d'entreprise (F-30 ; l'entreprise peut manquer à l'import) ou si un champ dépasse 100 caractères. Un champ importé modifié s'ajoute à `editedFields` (R-31) |
| PUT | `/me/consent` | session | 5 | `{ directoryOptIn, meetingsOptIn, newsOptIn }`, trois booléens obligatoires → `Me`, `consentAt` = maintenant ; 400 `VALIDATION` |

`Me` en phase 1 : `{ id, firstName, lastName, jobTitle, company, role, isOrganizer, edition: { slug, title }, consent: { directoryOptIn, meetingsOptIn, newsOptIn, consentAt } }`. Ni e-mail, ni identifiants HelloAsso. `id` est le `documentId`. La phase 2 complète cet objet.

Règles d'accès communes :

- **Session valable** : MagicToken `session` trouvé par empreinte et non expiré, Attendee `active`, édition publiée avec `participantSpaceEnabled = true`. Sinon, 401. `ctx.state.espace = { attendee, edition, session, isOrganizer }`. `isOrganizer` vaut `role = organizer` ou e-mail présent dans `ORGANIZER_EMAILS`. L'échéance est prolongée de 30 jours au plus une fois par jour, cookie compris.
- **Vérification** : la consommation est atomique (`strapi.db.query(…).updateMany` conditionné par `usedAt: null` et `expiresAt > now` ; on poursuit seulement si une ligne a changé), seule exception admise au Document Service. Effets : création du MagicToken `session` (30 jours, IP) ; `activatedAt` s'il est vide ; `lastSeenAt`. Cookie `jib_espace` signé (A-04).
- **Demande de lien** : le compteur par e-mail normalisé et par IP s'incrémente avant toute recherche, que l'adresse soit connue ou non. Cas :
  - édition fermée ou inconnue : 202, aucun envoi ;
  - Attendee actif : lien de 30 minutes et `access-link` ;
  - adresse de `ORGANIZER_EMAILS` sans Attendee : création d'un Attendee `organizer` (A-04, sous verrou A-16), puis même parcours ;
  - adresse inconnue : rien.

### 4.3 Configuration

- `strapi/config/server.js` :
  - `proxy` selon A-04, à vérifier contre la doc Strapi 5 (`server.proxy`) ;
  - `cron: { enabled: env.bool('CRON_ENABLED', false), tasks: require('./cron-tasks') }` ;
  - `espace: { publicUrl: env('PUBLIC_URL', 'http://localhost:4321'), organizerEmails: env.array('ORGANIZER_EMAILS', []), corsOrigins: env.array('CORS_ORIGINS', ['http://localhost:4321']) }` ;
  - `helloasso: { apiBase, clientId, clientSecret }` (`HELLOASSO_*`, vides par défaut ; une synchronisation sans réglage écrit un SyncRun d'erreur `HELLOASSO_NOT_CONFIGURED`) ;
  - la section `email` et le correctif D2 sont conservés.
- `strapi/config/middlewares.js` : devient une fonction de `{ env }`. `strapi::cors` y reçoit `origin: env.array('CORS_ORIGINS', ['http://localhost:4321'])` et `credentials: true` (A-05).
- `strapi/config/cron-tasks.js` (tz `Europe/Paris`) :
  - synchronisation `*/15 * * * *` des éditions d'A-17 ;
  - purge `0 4 * * *` des MagicToken expirés.

  Aucune logique dans le cron. Une erreur est journalisée et ne fait jamais tomber Strapi.
- `strapi/.env.example` : `PUBLIC_URL`, `ORGANIZER_EMAILS`, `CORS_ORIGINS`, `IS_PROXIED`, `CRON_ENABLED`, `HELLOASSO_API_BASE=http://localhost:4010/v5`, `HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET`, avec des valeurs fictives.
- Déploiement :
  - mêmes variables dans `infra/deploy/base/docker-compose.base.yml` (`strapi.environment`) et dans `infra/deploy/overlays/dev/.env.dev` et `infra/deploy/overlays/prod/.env.prod` (`IS_PROXIED=true`, `CRON_ENABLED=true`) ;
  - `HELLOASSO_CLIENT_SECRET=${{ secrets.SECRET_HELLOASSO_CLIENT_SECRET }}` ajouté au fichier `.env.secrets` qu'écrit `deploy.yml`. Mathieu crée ce secret GitHub avant le premier déploiement ;
  - aucun déploiement, aucune image.

### 4.4 Seed de la phase 1

Le seed garde sa forme (une commande, idempotent, bases `_e2e` et `_test` seulement). Il efface d'abord les données `espace_*` de l'édition de recette, puis charge :

1. les réglages `editionSettings` sur l'édition, publiée ;
2. les 5 Topic ;
3. le `kind` des 9 séquences, rétabli, et les séquences rattachées à leur Topic par `Topic.sessions` d'après `sequences[].topic` ;
4. les 2 Exhibitor (stands 4 et 12, organisations `test-sylvadour` et `test-resineo`, sujets) ;
5. les 10 créneaux, par le service de génération : 10h45, 11h00 ; 12h30 à 13h45 ; 15h30, 15h45 ;
6. au lot 4, les 17 Attendee :
   - `mapItem` appliqué aux 17 billets de `helloasso-items.json`, y compris le billet `Canceled` de Lucas Darrigade : le seed n'applique pas les décisions de Q-15 ;
   - puis les réglages de `attendees` (rôle, rattachement à l'intervenant ou à l'exposant, statut, consentements, sujets) ;
   - horodatages `activatedAt` et `consentAt` fixes, égaux à `meetingRequestsOpenAt`, pour les personnes `activated: true` ;
   - un EmailLog `welcome` (`sent`) par Attendee, pour qu'une synchronisation ultérieure ne renvoie rien.

Le seed n'appelle pas la synchronisation : ni réseau, ni verrou, ni envoi. L'organisateur `organisation@example.org` n'est pas créé : il se connecte par `ORGANIZER_EMAILS` (Q-17). Le résumé final rappelle cette variable.

Conséquence vérifiable : sur une base fraîchement seedée, une synchronisation contre le faux HelloAsso, avec son jeu par défaut, donne 0 création, 0 mise à jour, 0 annulation et 0 erreur.

## 5. Lots

| Ordre | Lot | Agent | Démarre après | En parallèle de |
|---|---|---|---|---|
| 0 | correctif D1, D2, garde du seed exportée | developer | en cours | |
| 1 | clôture de la phase 0 | tester | 0 | lot 2 |
| 2 | modèle, socle, créneaux | developer | 0 | lots 1 et 3 |
| 3 | tests d'abord | tester | 1 | lots 2 à 6 (fichiers tous sous `strapi/tests/`) |
| 4 | HelloAsso, synchronisation, annulation, `welcome` | developer | 2 | lot 3 ; lot 5 s'il y a une seconde instance developer |
| 5 | accès | developer | 2, ou 4 avec une seule instance developer | lot 3 ; lot 4 s'il y a une seconde instance |
| 6 | écrans E0, vérification, E2, E1 provisoire | developer | 5, et réponses du designer validées par Mathieu | lot 3 |
| 7 | vérification et porte | tester | 6 | |

- Les lots 4 et 5 ne partagent aucun fichier (A-20). Avec une seule instance developer, ils s'enchaînent : 4, puis 5.
- Chaque lot developer est relu par l'architecte, puis vérifié par le tester, qui active les tests d'abord correspondants. Un échec repart au developer, et la vérification est relancée.

Commandes et environnement : `docs/espace/CLAUDE.md`. Pour les essais manuels des lots 2 à 6, Strapi tourne sur `strapi_e2e`, jamais sur `strapi` ; une seule ligne, variables en préfixe :

`DATABASE_NAME=strapi_e2e DEMO_SEED=false ORGANIZER_EMAILS=organisation@example.org HELLOASSO_API_BASE=http://localhost:4010/v5 HELLOASSO_CLIENT_ID=fake HELLOASSO_CLIENT_SECRET=fake corepack pnpm@12.15.0 --dir <dépôt>/strapi develop`

Fournisseur `console` par défaut, sans `NODE_ENV=production` : les e-mails arrivent dans `strapi/.tmp/mail-outbox.jsonl`.

### Fichiers partagés : qui les modifie

| Fichier | Propriétaire | Règle |
|---|---|---|
| `strapi/package.json`, `strapi/pnpm-lock.yaml`, `strapi/pnpm-workspace.yaml` | personne | aucune dépendance, aucun script nouveau en phase 1 |
| `web/package.json`, `web/pnpm-lock.yaml`, `web/pnpm-workspace.yaml` | tester, lot 7 seulement | uniquement si le tester ajoute `@axe-core/playwright` (devDependency, facultatif) |
| `strapi/config/server.js`, `middlewares.js` | lot 2 | après le correctif D2 en cours |
| `strapi/config/cron-tasks.js` | créé vide par le lot 2, rempli par le lot 4 | |
| `strapi/scripts/espace/seed.js` | lot 2, puis lot 4 | dans cet ordre |
| `strapi/scripts/espace/fake-helloasso.js`, `fixtures/*` | personne | sauf défaut signalé à l'architecte |
| `strapi/src/api/espace/middlewares/context.js` | lot 2 (étapes 1 et 2 de A-02), puis lot 5 (étape 3, chargement de la session) | |
| `strapi/src/index.js` | lot 2 | une ligne : appel de `services/schema.js` au bootstrap |
| `strapi/mcp/content-types.json` | lot 2 | `sequence.kind` seulement |
| `docs/espace/specs/06-api.md` | developer du lot concerné | s'il ajuste un chemin, dans le même commit |
| `web/astro.config.mjs` | lot 6 | filtre du sitemap seulement |
| `strapi/tests/**`, `web/tests/**`, `web/playwright.config.ts`, `.github/workflows/tests.yml`, `strapi/tests/SPEC.md` | tester | |

Personne ne committe `web/.astro/`, `.claude/launch.json`, `strapi/.strapi-updater.json` ni `.vscode/`. Les commits nomment leurs fichiers (`git commit -m "…" -- <fichiers>`).

### Lot 1 (tester) : clôture de la phase 0

Préalable : le correctif du developer (D1, D2, garde exportée) est committé.

Fichiers : `strapi/tests/**`, `web/tests/e2e/**`, `web/playwright.config.ts`, `strapi/tests/SPEC.md`.

1. Retirer les marqueurs `todo` de D1 et D2 ; les deux tests passent.
2. `unit/seed-guard.test.js` teste la garde exportée, au lieu de lire le motif dans le source. Le refus en sous-processus est conservé.
3. Ports e2e par défaut : 1348 et 4332 dans `web/playwright.config.ts`, `strapi/tests/e2e-server.js` et `web/tests/e2e/fixtures.ts`, commentaires et `SPEC.md` compris. Vérifier qu'ils sont libres (`lsof -nP -iTCP:1348 -sTCP:LISTEN`, idem 4332).

Critères d'acceptation :

1. `strapi test` sort en code 0 avec 0 `todo`.
2. `test:e2e` passe sans variable de port sur ce poste.
3. Une exécution de la suite ne modifie plus `strapi/.strapi-updater.json` (contenu identique avant et après).
4. Compte rendu avec commandes et durées.

### Lot 2 (developer) : modèle, socle, créneaux

Exigences : `02`, A-02, A-03, A-05, A-15, A-16, A-20, R-01, R-02, NF-04, NF-06, NF-50, NF-52, I-30 (service d'envoi), `10-recette.md`.

Fichiers dont le developer est propriétaire :

- `strapi/src/api/espace/content-types/{topic,slot,attendee,exhibitor,meeting,conversation,message,magic-token,email-log,sync-run}/schema.json`
- `strapi/src/api/edition/content-types/edition/schema.json` (9 champs scalaires privés seulement), `strapi/src/api/sequence/content-types/sequence/schema.json` (`kind` seulement), `strapi/mcp/content-types.json`
- `strapi/src/api/espace/middlewares/context.js`, `lib/{errors,guards,time,slots,tokens}.js`, `lib/mail/{layout,render}.js`
- `strapi/src/api/espace/services/{editions,slots,tokens,mailer,schema}.js`, `controllers/{editions,slots}.js`, `routes/espace.js`
- `strapi/src/index.js` (une ligne), `strapi/config/{server,middlewares,cron-tasks}.js`, `strapi/.env.example`
- `infra/deploy/base/docker-compose.base.yml`, `infra/deploy/overlays/dev/.env.dev`, `infra/deploy/overlays/prod/.env.prod`, `.github/workflows/deploy.yml` (une ligne dans `.env.secrets`)
- `strapi/scripts/espace/seed.js` (points 1 à 5 de la section 4.4)

Interdits : `web/`, les fichiers de test, `package.json` et lockfiles, toute définition de relation d'un type existant, `contact`, `newsletter`, `fake-helloasso.js`.

Critères d'acceptation :

1. **Tables de liaison** : avant le premier démarrage sur `strapi_espace` avec les nouveaux schémas, relever le nombre de lignes de chaque table de liaison existante (relations `_lnk`, médias `_mph`, composants `_cmps`), puis le relever de nouveau après le démarrage. Les nombres des tables existantes sont identiques ; les deux relevés figurent dans le compte rendu. Commande d'une ligne, vérifiée le 29 octobre, qui ne lit que des comptes : `docker exec jib-postgres psql -U strapi -d strapi_espace -Atc "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and (table_name like '%lnk' or table_name like '%mph' or table_name like '%cmps') order by 1"`. Relevé de référence de l'architecte, le 29 octobre, avant tout schéma de la phase 1, pour les tables de contenu :

   | Table | Lignes |
   |---|---|
   | `editions_cmps` | 10 |
   | `editions_partenaires_lnk` | 70 |
   | `files_related_mph` | 221 |
   | `home_pages_cmps` | 6 |
   | `intervenants_organisation_lnk` | 68 |
   | `intervenants_tags_lnk` | 38 |
   | `interventions_intervenants_lnk` | 80 |
   | `interventions_sequence_lnk` | 78 |
   | `organisations_tags_lnk` | 127 |
   | `partenaires_organisation_lnk` | 62 |
   | `sequences_edition_lnk` | 90 |
   | `sequences_organisations_lnk` | 60 |
   | `sequences_tags_lnk` | 74 |
2. **Routes** : `strapi routes:list` ne montre sous `/api/espace` que les routes de la section 4.2 livrées par ce lot, et aucune route CRUD.
3. **API publique** : `/api/editions` n'expose aucun champ ajouté à `edition` ; `/api/sequences` expose `kind`.
4. **Créneaux** : sur l'édition de recette, la régénération (service ou route) donne 10 créneaux aux libellés de R-01. Un second passage donne 0 création et 0 suppression. Une pause sans fin produit l'avertissement `MISSING_END`.
5. **Seed** : deux exécutions sur `strapi_e2e` donnent les mêmes comptes (5 Topic, 9 séquences dont 3 `b2b_break`, 2 Exhibitor, 10 Slot).
6. **Erreurs** : une écriture sous `/api/espace` sans `Origin` admis reçoit 403 `ORIGIN_REFUSED`. Une erreur inattendue donne 500 `{ error: { code: 'INTERNAL', message, requestId } }` et une ligne de journal structurée.
7. **CORS** : préflight accepté pour `http://localhost:4321` avec `credentials`, refusé pour toute autre origine. Le formulaire de contact du site fonctionne toujours en local.
8. **Index** : `espace_meetings_table_key_uq` existe après un démarrage et après un redémarrage.
9. **Socle e-mail** : `mailer.send` avec un gabarit d'essai écrit une ligne dans la boîte de sortie et un EmailLog.
10. **Règles communes** : aucune dépendance, `web/` intact, aucun tiret cadratin, textes en français, identifiants en anglais, `.env.example` sans secret, commandes et résultats dans le compte rendu.

### Lot 3 (tester) : tests d'abord

Exigences : T-01 à T-06, R-01, R-02, I-10 à I-12, I-14, I-20 à I-23, NF-01 à NF-04, NF-11, NF-52, Q-03, Q-15, A-15 à A-19.

Fichiers : `strapi/tests/**`, `strapi/tests/SPEC.md`. Écrits à partir des specs et de la section 4, sans attendre le code.

- **Harnais** :
  - `buildTestEnv` reçoit `PUBLIC_URL`, `CORS_ORIGINS`, `ORGANIZER_EMAILS=organisation@example.org`, des `HELLOASSO_*` pointés sur un faux démarré en module, et `IS_PROXIED=true`, pour que chaque test choisisse son IP par `X-Forwarded-For` (limitation de débit) ;
  - assistants : lecture de la boîte de sortie avec attente, connexion d'un Attendee (demande, lien, vérification, cookie), requête avec `Origin`.
- **Garde-fous** :
  - le test « seule route GET /health » devient « toute route sous `/api/espace` figure dans la section 4.2, aucune route CRUD » ; il reste vrai à chaque lot ;
  - test de garde des relations des types existants (section 3) ;
  - `conventions.test.js` étendu aux dossiers de l'espace créés en phase 1, côté Strapi et côté web.
- **Unitaires** : chaque module de la section 4.1 :
  - `time.js` : formes du programme, `--`, changements d'heure ;
  - `slots.js` : exemple de R-01, cas de R-02 ;
  - `import.js` : Q-03 par tarif, Q-15 état par état, I-14, adresses invalides ou en majuscules, NF-11 (aucun téléphone ni code postal dans le résultat) ;
  - client HelloAsso contre le faux : cache, expiration, 401 puis nouvel essai, plus de 100 billets avec `buildEdgeCaseItems({ padding: 120 })` ;
  - `safeNextPath` face aux redirections ouvertes (`https://…`, `//…`, `/\…`, `..`, autre édition) ;
  - limiteur de débit ;
  - gabarits : lien présent en HTML et en texte, échappement d'un nom contenant `<script>`, couleur d'édition, aucun tiret cadratin.
- **Intégration** :
  - T-01 à T-06 ; I-12 (création, mise à jour hors `editedFields`, annulation, réactivation) ; A-16 (deux synchronisations simultanées : une réussit, l'autre reçoit 409) ; A-17 (`welcome` une seule fois, rien si l'édition est fermée, rien pour un organisateur) ;
  - I-20 (aucun jeton en clair en base) et I-21 (72 heures) ;
  - I-22 (attributs du cookie, glissement, déconnexion puis réemploi refusé) et I-23 (création de l'organisateur, 403 pour un participant sur les routes `admin`) ;
  - NF-01 (section 7) et NF-04 ;
  - NF-52 : édition fermée, donc 202 sans envoi, session refusée, lien refusé ;
  - deux vérifications simultanées du même lien ne donnent qu'une session ;
  - test de republication (section 3) ; index après redémarrage.
- **Mécanisme** : tant que le code n'est pas livré, chaque test d'abord porte `todo` et requiert ses modules à l'intérieur du test. La suite reste en code 0, et chaque test échoue pour la bonne raison : module absent, route en 404. À chaque lot livré, le tester active le groupe correspondant et rapporte les échecs à l'architecte, avec leur reproduction ; il ne corrige pas le code applicatif.

Critères d'acceptation :

1. Suite en code 0 à tout moment.
2. `SPEC.md` liste chaque test d'abord avec son identifiant d'exigence et son lot d'activation.
3. Aucun fichier modifié hors des tests.

### Lot 4 (developer) : HelloAsso, synchronisation, annulation, `welcome`

Exigences : I-10, I-11, I-12, I-14, Q-03, Q-15, NF-11, NF-13, R-18, R-31 (côté synchronisation), A-08 (tâches), A-16, A-17, T-05, T-06.

Fichiers : `lib/{import,helloasso}.js`, `services/{sync,meetings}.js`, `controllers/sync.js`, `routes/sync.js`, `lib/mail/templates/{welcome,meeting-cancelled}.js`, `strapi/config/cron-tasks.js`, `strapi/scripts/espace/seed.js` (point 6 de la section 4.4).

- `services/sync.js` : `run(editionDocumentId, { now })`. Il réserve la synchronisation (A-16), lit les réglages de l'édition publiée, appelle `listFormItems`, puis `planSync`. Il applique ensuite les créations (sous verrou A-16), les mises à jour et les annulations, envoie `welcome` (A-17) et clôt le SyncRun. Une erreur d'appel à HelloAsso n'interrompt rien : SyncRun clos avec `{ code: 'FETCH_FAILED', status }` dans `errors`.
- `services/meetings.js` : `cancelForAttendee(attendee, { reason, now })`, première fonction du service des rendez-vous, que la phase 2 complétera.
  - Elle passe à `cancelled` les rendez-vous `pending` et `accepted` où l'Attendee est demandeur ou cible personnelle, avec `cancelledAt`, `cancelReason` (« Inscription annulée ») et `tableKey` remis à `null`.
  - Elle envoie `meeting-cancelled` à l'autre partie : la cible personnelle, les représentants actifs de l'exposant ciblé, ou le demandeur.
  - Les rendez-vous qui visent l'exposant dont il est représentant restent en place (R-14).

Critères d'acceptation :

1. Sur `strapi_e2e` fraîchement seedée, faux HelloAsso lancé par `helloasso:fake`, une synchronisation donne 0, 0, 0 et aucune erreur (section 4.4).
2. Sur une édition sans Attendee, avec le jeu par défaut et `buildEdgeCaseItems()` chargés par `/__fake/items`, la première synchronisation crée les billets attendus et consigne `DUPLICATE_EMAIL`, `INVALID_EMAIL`, `WAITING` et `UNKNOWN`. La seconde donne 0, 0, 0, les mêmes erreurs et aucun doublon d'e-mail ni de `helloassoItemId`.
3. Un billet passé à `Canceled`, ou dont un paiement passe à `Refunded`, par `PATCH /__fake/items/{id}`, donne un Attendee `cancelled`, ses rendez-vous annulés et un `meeting-cancelled` par autre partie dans la boîte de sortie.
4. `welcome` part une fois par Attendee, avec un lien de 72 heures, seulement si l'espace est ouvert.
5. Deux synchronisations simultanées : la seconde reçoit 409 `SYNC_RUNNING`.
6. HelloAsso injoignable : SyncRun d'erreur, Strapi toujours debout. Aucun secret ni jeton dans les journaux.
7. Les tâches planifiées ne sont enregistrées qu'avec `CRON_ENABLED=true`.
8. Le seed crée les 17 Attendee de la recette, Lucas Darrigade `cancelled`, et 17 EmailLog `welcome`. Deux exécutions donnent les mêmes comptes.
9. Règles communes du lot 2, point 10.

### Lot 5 (developer) : accès

Exigences : I-20 à I-23, F-01 à F-04 (côté API), NF-01 à NF-04, A-04, A-18, A-19, T-01 à T-04.

Fichiers : `lib/{session,rate-limit}.js`, `services/{auth,me}.js`, `controllers/{auth,me}.js`, `routes/auth.js`, `lib/mail/templates/access-link.js`, `middlewares/context.js` (étape 3 seulement).

Critères d'acceptation, vérifiés par `curl` sur `strapi_e2e` seedée, commandes dans le compte rendu :

1. **Demande de lien** : une adresse inscrite produit un `access-link` dans la boîte de sortie, avec un lien de 30 minutes. Une adresse inconnue reçoit la même réponse, sans envoi. À la 6e demande en 15 minutes pour une même adresse ou une même IP, la réponse est 429.
2. **Lien** : `GET /auth/link` renvoie les trois états de A-18. Un lien vérifié deux fois échoue la seconde fois. Un lien expiré échoue.
3. **Cookie** : `HttpOnly`, `SameSite=Lax`, `Path=/`, signé, 30 jours, sans `Secure` en http local. Après la déconnexion, le même cookie reçoit 401.
4. **Organisateur** : `organisation@example.org` reçoit un lien et devient `organizer`, invisible et sans consentement ; il accède aux routes `admin`, ce qu'un participant ne peut pas faire (403).
5. **Profil** : `PATCH /me` et `PUT /me/consent` respectent la section 4.2. Un participant ne peut ni lire ni modifier un autre Attendee, quel que soit le corps envoyé.
6. **Redirections** : toutes absolues sur `PUBLIC_URL` ; `next` hors de l'édition retombe sur l'accueil de l'édition.
7. Règles communes du lot 2, point 10.

### Lot 6 (developer) : écrans E0, vérification, E2, E1 provisoire

Exigences : F-01 à F-04, F-10 à F-12, NF-07, NF-20, NF-23, NF-30, NF-31, Q-13, Q-14, A-06, A-10, A-18. Spécifications d'interface : réponses du designer (section 6), validées par Mathieu.

Fichiers :

- `web/src/layouts/EspaceLayout.astro` ; `web/src/styles/espace.css` (`@font-face` locales) ; `web/public/fonts/`, avec les woff2 de Sora et Source Sans 3, sous-ensemble latin, et une note de provenance et de licence (OFL)
- `web/src/components/espace/*.astro` (au moins `EditionBanner` et un bouton de formulaire : l'actuel `Button.astro` n'est qu'un lien vert)
- `web/src/pages/espace/verifier.astro` et `web/src/pages/espace/[edition]/{connexion,bienvenue,index}.astro`
- `web/src/react-components/espace/WelcomeForm.tsx`, seul îlot de la phase
- `web/src/lib/espace/{api,client,format}.ts`, `web/src/middleware.ts`, `web/astro.config.mjs` (filtre du sitemap)

Interdits : pages publiques, `Layout.astro`, `Header.astro`, `Footer.astro`, modification de `app.css` (importé, jamais édité), `package.json` et lockfiles, tests.

Comportement :

- **E0** : formulaire HTML sans îlot ; messages selon `?envoye`, `?erreur` et `?deconnecte`, annoncés par `aria-live`.
- **Vérification** : deux états (A-18).
- **E2** : îlot `WelcomeForm`. Il montre les quatre champs et les trois cases (valeurs actuelles, donc décochées à la première visite, F-10) et affiche la note F-11. Il envoie `PATCH /me` puis `PUT /me/consent`, et redirige vers E1. Les erreurs s'affichent sous chaque champ.
- **E1 provisoire** : bandeau, salutation, bouton « Me déconnecter » (formulaire). La phase 2 le remplace.
- **Accès aux pages** : une page dont l'édition est absente, non publiée ou fermée répond 404. Sans session valable pour l'édition de l'URL, E2 et E1 redirigent vers E0 ; si `consentAt` est vide, E1 redirige vers E2.
- **Middleware** : sur `/espace` seulement, il pose `Content-Security-Policy` sans origine tierce, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Cache-Control: private, no-store`. Ailleurs, il rend la main sans rien toucher.
  - CSP : l'option CSP d'Astro (empreintes) si la version 6.0.7 la propose, sinon `script-src 'self' 'unsafe-inline'`.
  - `form-action` admet l'origine de Strapi, à laquelle les formulaires sont envoyés.

Critères d'acceptation :

1. **Parcours local complet**, sur Strapi `strapi_e2e` seedée et le front construit, avec Tom Laffitte (non activé) : E0, message d'envoi, lien lu dans la boîte de sortie, bouton, E2, Continuer, E1, déconnexion, E0.
2. **Sans JavaScript** : E0 et la vérification fonctionnent.
3. **États d'E0** : lien réutilisé (état F-04, adresse préremplie) et 6e demande (message de 429) affichés.
4. **Sobriété des pages `/espace`** : aucune requête vers Google ni Matomo, `noindex`, en-têtes NF-07 présents ; les mêmes en-têtes sont absents des pages publiques ; le sitemap exclut `/espace/`.
5. **Poids** : 0 octet de JavaScript d'îlot sur E0 ; l'îlot d'E2 pèse au plus 80 Ko compressés (NF-20).
6. **Spécifications du designer** respectées : couleurs et tailles par les tokens de `07-design.md` seulement, aucun tiret cadratin.
7. Règles communes du lot 2, point 10.

### Lot 7 (tester) : vérification et porte

Fichiers : ceux du tester (tableau des fichiers partagés), plus `strapi/tests/e2e-server.js`. L'environnement e2e y reçoit `PUBLIC_URL` et `CORS_ORIGINS` (l'URL du front e2e), `ORGANIZER_EMAILS`, `IS_PROXIED` et un chemin de boîte de sortie connu des tests.

- Plus aucun `todo` parmi les tests d'abord. Toute exception est justifiée dans `SPEC.md` et validée par l'architecte.
- **e2e** :
  - T-01 à T-04 dans le navigateur ;
  - parcours E0, E2, E1, déconnexion ;
  - contexte sans JavaScript pour E0 et la vérification ;
  - en-têtes NF-07 sur `/espace` et leur absence sur `/` ;
  - aucune requête externe sur `/espace`, polices Google comprises (la tolérance actuelle ne vaut que pour les pages publiques) ;
  - sitemap.
- **Accessibilité** : contrôle axe de E0, de la vérification et de E2, avec `@axe-core/playwright` (facultatif, report possible en phase 3).
- **Revue du designer** : captures d'E0 (initial, envoyé, 429, lien invalide), de la vérification (valable) et d'E2 (initial, note F-11, erreurs) à 390 et 1280 px. Elles vont dans le dossier temporaire de session, jamais dans le dépôt.
- **Non-régression** : `test:visual` sur les pages publiques, après les lots 2 et 6.
- **Porte** : scénario de la section 7.

## 6. Designer : relecture pour E0, E2 et les e-mails

Le designer n'a que des outils de lecture. L'architecte transmet les questions par l'intermédiaire de son appelant et reporte les réponses dans la spec du lot 6. Elles conditionnent le lot 6 et le texte des gabarits (lots 4 et 5) ; les lots 1 à 3 n'en dépendent pas.

À relire :

- maquettes `docs/espace/maquettes/01-connexion.png` (E0 et bloc de consentement), `08-relance.png` (gabarit d'e-mail), `02-accueil.png` (bandeau et en-tête, pour l'E1 provisoire) ;
- `docs/espace/specs/03-ecrans.md` (E0, E2, E10), `07-design.md`, `08-non-fonctionnel.md` (NF-20, NF-23, NF-30, NF-31), `11-questions-ouvertes.md` (Q-13, Q-14) ;
- code existant : `web/src/styles/app.css` (bloc `@theme`), `web/src/components/Button.astro` et `Hero.astro`, `web/src/layouts/Layout.astro` (ce que l'espace ne reprend pas), `web/public/assets/` (logos), `web/public/fonts/` ;
- ce plan : A-18, sections 4.2 et 5 (lot 6).

Questions :

1. **Répartition de la maquette.** La maquette 01 place les cases de consentement, cochées, sur l'écran de connexion. La spec sépare E0 (adresse seule) et E2 (après le lien, cases décochées, F-10). Confirmer qu'E0 se compose du bandeau, du titre, du champ, du bouton et de la mention. Proposer E2, qui n'a pas de maquette : quatre champs importés modifiables, trois cases, note F-11, « Continuer ».
2. **États et textes.** E0 : envoyé (F-02 : remplacer la carte ou annoncer au-dessus ?), 429, adresse invalide, déconnecté. Vérification : bouton « Ouvrir mon espace », lien invalide avec formulaire prérempli. Sous-titre du bandeau : la maquette dit « Votre inscription HelloAsso est confirmée », ce qui est faux pour un visiteur inconnu. Quelle formulation neutre ?
3. **Contrastes.** `#00b388` sur blanc n'atteint pas 3:1 pour une case cochée. Prendre `#007a5e` ? Quel style de focus ?
4. **Polices (Q-14).** Quelles graisses de Sora et de Source Sans 3 l'espace emploie-t-il ? Des fontes variables suffisent-elles ? L'objectif est de limiter les woff2 servis.
5. **E-mails.** Gabarit commun d'après 08-relance (en-tête couleur d'édition, logo blanc en PNG, bouton or, pied). Objets et textes d'`access-link`, de `welcome` et de `meeting-cancelled`.
6. **Composants.** Un bouton de formulaire propre à l'espace, aux couleurs de `07` ? Absence de barre d'onglets sur E0 et E2 ? Colonne unique de 720 px centrée au-delà de 1024 px ?
7. **E1 provisoire.** Bandeau, salutation et déconnexion suffisent-ils jusqu'à la phase 2 ?

## 7. Porte de la phase 1

Porte de `09-phases.md` : T-01 à T-06 verts ; import du formulaire bac à sable idempotent (deux exécutions successives, aucun doublon) ; tests d'accès croisés NF-01 sur `/me`. S'y ajoutent les conditions reportées ou propres au dépôt.

| Condition | Vérification par le tester |
|---|---|
| T-01 à T-06 | intégration (T-01 à T-06) et e2e (T-01 à T-04), sans `todo` |
| Import idempotent | sur le faux HelloAsso, scénario ci-dessous ; sur le bac à sable dès qu'il existe |
| NF-01 sur `/me` | voir ci-dessous |
| Non-régression visuelle | `test:visual` : 4 sur 4 |
| Intégration continue | workflow vert sur GitHub pour les phases 0 et 1, au premier push autorisé |
| Revue du designer | E0, vérification et E2 conformes, sur captures |
| Compte rendu | `docs/espace/journal/phase-1.md`, par l'architecte |

**Import sur le faux HelloAsso** (test d'intégration, en module, port libre) :

1. Préparation : faux chargé du jeu par défaut et de `buildEdgeCaseItems({ padding: 120 })`, soit plus de 100 billets, donc au moins 2 pages, avec `tokenTtlSeconds: 61`, ce qui ramène le cache à 1 s. Édition de test publiée et ouverte, réglée sur `xylofutur-test`, `Event`, `jib-nouvelle-aquitaine-test` et la correspondance de Q-03, sans Attendee.
2. Première synchronisation, par `POST /admin/{edition}/sync` en session organisateur :
   - comptes `created` égaux aux billets actifs à adresse unique et valable ;
   - `errors` conformes aux cas limites ;
   - un `welcome` par Attendee créé.
3. Seconde synchronisation, plus d'une seconde après :
   - `created`, `updated` et `cancelled` à 0, mêmes `errors`, même nombre d'Attendee ;
   - en SQL, aucun doublon de (édition, `helloassoItemId`) ni de (édition, e-mail) ;
   - 2 SyncRun clos ;
   - aucun `welcome` de plus (EmailLog et boîte de sortie) ;
   - `/__fake/stats` montre un nouveau jeton (renouvellement, I-10).
4. T-06 : rendez-vous créés directement en base pour deux Attendee. `PATCH /__fake/items/{id}` passe l'un à `Canceled` et ajoute un paiement `Refunded` à l'autre. La troisième synchronisation donne `cancelled: 2`, les rendez-vous annulés avec `tableKey` à `null`, les `meeting-cancelled` dans la boîte de sortie et une session refusée (401) pour les deux Attendee.
5. Deux synchronisations lancées en même temps : une réussit, l'autre reçoit 409.

**Bac à sable** : quand Mathieu aura créé le compte et un formulaire reproduisant Q-03, le même scénario (étapes 2 et 3) tournera à la main, hors CI, avec `HELLOASSO_API_BASE=https://api.helloasso-sandbox.com/v5` et les identifiants du bac à sable dans l'environnement local. Il faudra ouvrir `no-network.js`, sur demande explicite, à ce seul hôte. Résultat consigné dans `phase-1.md`. D'ici là, cette ligne de la porte est passée sur le faux et marquée « bac à sable en attente ».

**NF-01 sur `/me`** : deux participants A et B de la même édition, plus un participant C d'une autre édition publiée et ouverte, à créer par le test.

- **A ne voit que lui** : `GET /me` ne renvoie que A. Un `PATCH /me` portant `id`, `email`, `role`, `edition` ou `status` les ignore ; un tel `PATCH` sur les champs de B ne modifie que A.
- **Sessions invalides** : sans cookie, 401. Cookie de B dont la signature est retirée ou altérée : 401. Session expirée : 401. Après déconnexion : 401. Attendee `cancelled` : 401. Édition fermée : 401.
- **Cloisonnement** : la session de C ne donne accès à aucune route `admin` de l'édition de A. Un participant reçoit 403 sur `/admin/{edition}/sync`.
- **Minimisation** : aucune réponse ne contient l'e-mail, ni le jeton en clair, ni les identifiants HelloAsso.

## 8. Priorité et report

- **Le code le plus court** :
  - aucune dépendance ;
  - aucune couche d'abstraction hors de celles de la section 4 ;
  - gabarits d'e-mail en gabarits littéraux ;
  - aucun îlot hors d'E2 ;
  - pas de bibliothèque de dates : `Intl` suffit (A-09).
- **P1** : le périmètre de la phase n'en contient aucune ; I-13 et F-05 sont déjà en phase 3.
- **En cas de retard**, reporter en phase 3, dans cet ordre, ce qui ne conditionne pas la porte :
  1. le contrôle axe ;
  2. `GET /admin/:edition/sync-runs` ;
  3. la route de régénération des créneaux (le service reste, appelé par le seed) ;
  4. l'habillage de l'E1 provisoire.
- **Jamais reportés** : les tests, T-01 à T-06, NF-01 à NF-04.

## 9. Points qui demandent une action de Mathieu

1. Autoriser un push de `feat/espace-participant`. Le workflow de tests tournera alors pour la première fois : porte de la phase 0 « en intégration continue », puis celle de la phase 1.
2. Créer le compte bac à sable HelloAsso et un formulaire reproduisant Q-03 (champs par tarif). Obtenir de Xylofutur les identifiants API de production (Q-08).
3. Fournir `EMAIL_FROM` (Q-16) et décider si le serveur de dev envoie de vrais e-mails à la recette : il tourne en `NODE_ENV=production`, donc sur Brevo par défaut.
4. Valider Q-13 (bouton « Ouvrir mon espace ») et Q-14 (polices servies par le site) avant le lot 6, qui les met en œuvre par défaut.
5. Trancher avant la phase 3 le chemin des données de recette sur le serveur de dev. Le seed refuse toute base autre que `_e2e` et `_test`. Proposition : édition de test créée dans le back-office, puis import depuis le bac à sable.
6. Avant le premier déploiement de la branche : créer le secret GitHub `SECRET_HELLOASSO_CLIENT_SECRET` et changer `VERSION`, puisque la prod tourne sur les images `0.1.0`.

## 10. À reprendre ensuite

- **Phase 2** :
  - `/me` complet (`profileCompletion`, compteurs, préférences, photo) et E3 ;
  - E1 complet, qui remplace l'E1 provisoire ;
  - service des rendez-vous, qui étend `services/meetings.js`, et gabarits `meeting-*` sur le gabarit commun ;
  - fermeture par défaut de la fenêtre (veille 18h00, dans `lib/time.js`) ;
  - mesure de la couverture des branches.
- **Phase 3** :
  - E9 (bouton de synchronisation, historique, régénération des créneaux), qui appelle les routes de la phase 1 ;
  - I-13 par `getOrder` (P1) ;
  - autres tâches planifiées ;
  - E8, qui lit `Topic.sessions` ;
  - F-05 ;
  - données de recette sur le serveur de dev (point 9.5).
- **Mise en production** :
  - `kind = b2b_break` sur les trois pauses réelles et rattachement des séquences aux thèmes, dans le back-office ;
  - réglages HelloAsso de l'édition ;
  - liste réelle de `ORGANIZER_EMAILS` (Q-12).
- **Après le 3 décembre** : fenêtre du seed périmée (`phase-0.md`), sans effet sur les tests (A-19).
