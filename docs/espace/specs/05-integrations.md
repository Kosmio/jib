# 05. Intégrations

## HelloAsso (I-1x)

API v5, base `https://api.helloasso.com/v5`, bac à sable `https://api.helloasso-sandbox.com/v5`, authentification OAuth 2.0 *client credentials*. Documentation : https://dev.helloasso.com/docs/api-overview et Swagger `https://api.helloasso.com/v5/swagger`. **Développer et tester contre le bac à sable**, basculer en production par variable d'environnement.

- **I-10 (P0) Jeton.** Obtention et renouvellement automatique du jeton d'accès, mis en cache jusqu'à expiration moins 60 s. Identifiants en variables d'environnement `HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET`, `HELLOASSO_API_BASE`.
- **I-11 (P0) Import complet.** `GET /organizations/{organizationSlug}/forms/{formType}/{formSlug}/items` paginé (jeton de continuation), avec les champs personnalisés. Un *item* = un billet = un Attendee. Correspondance :
  | HelloAsso | Attendee |
  |---|---|
  | `id` de l'item | `helloassoItemId` |
  | `order.id` | `helloassoOrderId` |
  | `user.firstName`, `user.lastName` (le bénéficiaire du billet, pas le payeur) | `firstName`, `lastName` |
  | e-mail du bénéficiaire (champ personnalisé ou `payer.email` à défaut) | `email` |
  | champs personnalisés « Fonction », « Entreprise » ou « Structure » | `jobTitle`, `company` |
  | `state` de l'item ou de la commande (annulé, remboursé) | `status = cancelled` |
  | intitulé du tarif (`name`) contenant « Exposant » ou « Intervenant » | `role` proposé, à confirmer par l'organisateur |
  Les libellés exacts des champs personnalisés sont **à relever sur le formulaire réel** en phase 0 et paramétrés dans Edition (`helloassoFieldMap`, json), jamais en dur. Relevé pour Nouvelle-Aquitaine : voir Q-03 dans `11-questions-ouvertes.md`.
- **I-12 (P0) Synchronisation.** Tâche planifiée toutes les 15 minutes plus bouton manuel (F-90). Idempotente par `helloassoItemId`. Crée les nouveaux inscrits (puis e-mail `welcome`), met à jour les champs non édités (R-31), passe les annulés en `cancelled` (R-18). Chaque exécution écrit un SyncRun.
- **I-13 (P1) Notifications.** Route `POST /api/espace/webhooks/helloasso` recevant les notifications de type Order ; elle ne fait pas confiance au contenu reçu : elle déclenche une resynchronisation ciblée de la commande (`GET /orders/{orderId}`). URL configurée côté HelloAsso par l'organisateur.
- **I-14 (P0) Doublons.** Même e-mail sur deux billets d'une même édition : un seul Attendee (le premier), le second item est rattaché dans `SyncRun.errors` pour arbitrage organisateur.
- **I-15 (P0)** La billetterie, le paiement et le formulaire HelloAsso ne sont pas modifiés par l'application. Seule demande à Xylofutur : ajouter les champs personnalisés manquants (fonction, entreprise), les rattacher à tous les tarifs, et une phrase d'information sur l'espace participant dans la description de la billetterie.

## Connexion par lien magique (I-2x)

- **I-20 (P0)** Jeton aléatoire de 32 octets, encodé base64url, stocké haché (SHA-256) dans MagicToken, valable 30 minutes, à usage unique. Lien : `{PUBLIC_URL}/espace/verifier?token=…`.
- **I-21 (P0)** Les liens d'action contenus dans les autres e-mails portent un jeton du même type valable 72 heures, à usage unique, avec redirection vers la page visée (paramètre `next` limité aux chemins `/espace/…`).
- **I-22 (P0)** Session : cookie `HttpOnly`, `Secure`, `SameSite=Lax`, signé, durée 30 jours glissants, contenant l'identifiant de session ; révocation à la déconnexion. Si le front Astro et Strapi ne partagent pas le domaine, l'architecte choisit entre proxy Astro et cookie sur le domaine parent, et documente le choix dans CLAUDE.md.
- **I-23 (P0)** Organisateurs : même mécanisme, rôle porté par l'Attendee (`role = organizer`) ou par une liste d'e-mails autorisés en variable d'environnement `ORGANIZER_EMAILS`.

## E-mails (I-3x)

- **I-30 (P0)** Interface `MailProvider.send({ to, template, data, attachments })`. Implémentation par défaut Brevo (API transactionnelle, hébergement UE), clé `MAIL_API_KEY`, expéditeur `MAIL_FROM`. Implémentation `ConsoleMailProvider` pour le développement et les tests (écrit dans un fichier ou la console).
- **I-31 à I-39 (P0)** Gabarits listés en E10, écrits en HTML simple avec styles en ligne, rendus côté serveur, version texte générée. Chaque envoi est journalisé dans EmailLog.
- **I-39 (P0)** En-têtes `List-Unsubscribe` sur les relances ; lien « Gérer mes notifications » vers E3.

## Calendrier (I-4x)

- **I-40 (P0)** Export `.ics` (RFC 5545) : un VEVENT par rendez-vous accepté (titre « RDV {nom} · JIB », lieu « {location}, {venue} », description avec lien vers l'agenda) et par session du programme, fuseau Europe/Paris, `UID` stable par objet.
- **I-41 (P0)** Pièce jointe .ics dans l'e-mail `meeting-accepted`.
- **I-42 (P1)** Flux d'abonnement personnel `/api/espace/calendar/{token}.ics` à jeton révocable.
