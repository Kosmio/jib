# Phases 2 et 3 : plan d'exécution parallèle (recette locale du 30 octobre)

Rédigé par l'architecte le 30 octobre 2026. But : une version aussi complète que possible de l'espace, testable par Mathieu ce soir en local, produite cet après-midi par plusieurs developers et un tester en même temps. Ce soir n'est pas une porte : les portes des phases 2 et 3 de `09-phases.md` (T-10 à T-26 verts, couverture des branches R-10 à R-18, Lighthouse, axe) restent dues avant le 19 novembre.

Principes de la phase 1 inchangés : le code le plus court, aucune dépendance, logique pure dans `lib/`, `now` injectable (A-19), A-15 pour le modèle. Les formes de la section 3 complètent `06-api.md` et priment en cas d'écart ; les developers ne modifient pas `06-api.md` ce soir, ils signalent tout écart dans leur compte rendu.

## 1. Priorités pour ce soir

| Rang | Bloc | Exigences | Lots |
|---|---|---|---|
| 1 | E1 réel (compte à rebours, profil, prochain rendez-vous, suggestions, badges) | F-20 à F-24, R-50 | 8, 9, 10 |
| 2 | E3 profil (champs, bio, sujets, visibilité, préférences, photo) | F-30 à F-32, R-30, R-31, R-40 | 9, 10 |
| 3 | E4 annuaire | F-40 à F-44, R-41 à R-43, A-26 | 9, 10 |
| 4 | E5 fiche et demande | F-50 à F-57, R-11, R-12, R-19 | 8, 9, 11 |
| 5 | E6 agenda : accepter, refuser, contre-proposer, annuler | F-60 à F-66, R-10, R-13 à R-16 | 8, 11 |
| 6 | Tables, concurrence, tables dédiées, expiration | R-03, R-13, R-17, R-19, T-17, T-25, T-26 | 8 |
| 7 | .ics et e-mails `meeting-*` | I-40, I-41, E10 | 8 |
| 8 | E8 programme, E7 messagerie, E9 tableau de bord minimal | F-70 à F-74, F-80, F-81, F-90, R-61 à R-64 | 14, 15 |

**Reporté après ce soir, franchement** : F-33 et R-44 (suppression des données) ; relances R-70 à R-72 et gabarits `reminder-*` ; exports CSV (F-91), relance manuelle (F-92), F-93 ; PWA (F-05, NF-24, manifeste) ; webhook I-13 ; abonnement calendrier I-42 ; F-45 (filtres dans l'URL), F-75 (signalement) ; contre-proposition vers un exposant (A-31) ; couverture des branches, Lighthouse, axe, revue du designer sur captures ; mise à jour de `06-api.md` et compte rendu `phase-2.md`. Si le temps manque, on coupe dans cet ordre : E9, photo (E3 reste complet sans elle), E7, F-24.

## 2. Décisions

**A-27. Un verrou par édition pour toute écriture de rendez-vous.** Création, acceptation, refus, contre-proposition, annulation et expiration passent par `withLock('meetings:{editionDocumentId}', fn)` (A-16). `fn` charge un instantané de l'édition (section 3.1), applique les règles pures, écrit, et renvoie la liste des e-mails à envoyer. Les e-mails partent **après** la transaction, hors verrou. Raison : les conditions 5 à 9 de R-11 portent sur plusieurs créneaux et plusieurs parties, ce qu'aucun index ne garantit ; à 200 participants et 600 rendez-vous, sérialiser coûte quelques millisecondes. L'index `espace_meetings_table_key_uq` reste le filet : une violation fait réessayer la table libre suivante (3 essais, R-13), puis `NO_TABLE_LEFT` (ou `TARGET_BUSY` pour une table dédiée, R-19). `tableKey` = `{slotDocumentId}:{tableNumber}`.

**A-28. Instantané et règles pures.** Tout identifiant est un `documentId`. Les règles R-10 à R-19 vivent dans `lib/meetings.js` et ne lisent que l'instantané ; le service ne fait que charger, écrire et notifier. Le tester les couvre en unitaire, sans base.

**A-29. Tables dédiées (R-19, D-04).** `hostedTableNumber` compte s'il est entier, entre 1 et `tablesCount`, porté par un Attendee actif de rôle `speaker`. Deux Attendee sur le même numéro : le plus petit `id` le garde, l'autre est ignoré. Les cas ignorés sortent en `warnings` de `/admin/{edition}/stats` (`HOSTED_TABLE_CONFLICT`, `HOSTED_TABLE_INVALID`). Lot commun = tables 1 à `tablesCount` moins les numéros retenus. Un rendez-vous déjà accepté sur une table qui devient dédiée garde sa table. Réservation : `accepted` d'emblée, `answeredAt` = maintenant, `answeredBy` vide. Un intervenant à table dédiée figure dans l'annuaire même sans `directoryOptIn` (R-19.5, R-43), mais sa carte et sa fiche ne montrent alors que les données publiques du programme (`intervenant` : nom, fonction, structure, photo, séquences), pas son profil personnel.

**A-30. Fermeture de R-15.** À l'acceptation d'un rendez-vous A ↔ B sur le créneau S, pour chaque demande `pending` de S qui implique A, B ou l'exposant B devenu complet : si son demandeur est A ou B (personne), elle passe `cancelled`, motif « Créneau pris par un autre rendez-vous », sans e-mail ; sinon elle passe `declined` et son demandeur reçoit `meeting-declined` (« Le créneau n'est plus disponible. »). Un exposant est complet quand ses rendez-vous acceptés sur S égalent ses représentants actifs (R-14). Simplification v1 : un représentant reste libre à titre personnel pendant les rendez-vous de son stand.

**A-31. Contre-proposition (F-62).** Une transaction : la demande initiale passe `declined` (`answeredBy`, `answeredAt`), puis une demande B → A est créée sur le nouveau créneau, contrôlée par R-11 en ignorant la demande initiale. Un échec annule tout (409, la demande initiale reste `pending`). Seul e-mail : `meeting-request` à A, en variante « nouvelle proposition ». Pas de contre-proposition vers un exposant ni à une table dédiée en v1 (`canCounter` faux, 409 `COUNTER_UNAVAILABLE`) : le représentant refuse et écrit.

**A-32. Fenêtre (R-17, F-55).** `meetingRequestsOpenAt` vide : ouverte sans borne basse. `meetingRequestsCloseAt` vide : veille de `Edition.date` à 18h00 Europe/Paris (`zonedToUtc`). Une demande `pending` ne s'accepte plus après la fermeture, même avant le passage de la tâche d'expiration (5 min, `espaceMeetingExpiry`, qui n'envoie rien).

**A-33. E-mails des rendez-vous.** `meeting-request` respecte `emailPrefs.meetingRequests` (cible, ou chaque représentant actif d'un exposant). `meeting-accepted`, `meeting-declined` et `meeting-cancelled` partent toujours : ils répondent à un acte ou touchent un rendez-vous confirmé. Réservation R-19 : `meeting-accepted` aux deux. Chaque bouton porte son propre lien d'action de 72 heures (I-21, `next` = `/espace/{slug}/agenda?demande={id}`) ; « Accepter » ouvre l'agenda, jamais une action par GET (Q-13). `services/mailer.js` transmet `attachments` au fournisseur (.ics, I-41).

**A-34. Annuaire en mémoire (F-41 à F-43, NF-21).** Le service charge toutes les cartes visibles de l'édition (300 au plus), la fonction pure filtre, trie et découpe. Recherche : minuscules, diacritiques retirés (`NFD`), sur nom, entreprise, fonction et noms de sujets ; ignorée sous 2 caractères. Tri : avec `type=all`, intervenants et exposants d'abord, puis nom de famille, prénom (personnes) ou nom de structure (exposants), `localeCompare('fr', { sensitivity: 'base' })`. Curseur = rang de départ, en texte. Organisateurs toujours exclus (A-26). Visibilité d'une fiche personne (R-41) : soi ; Attendee actif avec `directoryOptIn` ; intervenant à table dédiée (A-29, données publiques) ; toute personne avec qui le visiteur a un rendez-vous (tout statut) ou une conversation. Sinon 404.

**A-35. Photo (F-30) sans dépendance.** `sharp` n'est pas une dépendance directe du dépôt. Le navigateur recadre en carré et réduit à 256 px par `canvas`, encode en WebP, ou en JPEG si le navigateur n'encode pas le WebP (Safari). Le serveur accepte JPEG, PNG ou WebP (type vérifié sur les premiers octets), 5 Mo au plus, enregistre par le plugin Upload (`strapi.plugin('upload').service('upload').upload`) et supprime l'ancienne photo. `photoUrl` est le chemin renvoyé par Upload (`/uploads/…`) ; le front le préfixe par `publicStrapiUrl`. CSP : `img-src 'self' data: blob: {origine de Strapi}`.

**A-36. `Me` de la phase 2.** `toMe` lit l'Attendee rechargé avec photo, sujets et exposant. Les compteurs (`counts`) ne figurent que dans `GET /me`, qui sert au rendu serveur de chaque page (coquille, badges F-24).

**A-37. Messagerie (phase 3).** Rafraîchissement par interrogation toutes les 20 s, suspendue onglet masqué (F-71, NF-23). Une conversation par paire, sous le verrou `conversation:{editionDocumentId}`, participants dans l'ordre des `id`. R-61 : `POST /conversations` refuse 403 `TARGET_UNAVAILABLE` si aucune conversation n'existe et que la cible n'a pas `meetingsOptIn` ; la cible doit être visible au sens de A-34. R-64 : compté en base (messages de l'auteur dans l'heure). Le rendez-vous lié affiché dans le fil est calculé (prochain rendez-vous accepté de la paire), le champ `Conversation.meeting` n'est pas utilisé. E5 renvoie vers `/espace/{slug}/messages/nouveau?avec=p:{id}` ; la conversation n'est créée qu'au premier envoi.

**A-38. Base de démonstration.** `test:e2e` vide `strapi_e2e` à chaque exécution. Mathieu teste donc ce soir sur `strapi_demo_e2e`, chargée par le même seed : aucun agent ne s'en sert. Chaque agent prend ses propres bases et ports (section 4.2).

## 3. Contrats

### 3.1 Modules purs de `strapi/src/api/espace/lib/`

| Module | Lot | Exports |
|---|---|---|
| `cards.js` | 9, premier commit | `ATTENDEE_CARD_POPULATE`, `EXHIBITOR_CARD_POPULATE` (objets `populate` du Document Service : photo, sujets, exposant et son organisation, intervenant et son organisation) ; `initials(name)` → « LD » ; `attendeeCard(attendee, { publicOnly = false })` → CarteProfil (A-29 pour `publicOnly`) ; `exhibitorCard(exhibitor)` → CarteProfil |
| `profile.js` | 9 | `profileCompletion({ firstName, lastName, company, jobTitle, photo, bio, topics })` → entier : 40 si les trois premiers sont non vides, puis 15 chacun pour fonction, photo, présentation, au moins un sujet (R-30) |
| `directory.js` | 9 | `normalizeText(text)` ; `searchDirectory({ cards, q, type, topicIds, cursor, pageSize = 30 })` → `{ items, nextCursor, total }` (A-34 ; `type` : `all`, `participant` = participants et représentants, `speaker`, `exhibitor` = cartes exposant) |
| `suggestions.js` | 9 | `suggest({ meId, myTopicIds, candidates, excludedIds, day, limit = 3 })` → CarteProfil[] (R-50). `day` = `YYYY-MM-DD` à Paris ; aléa stable = empreinte de `meId:day:id`. Sans sujet : intervenants et exposants |
| `meetings.js` | 8 | voir ci-dessous |
| `ics.js` | 8 | `buildCalendar({ name, events: [{ uid, start, end, summary, location, description, url }], now })` → texte RFC 5545 : CRLF, pliage à 75 octets, échappement `\ ; , \n`, bloc `VTIMEZONE` Europe/Paris fixe, `DTSTART;TZID=Europe/Paris`, `UID` stable `{type}-{documentId}@jib` (I-40) |
| `messages.js` | 14 | `notificationsDue({ messages, notifiedAt, prefs, now })` → `[{ conversationId, recipientId, messageIds }]` : non lus depuis 5 min, `emailNotifiedAt` vide, aucun e-mail pour cette paire conversation et destinataire depuis 30 min, préférence `messages` active (R-62) |

`lib/meetings.js` (lot 8). Instantané `snap` : `{ now, tablesCount, window: { state, openAt, closeAt }, slots: Map(id → { id, startsAt, endsAt, sessionTitle }), meetings: [{ id, slotId, requesterId, targetAttendeeId, targetExhibitorId, status, tableNumber }], attendees: Map(id → { id, status, role, meetingsOptIn, exhibitorId }), exhibitors: Map(id → { id, standNumber, name, activeRepIds }), hosted: Map(attendeeId → n) }`.

- `parseTarget(text)` → `{ kind: 'p'|'x', id }` ou `null` ; `requestWindow(edition, now)` → `{ state: 'open'|'not_open'|'closed', openAt, closeAt }` (A-32) ; `hostedTables(attendees, tablesCount)` → `{ hosted: Map, warnings }` (A-29).
- `checkRequest(snap, { requesterId, target, slotId, ignoreMeetingId })` → `{ ok: true, mode: 'request'|'booking'|'stand', tableNumber? }` ou `{ ok: false, code }`. Ordre des contrôles : R-11.1 `WINDOW_CLOSED`, .2 `SLOT_PAST`, .10 `HOST_AT_TABLE`, .4 puis .3 `TARGET_UNAVAILABLE` (soi, son exposant, organisateur, inactif, sans `meetingsOptIn` hors table dédiée, exposant sans représentant actif), .5 `SLOT_TAKEN`, .6 `TARGET_BUSY`, .7 `ALREADY_REQUESTED`, .8 `NO_TABLE_LEFT`, .9 `TOO_MANY_PENDING`. Mode `booking` (R-19.2) : 1, 2, 10, 4, intervenant actif, 5, table de l'hôte prise sur le créneau `TARGET_BUSY`, rendez-vous à venir avec l'hôte `ALREADY_REQUESTED`.
- `checkAccept(snap, meetingId, viewerId)` → `{ ok: true, location, tableNumber }` ou `{ ok: false, code }` : `FORBIDDEN` si le visiteur n'est ni la cible ni un représentant actif de l'exposant cible, puis `INVALID_TRANSITION`, `WINDOW_CLOSED`, `SLOT_PAST`, `SLOT_TAKEN`, `TARGET_BUSY`, `NO_TABLE_LEFT` ; table = plus petite libre du lot commun (R-13).
- `closeOnAccept(snap, meeting)` → `{ cancel: [id], decline: [id] }` (A-30).
- `slotStates(snap, { viewerId, target })` → `Map(slotId → 'available'|'unavailable'|'requested'|'confirmed')` ; créneaux commencés absents (F-50) ; `unavailable` si R-11.2, .5, .6 ou .8 échoue (R-12).
- `meetingActions(snap, meeting, viewerId)` → `{ direction, canAccept, canDecline, canCounter, canCancel }` ; annulation par le demandeur d'un `pending`, par une partie d'un `accepted`, jusqu'au début du créneau (R-16).
- `assertTransition(status, action)` lève `EspaceError(409, 'INVALID_TRANSITION')` hors du schéma de R-10.

### 3.2 API (base `/api/espace`, conventions de `06-api.md`)

Types : `CarteProfil` = `{ kind: 'attendee'|'exhibitor', id, displayName, subtitle, photoUrl, initials, tag: 'participant'|'speaker'|'exhibitor_rep'|'exhibitor', topics: [{ id, name }], standNumber?, hostedTableNumber? }`. `Meeting` = `{ id, status, slot: { id, label, startsAt, endsAt, sessionTitle }, location, counterpart: CarteProfil, direction: 'sent'|'received', viaExhibitor: null|{ id, name, standNumber }, message, answeredByName, createdAt, canAccept, canDecline, canCounter, canCancel }` (`viaExhibitor` : le visiteur répond au nom de son exposant).

| Méthode, chemin | Lot | Corps → réponse ; erreurs |
|---|---|---|
| GET `/me` | 9 | `Me` = celui de la phase 1 plus `{ bio, photoUrl, topics: [{ id, name }], emailPrefs: { meetingRequests, messages, reminders }, profileCompletion, exhibitor: null\|{ id, name, standNumber }, hostedTableNumber, counts: { pendingReceived, unreadMessages } }` ; `counts` seulement ici (A-36) |
| PATCH `/me` | 9 | phase 1 plus `bio` (280 au plus, vide → null, texte brut), `topics` (0 à 3 `documentId` distincts de l'édition), `emailPrefs` (trois booléens) → `Me` ; 400 `VALIDATION` + `fields`. `editedFields` ne concerne que les quatre champs importés |
| POST `/me/photo` | 9 | multipart, champ `photo` → `{ photoUrl }` ; 400 `PHOTO_INVALID`, 400 `PHOTO_TOO_LARGE` (A-35) |
| GET `/editions/:slug/topics` | 9 | public → `[{ id, name }]`, tri français |
| GET `/directory?q&type&topics&cursor` | 9 | `{ items: CarteProfil[], nextCursor, total }` (A-34) |
| GET `/directory/p/:id` | 9 | CarteProfil plus `{ firstName, lastName, jobTitle, company, bio, sessions: [{ title, start, end }], exhibitor, isSelf, canMessage }` ; 404 `PROFILE_NOT_FOUND` (R-41) ; jamais d'e-mail (R-42) |
| GET `/directory/x/:id` | 9 | CarteProfil plus `{ description, website, representatives: CarteProfil[] (visibles seulement), isMine }` ; 404 |
| GET `/suggestions` | 9 | CarteProfil[], 0 à 3 (R-50) |
| GET `/slots?target=p:{id}\|x:{id}` | 8 | `{ mode: 'request'\|'booking'\|'stand', window, blocked: null\|{ code: 'SELF'\|'TARGET_UNAVAILABLE'\|'WINDOW_CLOSED'\|'HOST_AT_TABLE', message }, pending: null\|{ meetingId, slotLabel }, groups: [{ session: { id, title, start, end }, slots: [{ id, label, startsAt, state }] }] }` ; 400 `VALIDATION`, 404 `TARGET_NOT_FOUND` |
| POST `/meetings` | 8 | `{ slotId, target, message? }` → 201 `Meeting` (`pending`, ou `accepted` en mode `booking`) ; 400 `VALIDATION` (message de plus de 300 caractères, cible mal formée), 404 `SLOT_NOT_FOUND`, `TARGET_NOT_FOUND`, 409 codes de `checkRequest` |
| GET `/meetings` | 8 | `{ received: Meeting[] (pending reçus), sent: Meeting[] (pending envoyés), agenda: [{ type: 'session', id, title, start, end, startsAt, endsAt, kind } \| { type: 'meeting', startsAt, meeting }] (séquences à heure lisible, acceptés, pending envoyés, tri par heure), closed: Meeting[] (refusés, annulés, expirés, 20 derniers) }` |
| POST `/meetings/:id/accept` | 8 | → `Meeting` ; 403 `FORBIDDEN` (T-24), 404 `MEETING_NOT_FOUND` (autre édition), 409 codes de `checkAccept` |
| POST `/meetings/:id/decline` | 8 | `{ reason? }` → `Meeting` ; 403, 404, 409 `INVALID_TRANSITION` |
| POST `/meetings/:id/counter` | 8 | `{ slotId, message? }` → 201 `Meeting` (la nouvelle demande) ; 403, 404, 409 `COUNTER_UNAVAILABLE` et codes de `checkRequest` |
| POST `/meetings/:id/cancel` | 8 | `{ reason? }` → `Meeting` ; 403, 404, 409 `INVALID_TRANSITION`, `SLOT_PAST` |
| GET `/meetings.ics` | 8 | `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="jib-{slug}.ics"` : rendez-vous acceptés et séquences (sans fin : 30 min) |
| GET `/editions/:slug/program` | 14 | public → `{ notes: [texte des séquences sans heure], sessions: [{ id, title, description, start, end, startsAt, kind, topics, speakers: [{ name, title, organisation, photoUrl, attendeeId }] }], speakers: [{ name, title, organisation, photoUrl, attendeeId, sessions: [titre] }], venues: [{ name, address, mapUrl, timeSlot }] }` ; `attendeeId` seulement si la fiche est visible (A-34) |
| GET `/conversations` | 14 | `[{ id, counterpart: CarteProfil, lastMessage: { excerpt, at, mine }, unread, meeting: null\|{ id, slotLabel, location } }]`, dernier message d'abord |
| POST `/conversations` | 14 | `{ with: 'p:{id}' }` → `{ id }` (200 existante, 201 créée) ; 403 `TARGET_UNAVAILABLE` (R-61), 404 `TARGET_NOT_FOUND` |
| GET `/conversations/:id/messages?after=` | 14 | `{ conversation: { id, counterpart, meeting, counterpartGetsEmail }, messages: [{ id, body, at, mine, readAt }] }`, marque lus les messages reçus ; 404 hors participants (NF-01, R-63) |
| POST `/conversations/:id/messages` | 14 | `{ body }` → 201 message ; 400 `VALIDATION` (vide, plus de 2 000), 429 `RATE_LIMITED` (R-64) |
| GET `/admin/:edition/stats` | 14 | organisateur → `{ attendees: { total, active, cancelled, byRole }, activated, consented, directoryOptIn, profilesComplete, meetings: { pending, accepted, declined, cancelled, expired }, messages, slots: [{ sessionTitle, label, accepted, pending, tables: tablesCount }], topExhibitors: [{ id, name, requests }] (5), warnings, lastSync: SyncRun\|null }` |

Routes nouvelles réparties en fichiers (A-20) : `routes/meetings.js` (lot 8), `routes/directory.js` (lot 9 : `/directory*`, `/suggestions`, `/me/photo`, `/editions/:slug/topics`), `routes/messages.js` et `routes/program.js` (lot 14, `program.js` porte aussi `/admin/:edition/stats`). `routes/auth.js` reste inchangé : `me.show` et `me.update` gardent leurs noms.

### 3.3 Gabarits (`lib/mail/templates/`, contrat de gabarit de la phase 1)

Données communes `{ edition, publicUrl, firstName }`. `meeting-request` (8) : `{ requesterName, requesterSubtitle, slotLabel, sessionTitle, message, counter: null|{ previousSlotLabel }, acceptUrl, viewUrl }`. `meeting-accepted` (8) : `{ counterpartName, slotLabel, location, venue, agendaUrl, booking }`, pièce jointe `rendez-vous.ics`. `meeting-declined` (8) : `{ counterpartName, slotLabel, reason, directoryUrl }`. `meeting-cancelled` : existant, inchangé. `new-message` (14) : `{ authorName, excerpt (200), threadUrl }`. Objets avec espace insécable avant les deux-points, comme `meeting-cancelled`.

### 3.4 Front

Coquille et primitives (lot 10, premier commit, avant toute page) : `AppShell.astro` (barre d'onglets basse, latérale à partir de 1024 px, badges `counts`, prop `active`), `react-components/espace/ProfileCardView.tsx` (avatar ou initiales, nom, sous-titre, étiquette ; rendu serveur sans hydratation dans les pages, réutilisé dans les îlots), `lib/espace/api.ts` exporte `espaceGet(path, cookie)`, `client.ts` exporte `request` et le `Me` complet. `lib/espace/meetings.ts` (lot 11, premier commit) : types `Meeting`, `SlotsResponse`, `AgendaItem`, appels, et la table code d'erreur → texte (F-56 : « Ce créneau vient d'être pris, choisissez-en un autre »). Les textes d'erreur viennent de `error.message`, sauf F-56. Statuts toujours en mot et icône (F-64). Maquettes 02 à 07 et 09 et tokens de `07-design.md` font foi.

## 4. Lots

| Lot | Agent | Contenu | Dépend de | Durée |
|---|---|---|---|---|
| 8 | developer A | back rendez-vous, .ics, `meeting-*`, expiration | aucun ; `lib/cards.js` (lot 9) avant ses vues `Meeting` | 3 h |
| 9 | developer B | back profil, annuaire, suggestions, photo | aucun | 2 h |
| 10 | developer C | front coquille, E1, E3, E4 | aucun ; routes des lots 8 et 9 pour l'essai réel | 2 h 30 |
| 11 | developer D | front E5, E6 | premier commit du lot 10 | 3 h |
| 12 | developer E | seed de démonstration | premier commit du lot 8 (schéma) | 45 min |
| 13 | tester | tests d'abord T-10 à T-26 et règles | contrats ci-dessus ; porte de la phase 1 pour les fichiers partagés | 2 h 30 |
| 14 | developer E, après le lot 12 | back E7, E8, E9 | premier commit du lot 9 ; dernier du lot 8 pour `cron-tasks.js` | 2 h |
| 15 | developer F, ou C après le lot 10 | front E7, E8, E9 | premier commit du lot 10 | 2 h 30 |
| 16 | tester | vérification de la soirée | tous | 1 h, plus les retours |

Tous partent maintenant, sauf 11, 12 et 15 qui attendent un premier commit (au plus 20 minutes). Sans sixième instance, le lot 15 suit le lot 10. Chaque lot developer est vérifié par le tester (lot 16), qui active ses tests d'abord ; un échec repart au developer.

### 4.1 Fichiers partagés : qui les modifie

| Fichier | Propriétaire | Règle |
|---|---|---|
| `content-types/attendee/schema.json` | lot 8, premier commit | `hostedTableNumber` (integer, `min: 1`) seulement, dans les 10 premières minutes |
| `services/mailer.js` | lot 8 | transmet `attachments` (A-33) |
| `services/meetings.js` | lot 8 | `cancelForAttendee` (R-18) conservé |
| `services/me.js`, `controllers/me.js` | lot 9 | |
| `lib/cards.js` | lot 9, premier commit | lots 8 et 14 l'importent, ne le modifient pas |
| `config/cron-tasks.js` | lot 8 (`espaceMeetingExpiry`, `*/5`), puis lot 14 (`espaceMessageNotify`, `*/5`) | lot 14 après le dernier commit du lot 8 |
| `routes/auth.js`, `lib/time.js`, `lib/mail/{layout,render}.js`, `strapi/src/index.js`, `strapi/mcp/content-types.json`, `web/astro.config.mjs`, `package.json` et lockfiles | personne | |
| `web/src/lib/espace/{api,client,format}.ts`, `web/src/styles/espace.css`, `web/src/middleware.ts` | lot 10 | `middleware.ts` : `img-src` seulement (A-35) |
| `web/src/lib/espace/meetings.ts` | lot 11 | le lot 10 en importe les types pour E1 |
| `strapi/scripts/espace/seed.js`, `fixtures/recette.json` | lot 12 | garde `isSeedAllowed` et refus intacts |
| `strapi/tests/**`, `web/tests/**`, `web/playwright.config.ts`, `strapi/tests/SPEC.md` | tester (13, puis 16) | |
| `docs/espace/**` | architecte | écarts dans le compte rendu du lot |

Même arbre de travail pour tous : le code d'un autre lot est visible dès qu'il est écrit. Un fichier s'écrit complet en un appel, routes en dernier (un contrôleur absent fait tomber Strapi). Un Strapi qui ne démarre plus à cause d'un autre lot : attendre son commit suivant, ne jamais corriger son fichier. Commits : `git -C <dépôt> add <fichiers>` puis `git -C <dépôt> commit -m "…" -- <fichiers>` ; push autorisé en fin de lot sur `feat/espace-participant` (mémoire projet), ni PR ni déploiement.

### 4.2 Bases et ports par lot

| Lot | Bases | Strapi, front |
|---|---|---|
| 8, 9, 10, 11, 12, 14, 15 | `strapi_l{N}_e2e` pour les essais, `strapi_l{N}_test` pour `test:integration` | Strapi 1361, 1362, 1363, 1364, 1365, 1366, 1367 dans cet ordre ; front 4361 à 4367, même rang |
| 13 | `TEST_DATABASE=strapi_l13_test E2E_DATABASE=strapi_l13_e2e` | `E2E_STRAPI_PORT=1358 E2E_WEB_PORT=4342` |
| 16 | défauts (`strapi_test`, `strapi_e2e`) | 1348, 4332 |

Essai manuel d'un lot (exemple du lot 8, une ligne chacune) : `docker exec jib-postgres createdb -U strapi strapi_l8_e2e` ; `DATABASE_NAME=strapi_l8_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi seed` ; `PORT=1361 DATABASE_NAME=strapi_l8_e2e DEMO_SEED=false PUBLIC_URL=http://localhost:4361 CORS_ORIGINS=http://localhost:4361 ORGANIZER_EMAILS=organisation@example.org EMAIL_OUTBOX_FILE=.tmp/outbox-l8.jsonl corepack pnpm@12.15.0 --dir <dépôt>/strapi develop`. Front : `STRAPI_URL=http://localhost:1361 REACT_STRAPI_URL=http://localhost:1361 corepack pnpm@12.15.0 --dir <dépôt>/web dev --port 4361`. Si deux `develop` se gênent, arrêter le sien et passer par les tests. Bases jetables supprimées en fin de lot (`dropdb`). Les developers ne lancent pas `test:e2e` ; deux `web build` simultanés peuvent se croiser : relancer.

### Lot 8 (developer) : rendez-vous

Exigences : R-10 à R-19, R-03, F-50, F-52, F-56, F-57, F-60 à F-65, I-40, I-41, E10, A-27 à A-33, T-14 à T-26.
Fichiers : attendee `schema.json` (premier commit), `lib/{meetings,ics}.js`, `services/{meetings,mailer}.js`, `controllers/meetings.js`, `routes/meetings.js`, `lib/mail/templates/{meeting-request,meeting-accepted,meeting-declined}.js`, `config/cron-tasks.js`. Interdits : tests, `package.json`, fichiers des autres lots.
Critères :
1. Routes de 3.2 du lot 8, formes et codes exacts ; `routes:list` les montre, aucune route CRUD.
2. T-17 : 20 acceptations simultanées sur un créneau à 3 tables donnent 3 `accepted` (tables 1 à 3), les autres `NO_TABLE_LEFT`, aucun 500. T-25 : deux réservations simultanées de la même table dédiée, une seule réussit, l'autre `TARGET_BUSY`. T-26 : table 2 dédiée, 1-to-1 en tables 1 et 3, puis `NO_TABLE_LEFT`.
3. R-15 selon A-30, contre-proposition selon A-31, R-14 (exposant à 2 représentants : 2 acceptations, la 3e `TARGET_BUSY`).
4. E-mails selon A-33 dans la boîte de sortie, après la transaction ; .ics joint à `meeting-accepted` ; `/meetings.ics` lisible par un agenda (Europe/Paris).
5. `expirePending({ now })` passe en `expired` les `pending` d'une édition dont la fenêtre est close ; tâche `*/5` enregistrée seulement avec `CRON_ENABLED=true`.
6. Aucune réponse ne révèle avec qui la cible a rendez-vous (R-12), ni e-mail (R-42). Règles communes de la phase 1 (lot 2, point 10).
Test : `TESTS_FIRST_STRICT=8 corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit`, puis `TESTS_FIRST_STRICT=8 TEST_DATABASE=strapi_l8_test corepack pnpm@12.15.0 --dir <dépôt>/strapi test:integration`.

### Lot 9 (developer) : profil, annuaire, suggestions

Exigences : F-30 à F-32, F-40 à F-44, F-23, F-24 (compteurs), R-30, R-31, R-40 à R-43, R-50, A-26, A-29 (affichage), A-34 à A-36, T-10 à T-13.
Fichiers : `lib/{cards,profile,directory,suggestions}.js` (`cards.js` en premier commit), `services/{me,directory}.js`, `controllers/{me,directory}.js`, `routes/directory.js`.
Critères :
1. `GET /me` complet (A-36) ; `PATCH /me` étendu ; `profileCompletion` conforme à R-30 sur le seed.
2. T-10 : un participant sans case cochée absent de l'annuaire et des suggestions. T-11 : `q=econ` trouve les profils du sujet « Économie circulaire ». T-12 : fiche d'un non consentant 404 sans lien ; 200 pour qui a un rendez-vous avec lui. T-13 : aucune réponse ne contient `email`, `helloassoItemId` ni `helloassoOrderId`.
3. Organisateurs jamais listés ; intervenant à table dédiée listé selon A-29 ; représentants d'un exposant visibles sur sa fiche selon leurs propres cases.
4. Photo : un PNG de 256 px enregistré, l'ancienne supprimée ; un fichier texte renommé `.jpg` refusé `PHOTO_INVALID`.
Test : `TESTS_FIRST_STRICT=9`, mêmes commandes que le lot 8, base `strapi_l9_test`.

### Lot 10 (developer) : front coquille, E1, E3, E4

Exigences : F-20 à F-24, F-30 à F-32, F-40 à F-44, F-12, NF-20, NF-30, NF-40, A-35, A-36.
Fichiers : premier commit de 3.4, puis `components/espace/{AppShell,ProgressBar,EmptyState}.astro`, `pages/espace/[edition]/{index,profil}.astro`, `pages/espace/[edition]/annuaire/index.astro`, `react-components/espace/{ProfileCardView,ProfileForm,DirectoryBrowser}.tsx`, `lib/espace/{api,client,format}.ts`, `styles/espace.css`, `middleware.ts` (`img-src`).
Critères :
1. E1 : « J-n » en jours de Paris, « Aujourd'hui », puis « Merci de votre participation » ; carte profil masquée à 100 % ; prochain rendez-vous selon F-22 ; suggestions masquées si vides ; badges.
2. E3 : champs, compteur de 280, 0 à 3 sujets, cases de E2 (`PUT /me/consent`), préférences, « Profil enregistré », erreurs sous chaque champ, photo recadrée (A-35), lien vers la fiche de l'exposant (F-32), « Me déconnecter » (formulaire).
3. E4 : recherche temporisée 250 ms dès 2 caractères, sélecteur segmenté, puces de sujets, compteur, défilement par 30, état vide F-44.
4. Sans session : E0 ; sans consentement : E2 (règles du lot 6). Tokens de `07` seulement, aucun tiret cadratin, îlot de 80 Ko compressés au plus.
Test : `corepack pnpm@12.15.0 --dir <dépôt>/web build`, puis parcours manuel avec Léa (section 5).

### Lot 11 (developer) : front E5, E6

Exigences : F-50 à F-57, F-60 à F-66, R-12, R-19 (réservation), A-31, A-33.
Fichiers : `lib/espace/meetings.ts` (premier commit), `pages/espace/[edition]/annuaire/[type]/[id].astro`, `pages/espace/[edition]/agenda.astro`, `react-components/espace/{SlotPicker,AgendaBoard,MeetingStatus}.tsx`.
Critères :
1. E5 : en-tête de fiche (personne ou exposant et stand), séances de l'intervenant, grille par pause, aucun créneau présélectionné, « Choisissez un créneau » puis « Envoyer la demande pour {heure} » (« Réserver {heure} » en mode `booking`, lieu « Stand n » en mode `stand`), message de 300, succès « Demande envoyée à {prénom} », états `blocked` (F-53 à F-55, `HOST_AT_TABLE`), F-56 avec rafraîchissement, lien « Écrire un message » si `canMessage` (A-37). Créneau indisponible : barré, `aria-disabled`, libellé pour lecteur d'écran.
2. E6 : bouton « Calendrier » (`/meetings.ics`), demandes reçues (Accepter, Proposer un autre créneau par `SlotPicker` en mode contre-proposition, Refuser), frise sessions et rendez-vous, demandes envoyées, historique `closed`, confirmation avant annulation, état vide F-66, `?demande={id}` met la demande en évidence. Les boutons suivent les `can*` du serveur, sans règle recalculée.
Test : `corepack pnpm@12.15.0 --dir <dépôt>/web build`, puis Léa accepte la demande d'Inès (section 5).

### Lot 12 (developer) : seed de démonstration

Fichiers : `strapi/scripts/espace/seed.js`, `fixtures/recette.json`. Rien d'autre ; garde du seed intacte ; dates fixes ; aucun e-mail ni EmailLog nouveau.
Contenu ajouté (créneaux désignés par leur libellé, uniques dans l'édition ; Antoine Vergnes `hostedTableNumber: 2`, donc lot commun tables 1 et 3) :

| # | Demandeur → cible | Créneau | Statut | Lieu |
|---|---|---|---|---|
| 1 | Léa Ducasse → Mathis Lagrange | 10h45 | accepted | Table 1 |
| 2 | Hugo Peyrat → Antoine Vergnes (réservation) | 10h45 | accepted | Table 2 |
| 3 | Léa → Sylvadour, répondu par Benoît Tastet | 12h30 | accepted | Stand 4 |
| 4 | Inès Castaing → Léa, message « Bonjour Léa, échangeons sur la construction bois. » | 13h00 | pending | |
| 5 | Léa → Hélène Marquès | 15h30 | pending | |
| 6 | Jules Mazères → Léa, refusé par Léa | 13h15 | declined | |
| 7 | Eva Cazaux → Nathan Lasserre | 11h00 | cancelled | |
| 8 | Alice Fourcade → Résinéo | 15h45 | pending | |

Conversations : Léa et Mathis, trois messages (Mathis, puis Léa, lus ; Mathis « J'apporterai nos échantillons de panneaux. », non lu de Léa) ; Inès et Léa, un message d'Inès non lu. Présentation de 1 à 2 phrases pour Léa, Mathis, Inès, Antoine et Benoît. `tableKey` des rendez-vous à table selon A-27. Le résumé final compte rendez-vous et messages.
Critères : deux exécutions donnent les mêmes comptes ; les règles de `lib/meetings.js` ne trouvent aucune incohérence dans l'instantané (aucune table en double, R-11.5 à 7 respectées) ; sur `strapi_l12_e2e`, synchronisation sur le faux toujours à 0, 0, 0.
Test : `DATABASE_NAME=strapi_l12_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi seed`, deux fois.

### Lot 13 (tester) : tests d'abord

Exigences : T-10 à T-26, R-10 à R-19, R-30, R-31, R-40 à R-43, R-50, NF-01 sur chaque route nouvelle, A-27 à A-36.
Fichiers : nouveaux fichiers sous `strapi/tests/` dès maintenant ; `SPEC.md`, `helpers/*`, `integration/api.test.js`, `unit/{fixtures,conventions}.test.js` et `integration/seed.test.js` seulement après le commit de la porte de la phase 1.
- `helpers/pending.js` : `TESTS_FIRST_STRICT=8` rend stricts les seuls groupes `pending('lot 8')` ; `1` les rend tous stricts. Premier commit, les developers s'en servent.
- Unitaires de chaque fonction de 3.1, avec l'ordre des contrôles de `checkRequest`, A-29, A-30, A-32 ; `buildCalendar` (CRLF, pliage, échappement, TZID, `UID` stable).
- Intégration : T-10 à T-26, dont T-17 et T-25 en concurrence réelle, T-24 (403), cloisonnement entre éditions (404), aucun e-mail dans les réponses ; `api.test.js` : liste des routes étendue à 3.2 (contrôle « déclarées incluses dans la liste »), et les assertions actuelles sur `/api/espace/meetings` (404) remplacées par 401 sans session.
- Contenus du seed du lot 12 dans `seed.test.js` et `fixtures.test.js`.
- e2e (`web/tests/e2e/`) : parcours Léa (E1, E4, E5 demande, E6) et Inès (acceptation), groupe `pending('lot 11')`.
Critères : suite en code 0 à tout moment ; chaque test cite son exigence et son lot d'activation dans `SPEC.md`.
Test : `TEST_DATABASE=strapi_l13_test E2E_DATABASE=strapi_l13_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi test`.

### Lot 14 (developer) : back E7, E8, E9

Exigences : R-61 à R-64, F-70 à F-74, F-80, F-81, F-90, A-29 (avertissements), A-37, T-30 à T-32, T-42.
Fichiers : `lib/messages.js`, `services/{conversations,program,stats}.js`, `controllers/{conversations,program,stats}.js`, `routes/{messages,program}.js`, `lib/mail/templates/new-message.js`, `config/cron-tasks.js` (après le lot 8).
Critères : T-30 (403 `TARGET_UNAVAILABLE`), T-31 (un seul `new-message` en 30 min, par `notifyMessages({ now })`), T-32 (429 au 31e) ; un tiers reçoit 404 sur une conversation (R-63) ; programme trié sur l'heure analysée, séquences sans heure dans `notes` ; T-42 (403 pour un participant sur les statistiques) ; statistiques égales aux comptes en base.
Test : `TESTS_FIRST_STRICT=14` avec la base `strapi_l14_test`, mêmes commandes que le lot 8.

### Lot 15 (developer) : front E7, E8, E9

Exigences : F-70 à F-74, F-80, F-81, F-90, NF-31 (E8 sans JavaScript), A-37.
Fichiers : `pages/espace/[edition]/{programme,organisateur}.astro`, `pages/espace/[edition]/messages/{index,[id],nouveau}.astro`, `react-components/espace/{ChatThread,OrganizerPanel}.tsx`, `lib/espace/{messages,admin}.ts`.
Critères : E8 public, onglets Journée, Intervenants, Infos pratiques par ancres, « Prendre RDV » vers l'annuaire, ou vers E0 sans session, coquille seulement avec session. E7 : liste, fil, bulles, « Lu », compteur au-delà de 1 800, interrogation de 20 s suspendue onglet masqué, bandeau du rendez-vous lié. E9 : indicateurs, remplissage par créneau, exposants sollicités, avertissements, « Synchroniser maintenant » et historique (routes de la phase 1), 403 pour un participant.
Test : `corepack pnpm@12.15.0 --dir <dépôt>/web build`.

### Lot 16 (tester) : vérification de la soirée

À chaque lot livré : retirer `pending` de son groupe, lancer la suite, rapporter les échecs au developer avec reproduction. À la fin : `strapi test` en code 0, `test:e2e` vert, `test:visual` 4 sur 4 (pages publiques intactes), parcours de la section 5 rejoué sur une base `_e2e` à soi, captures 390 et 1280 px des écrans E1 à E9 dans le dossier temporaire de session pour le designer (relecture après ce soir). Rapport : comptes, durées, défauts ouverts classés bloquant, majeur, mineur.

## 5. Recette locale de ce soir (Mathieu)

Commandes vérifiées dans `strapi/package.json`, `web/package.json` et le `Makefile`, une par terminal ou par ligne. `<dépôt>` = chemin du dépôt (`docs/espace/CLAUDE.md`).

1. Postgres : `make -C <dépôt> infra-up` (le conteneur `jib-postgres` tourne déjà en général).
2. Base de démonstration (A-38), une fois : `docker exec jib-postgres createdb -U strapi strapi_demo_e2e`.
3. Seed, à relancer pour repartir de zéro : `DATABASE_NAME=strapi_demo_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi seed`.
4. Faux HelloAsso, pour le bouton « Synchroniser maintenant » d'E9 : `corepack pnpm@12.15.0 --dir <dépôt>/strapi helloasso:fake` (port 4010).
5. Strapi : `DATABASE_NAME=strapi_demo_e2e DEMO_SEED=false ORGANIZER_EMAILS=organisation@example.org HELLOASSO_API_BASE=http://localhost:4010/v5 HELLOASSO_CLIENT_ID=fake-client-id HELLOASSO_CLIENT_SECRET=fake-client-secret corepack pnpm@12.15.0 --dir <dépôt>/strapi develop`. Sans `NODE_ENV=production` ni `EMAIL_PROVIDER`, les e-mails ne partent pas : fournisseur `console`.
6. Front : `corepack pnpm@12.15.0 --dir <dépôt>/web dev` (`web/.env` pointe déjà sur `http://localhost:1337`).
7. Ouvrir `http://localhost:4321/espace/nouvelle-aquitaine-test/connexion`, saisir une adresse ci-dessous.
8. Lien magique : dans le terminal de Strapi, ligne `[mail:console] to=… subject="…" links=http://localhost:4321/espace/verifier?token=…` ; ou dans `<dépôt>/strapi/.tmp/mail-outbox.jsonl` (une ligne JSON par e-mail, la dernière est la plus récente, .ics en base64). Ouvrir le lien, puis « Ouvrir mon espace ». Pour changer de compte : « Me déconnecter » dans E3, ou une fenêtre privée par compte (même cookie `localhost` pour les ports 4321 et 1337).
9. Back-office (tables dédiées, rôles) : `http://localhost:1337/admin`, créer le compte administrateur au premier passage sur cette base.

| Compte (`@example.org`) | Pour tester |
|---|---|
| `lea.ducasse` | E1 complet, demande reçue d'Inès (accepter : e-mail `meeting-accepted` et .ics pour Inès dans la boîte de sortie), demande envoyée à Hélène, refus de Jules dans l'historique, 2 messages non lus, annuaire, nouvelle demande |
| `ines.castaing` | voir l'acceptation ; contre-proposition si Léa propose un autre créneau |
| `hugo.peyrat`, puis un autre participant | table dédiée d'Antoine (table 2) : réservation directe, créneau 10h45 déjà pris |
| `antoine.vergnes` | côté intervenant à table dédiée : réservations reçues, aucune demande possible (`HOST_AT_TABLE`) |
| `benoit.tastet`, `pierre.haurie` | représentants : demande d'Alice à Résinéo, réponse au nom du stand |
| `clara.dubourdieu` | aucun consentement : invisible dans l'annuaire, peut demander |
| `tom.laffitte` | jamais activé : passage par E2 |
| `organisation@example.org` | E9 (après E2), synchronisation sur le faux : 0, 0, 0 |

Fenêtre de rendez-vous du seed : ouverte du 1er octobre au 2 décembre, donc ouverte ce soir. Expiration et notifications de messages ne tournent pas en local (`CRON_ENABLED=false`) : elles sont couvertes par les tests.

## 6. Questions pour Mathieu

1. **Base du soir** : `strapi_demo_e2e` plutôt que `strapi_e2e`, que chaque `test:e2e` vide (A-38). Par défaut : `strapi_demo_e2e`.
2. **Contre-proposition vers un exposant ou une table dédiée** : non proposée en v1, le représentant refuse et écrit (A-31). Par défaut : non.
3. **Photo sous Safari** : JPEG 256 px au lieu de WebP, faute de `sharp` en dépendance directe (A-35). Par défaut : JPEG accepté, `sharp` non ajouté.

## 7. À reprendre ensuite

- Report des formes livrées dans `06-api.md`, compte rendu `phase-2.md`, revue de l'architecte des lots 8 à 15 (doublons, écarts au contrat).
- Portes formelles des phases 2 et 3 : couverture des branches R-10 à R-18, Lighthouse, axe, revue du designer sur les captures du lot 16, T-50 sur le serveur de dev.
- Phase 3 restante : relances R-70 à R-72, exports F-91, F-92, PWA, I-13 ; F-33 et R-44 ; I-42 ; F-45, F-75.
