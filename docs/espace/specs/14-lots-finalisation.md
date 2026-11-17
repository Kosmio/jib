# 14. Lots de finalisation

Spécification des développements qui terminent l'espace participant et corrigent les défauts de l'audit du 17 novembre 2026 (`docs/espace/journal/2026-11-17-audit-ux-et-plan.md`). Le mode d'exécution (branches, propriété des fichiers, intégration) est dans `13-orchestration.md`.

Abréviations : `E/` = `strapi/src/api/espace/`, `W/` = `web/src/`, `P/` = `web/src/pages/espace/`, `R/` = `web/src/react-components/espace/`.
Efforts : S moins de 2 h, M une demi-journée, L un jour ou plus.
Identifiants nouveaux : F-100 à F-152, R-85 à R-90, I-44, NF-58 à NF-70, T-70 à T-73, D-12 à D-18, A-39. Les identifiants antérieurs gardent leur sens.

## Vue d'ensemble

| Vague | Dates | But | Lots |
|---|---|---|---|
| 1 | mercredi 18 novembre | pouvoir ouvrir sans casse | V1-A, V1-B, V1-C, V1-D, V1-E |
| 2 | jeudi 19 au matin | recette propre | V2-A, V2-B, V2-C, V2-D, V2-E, V2-Q |
| 3 | 23 au 26 novembre | relances et outils du jour J | V3-A, V3-B, V3-C, V3-D, V3-E, V3-F, V3-G |
| 4 | 27 novembre au 2 décembre | confort du jour J | V4-A, V4-B, V4-C, V4-D, V4-E, V4-F |
| 5 | après le 3 décembre | conformité et suite | V5-A à V5-G |

Les lots d'une même vague n'ont aucun fichier en commun et se développent en parallèle, trois à la fois. Ordre d'intégration dans une vague : celui du tableau, sauf dépendance indiquée. Si le temps manque, on reporte en commençant par la fin de la vague ; V1-A à V1-D ne se reportent pas.

Dépendances entre vagues :

```
V1-C (structure du pilotage) ──> V2-D, V3-B, V3-E, V3-F
V1-C (journal d'e-mails avec motif) ──> V3-A, V3-E
V1-B (accès) ──> V3-G
V3-A (relances) ──> V3-B, envoi du 27 novembre
V1-D (gardes) ──> V3-F
```

## Tâches humaines, hors agents

| # | Tâche | Qui | Pour le |
|---|---|---|---|
| H-1 | Valeurs de prod : `EMAIL_FROM`, `ORGANIZER_EMAILS`, secrets `SECRET_EMAIL_API_KEY` et `SECRET_HELLOASSO_CLIENT_SECRET` de l'environnement `prod`, `SECRET_ADMIN_RESET` vide | Mathieu, avec Xylofutur | 19/11 |
| H-2 | Domaine d'envoi vérifié dans Brevo (SPF, DKIM), premier envoi réel, rendu Gmail et Outlook | Mathieu | 19/11 |
| H-3 | Essai HelloAsso réel sur preprod : pagination, doublons d'e-mail, champs Organisation et Poste | Mathieu | 19/11 |
| H-4 | Réglages Strapi de prod : pauses en `b2b_break`, formulaire HelloAsso, tables, fenêtre, sujets, exposants, tables dédiées, régénération des créneaux | Mathieu, avec Xylofutur | 19/11 |
| H-5 | Essai sur iPhone (Safari, lien ouvert depuis Gmail et Outlook) et Android : parcours T-50, photo, installation. Tranche D-17 | Mathieu | 19/11 |
| H-6 | Texte de confidentialité validé et publié, validation de D-14 | Xylofutur | 19/11 |
| H-7 | Sauvegarde avant bascule, déploiement, première synchronisation, envoi des `welcome` depuis le pilotage | Mathieu | 20/11 |
| H-8 | Export participants ouvert dans Excel FR (T-41) | Mathieu | 19/11 |

---

# Vague 1 : pouvoir ouvrir sans casse

## V1-A. Déploiement sûr

**Effort** M. **Dépend de** rien. Infrastructure seulement, aucun code applicatif.

**Exigences**
- **NF-58 (P0)** Le workflow `Deploy` refuse `reset_db` quand `environment = prod` : l'étape échoue avant toute connexion SSH, avec un message clair.
- **NF-59 (P0)** Sauvegarde : un script `infra/deploy/scripts/backup.sh <environnement>` fait un `pg_dump` compressé de la base et une archive des téléversements, horodatés, dans un dossier du serveur hors des volumes Docker, et garde les 14 plus récents. Le workflow l'appelle avant tout déploiement en prod (échec de sauvegarde = déploiement arrêté). Une entrée de planification quotidienne à 3h00 est installée par le script en mode `install-cron`, de façon idempotente. La restauration est documentée pas à pas.
- **NF-60 (P0)** `EMAIL_FROM`, `ORGANIZER_EMAILS` et `LINK_RATE_IP_MAX` sont alimentés par les variables GitHub de l'environnement (`vars.*`) dans le fichier fusionné, à la manière de `EMAIL_LIST_ID`. En prod, le déploiement échoue avant le transfert si `EMAIL_FROM` ou `ORGANIZER_EMAILS` est vide.
- **D-15** `VERSION` passe à `0.2.0` ; `JIB_VERSION` des overlays dev et prod suit ; preprod garde son suffixe `-preprod`.

**Fichiers possédés** `.github/workflows/deploy.yml`, `infra/deploy/**`, `VERSION`, `docs/espace/exploitation.md` (nouveau : sauvegarde, restauration, ouverture, liste des variables de prod).

**Critères d'acceptation**
1. `reset_db` coché sur prod : le run échoue à une étape nommée « Refuse reset on prod », sans SSH.
2. `dry_run` sur prod avec `EMAIL_FROM` vide : échec explicite ; renseigné : succès.
3. `backup.sh` lancé deux fois produit deux archives distinctes ; la quinzième supprime la plus ancienne ; `install-cron` lancé deux fois ne crée qu'une entrée.
4. `make -C <dépôt> infra-validate` et `make -C <dépôt> lint` passent.

**Tests** Le testeur relit le workflow et exécute `backup.sh` contre le Postgres local avec une base `*_test`. Aucun déploiement réel.

## V1-B. Accès robustes

**Effort** M. **Dépend de** rien.

**Exigences**
- **NF-61 (P0, D-16)** La demande de lien garde 5 demandes par 15 min par adresse e-mail et passe à `LINK_RATE_IP_MAX` (défaut 60) par adresse IP. La valeur est lue dans la configuration de l'espace, jamais en dur.
- **F-100 (P0)** `/espace/{edition}/connexion` avec une session valable pour cette édition redirige (303) vers `next` s'il est fourni et interne à `/espace/{edition}/`, sinon vers l'accueil de l'édition. Aucun lien n'est émis.
- **F-101 (P0)** `/espace/verifier` : si le jeton est invalide, expiré ou déjà utilisé **et** qu'une session valable existe pour l'édition visée par `next`, redirection (303) vers `next`. Sans session, l'écran actuel « Ce lien n'est plus valable » reste, avec le formulaire.
- **F-102 (P0)** `next` survit à une nouvelle demande de lien : le formulaire le transmet, l'API le valide (chemin interne à l'espace de l'édition, sinon ignoré) et le lien envoyé le porte.
- **F-103 (P0)** Un organisateur (rôle `organizer` ou adresse de `ORGANIZER_EMAILS`) peut demander un lien, se connecter et utiliser les routes `/admin/{edition}/*` et `/espace/{edition}/organisateur` quand `participantSpaceEnabled = false`. Les autres écrans de l'espace lui restent fermés, avec un renvoi vers le pilotage. Le comportement des participants ne change pas.
- **F-104 (P1)** Une réponse 401 reçue par un îlot redirige vers `/connexion?next=<page courante>&expire=1` ; la page de connexion affiche alors « Votre session a expiré, demandez un nouveau lien ».
- L'état « Lien envoyé » rappelle l'adresse saisie (échappée) ; « Demander un nouveau lien » la préremplit.

**Fichiers possédés** `E/services/auth.js`, `E/controllers/auth.js`, `E/lib/guards.js`, `strapi/config/server.js`, `P/[edition]/connexion.astro`, `P/verifier.astro`, `W/components/espace/RequestLinkForm.astro`, `W/lib/espace/api.ts`, `W/lib/espace/client.ts`.

**Réalisation** La variable `LINK_RATE_IP_MAX` est déclarée dans le déploiement par V1-A ; ce lot ne fait que la lire, avec sa valeur par défaut. La validation de `next` est une fonction pure réutilisée par F-100 à F-102. F-103 : la garde d'édition fermée laisse passer un organisateur ; rien d'autre ne change dans `auth.js`.

**Critères d'acceptation**
1. Soixante demandes pour soixante adresses depuis une même IP sont admises, la soixante et unième est refusée ; six demandes pour une même adresse : la sixième est refusée.
2. Session active, `/connexion` répond 303 vers l'accueil ; avec `next=/espace/<edition>/agenda`, 303 vers l'agenda ; avec `next=https://exemple.org`, 303 vers l'accueil.
3. Session active et jeton déjà consommé : `/espace/verifier?token=…&next=/espace/<edition>/agenda` répond 303 vers l'agenda. Sans session : écran « plus valable ».
4. Lien redemandé depuis cet écran : l'e-mail porte le même `next`.
5. Espace fermé : un organisateur obtient un lien et atteint le pilotage ; un participant reçoit la réponse actuelle.
6. Cookie `Secure` : aucun 500 sur un appel interne en http (garde A-25 conservée).

**Tests** intégration `espace-acces-robuste.test.js`, bout en bout `espace-acces-robuste.spec.ts`.

## V1-C. Ouverture contrôlée et état du service

**Effort** L. **Dépend de** rien. Pose la structure du pilotage dont dépendent V2-D, V3-B, V3-E, V3-F.

**Exigences**
- **A-39** `OrganizerPanel.tsx` devient un assembleur. Chaque carte est un composant de `R/organizer/` : `SyncCard`, `StatsCards`, `SlotsCard`, `ExhibitorsCard`, `ExportsCard`, `WarningsCard`, `SyncHistory`, et les nouveaux `ServiceCard`, `WelcomeCard`. Trois composants vides sont créés et déjà montés, à remplir par la vague 3 : `RemindersCard`, `AttendeesCard`, `MeetingsCard`. Chaque carte reçoit `{ edition, strapiUrl }` et charge ses propres données. Aucun changement visuel sur les cartes existantes.
- **F-105 (P0)** Les `welcome` ne partent plus tout seuls à l'ouverture. Carte « E-mail de bienvenue » : nombre d'inscrits actifs jamais invités, aperçu de l'e-mail, bouton « Envoyer à N inscrits », confirmation qui répète N, résultat (envoyés, en échec).
  - `POST /api/espace/admin/{edition}/welcome/preview` → `{ recipients: number, sampleHtml: string }`
  - `POST /api/espace/admin/{edition}/welcome/send` → `{ sent: number, failed: number, startedAt: string }` ; 409 `OUTSIDE_SENDING_HOURS` hors plage.
- **R-85 (P0)** Nouveau champ scalaire `welcomeStartedAt` (date et heure) sur l'édition, posé par le premier envoi. Tant qu'il est vide, la synchronisation n'envoie aucun `welcome`. Une fois posé, la synchronisation invite seule les nouveaux inscrits, uniquement entre 8h00 et 20h00 heure de Paris, et renonce pour un destinataire après 3 échecs consécutifs (il apparaît alors dans la carte « État du service »).
- **NF-62 (P0)** `EmailLog` reçoit un champ texte `error` : première ligne du motif d'échec, 300 caractères au plus, sans donnée personnelle autre que celle du destinataire.
- **F-106 (P0)** Carte « État du service », en tête du pilotage, alimentée par `GET /api/espace/admin/{edition}/service` → `{ mail: { provider, senderConfigured, failedLast24h, lastError }, helloasso: { configured, lastRunStatus, lastRunAt }, cron: { enabled }, space: { enabled, welcomeStartedAt } }`. Chaque anomalie est une ligne rouge avec ce qu'il faut faire. Au démarrage de Strapi, une ligne d'erreur de journal signale un expéditeur absent quand le fournisseur est `brevo` ou `smtp`.

**Fichiers possédés** `R/OrganizerPanel.tsx`, `R/organizer/**` (nouveau), `W/lib/espace/admin.ts`, `E/services/sync.js`, `E/services/mailer.js`, `E/services/welcome.js`, `E/services/service-status.js`, `E/controllers/welcome.js`, `E/controllers/service-status.js`, `E/routes/welcome.js`, `E/content-types/email-log/schema.json`, `strapi/src/api/edition/content-types/edition/schema.json`.

**Réalisation** Le code d'envoi de `sendWelcomes` (`E/services/sync.js`) est déplacé dans `E/services/welcome.js` et réutilisé par la route et par la synchronisation. La synchronisation manuelle n'attend plus la fin des envois. Routes gardées par la garde organisateur existante (`E/lib/guards.js`, en lecture seule pour ce lot).

**Critères d'acceptation**
1. Édition ouverte, `welcomeStartedAt` vide : dix synchronisations n'envoient aucun e-mail.
2. `preview` renvoie le nombre exact d'actifs sans `welcome` envoyé, organisateurs exclus ; `send` les envoie une seule fois ; un second `send` renvoie `sent: 0`.
3. Après le premier envoi, un inscrit importé à 14h00 est invité à la synchronisation suivante ; importé à 22h00, il l'est après 8h00.
4. Un destinataire en échec trois fois n'est plus retenté et figure dans `service.mail`.
5. Expéditeur absent : `service.mail.senderConfigured = false`, ligne rouge à l'écran, `EmailLog.error` renseigné.
6. Participant non organisateur : 403 sur les trois routes.
7. Les captures de bout en bout existantes du pilotage restent vertes après la découpe.

**Tests** unitaire `welcome.test.js`, intégration `espace-welcome.test.js`, bout en bout `espace-pilotage-ouverture.spec.ts`. Mise à jour par le testeur de `espace-seed-sync.test.js` et `espace-sync.test.js`, qui supposent l'envoi automatique. **Revue designer.**

## V1-D. Garde-fous de l'administration

**Effort** M. **Dépend de** rien.

**Exigences**
- **NF-63 (P0)** Strapi refuse, avec un message en français lisible dans l'admin, de supprimer ou de dépublier : un participant, un exposant ou un créneau porteur d'un rendez-vous `pending` ou `accepted` ; une séquence `b2b_break` dont un créneau porte un tel rendez-vous ; une édition qui a des participants.
- **NF-64 (P0)** À l'enregistrement d'une édition : `meetingRequestsCloseAt` dans le passé est refusé quand il existe des demandes `pending` ; `meetingRequestsOpenAt` doit précéder `meetingRequestsCloseAt` ; `tablesCount` ne descend pas sous le plus grand numéro de table déjà attribué ; `slotDurationMinutes` ne change plus dès qu'un rendez-vous existe.
- **NF-65 (P0)** Le `slug` d'une édition ne change plus dès qu'elle a un participant.
- **NF-66 (P0, R-63)** Les types `message`, `conversation`, `magic-token` et `slot` disparaissent du gestionnaire de contenu (`pluginOptions` du schéma). `email-log` et `sync-run` restent visibles. Sur `attendee`, les champs `editedFields`, `emailPrefs`, `unavailableSessions`, `consentAt`, `activatedAt`, `lastSeenAt`, `directoryOptIn`, `meetingsOptIn`, `newsOptIn`, `helloassoItemId`, `helloassoOrderId` sont affichés non modifiables.
- **NF-67 (P0)** Le service des rendez-vous ignore un rendez-vous dont le demandeur, la cible ou le créneau a disparu, au lieu de lever une exception, et le journalise une fois.

**Fichiers possédés** `strapi/src/index.js`, `E/lib/admin-guards.js` (nouveau, fonctions pures de décision), `E/services/admin-guards.js` (nouveau), `E/services/meetings.js`, `E/content-types/{message,conversation,magic-token,slot}/schema.json`.

**Réalisation** Les gardes sont un middleware du Document Service enregistré dans `register()`, qui délègue la décision à des fonctions pures. Aucune relation n'est modifiée (A-15). La configuration « non modifiable » passe par la configuration du gestionnaire de contenu posée à l'amorçage, sur le modèle des libellés existants de `strapi/src/index.js`.

**Critères d'acceptation**
1. Supprimer un participant ayant un rendez-vous accepté : refus, message « Ce participant a des rendez-vous… », données intactes. Sans rendez-vous : suppression admise.
2. Date de fermeture passée avec des demandes en attente : refus ; aucune demande n'expire.
3. Changement de `slug` d'une édition peuplée : refus.
4. Base contenant un rendez-vous au demandeur supprimé (inséré en SQL par le test) : `GET /meetings` répond 200 pour les autres participants.
5. L'API de l'admin ne liste plus `message` dans les types du gestionnaire de contenu.

**Tests** unitaire `admin-guards.test.js`, intégration `espace-admin-gardes.test.js`.

## V1-E. Erreurs lisibles

**Effort** S. **Dépend de** rien. Front seulement.

**Exigences**
- **F-107 (P0, NF-50)** Toute exception ou tout dépassement de délai pendant le rendu d'une page sous `/espace/` produit la page `P/erreur.astro` : barre d'onglets de l'édition si elle est connue, titre « Un incident empêche d'afficher cette page », bouton « Réessayer » (recharge), lien vers l'accueil de l'édition, rappel que les e-mails de confirmation portent l'heure et la table. Statut 503 pour un délai ou une erreur réseau vers Strapi, 500 sinon. L'identifiant de requête est affiché en petit. Les pages publiques ne sont pas concernées.
- **F-108 (P1)** `P/introuvable.astro` propose « Retour à l'accueil de l'espace » quand l'édition est connue de l'URL, en plus du lien vers le site.

**Fichiers possédés** `W/middleware.ts`, `P/erreur.astro` (nouveau), `P/introuvable.astro`.

**Réalisation** Le middleware entoure `next()` d'un `try/catch` pour les seules routes `/espace/` et réécrit vers la page d'erreur ; il conserve les en-têtes de sécurité et le `no-store` actuels. La page d'erreur ne fait aucun appel à Strapi.

**Critères d'acceptation**
1. Strapi arrêté : `/espace/<edition>/agenda` répond 503 avec la page d'erreur, sans trace technique.
2. Les en-têtes de sécurité de `espace-securite.spec.ts` sont présents sur la page d'erreur.
3. Une page publique en erreur garde son comportement actuel.

**Tests** unitaire `web-middleware.test.js` complété, bout en bout `espace-erreurs.spec.ts`.

---

# Vague 2 : recette propre

## V2-A. Accueil et agenda actionnables

**Effort** M. **Dépend de** V1-E.

**Exigences**
- **F-109 (P0)** Accueil : quand il y a des demandes reçues en attente, une carte « N demandes à traiter » passe avant « Prochain rendez-vous », avec le nom du premier demandeur et un bouton vers l'agenda.
- **F-110 (P0)** Accueil : si la lecture des rendez-vous échoue, la carte dit « Vos rendez-vous sont momentanément indisponibles » avec « Réessayer », jamais « Aucun rendez-vous ».
- **F-111 (P0)** Fenêtre de rendez-vous : avant l'ouverture, « Les demandes ouvrent le <date> à <heure> » ; après la fermeture, « Les demandes sont closes depuis le <date> ». Dans cet état, l'accueil masque « Trouver des interlocuteurs » et remplace « Rencontrer » par « Voir la fiche ». Dates en Europe/Paris.
- **F-117 (P0)** Accueil : si `directoryOptIn = false`, bandeau « Vous n'apparaissez pas dans l'annuaire : personne ne peut vous proposer de rendez-vous », avec un lien vers la section de visibilité du profil.
- **F-112 (P0, F-70)** Agenda : chaque carte (demande reçue, envoyée, rendez-vous) porte un lien vers la fiche de l'interlocuteur et, s'il est joignable, un lien « Écrire à <prénom> » vers la conversation.
- **F-113 (P0)** Agenda : les données se rechargent au retour de l'onglet au premier plan et toutes les 60 s tant qu'il est visible, sans perdre un panneau ouvert ni une saisie.
- **F-114 (P1)** « Mes rendez-vous » affiche l'heure de fin et classe « En cours », « À venir », « Passés » le jour de l'événement.
- **F-115 (P1)** Demande de rendez-vous : sous un bouton d'envoi inactif, la raison (« Choisissez un créneau », « Ajoutez un mot de présentation ») ; le message serveur de `SLOT_TAKEN` est affiché tel quel ; le compteur est relié au champ. Dialogue d'annulation : « Non, le garder ». Mon message est réaffiché dans « Demandes envoyées ».

**Fichiers possédés** `P/[edition]/index.astro`, `P/[edition]/agenda.astro`, `R/AgendaBoard.tsx`, `R/SlotPicker.tsx`, `R/MeetingStatus.tsx`, `W/lib/espace/meetings.ts`, `W/lib/espace/format.ts`.

**Critères d'acceptation**
1. Jeu de recette, Léa Ducasse : l'accueil affiche « 1 demande à traiter, Inès Castaing ».
2. API des rendez-vous en échec : texte d'indisponibilité, pas l'état vide.
3. Fenêtre fermée : aucune action de l'accueil ne mène à un formulaire de demande, et la fiche affiche la date de fermeture.
4. Une demande acceptée par l'autre partie apparaît dans l'agenda en moins de 60 s sans action.
5. Chaque carte d'agenda a un lien de fiche dont le nom accessible contient le nom de la personne.
6. Sans JavaScript, l'accueil reste lisible.

**Tests** bout en bout `espace-accueil-agenda.spec.ts`. **Revue designer.**

## V2-B. Consentement compris

**Effort** S. **Dépend de** rien.

**Exigences**
- **F-116 (P0)** Écran de bienvenue : le bloc ne dit plus « facultatifs ». Chaque case porte sa conséquence : annuaire décoché, « Vous ne serez pas visible et ne recevrez aucune demande » ; rendez-vous et messages décoché, « Vous pourrez proposer des rendez-vous, pas en recevoir ». Si « annuaire » est décochée à la validation, une confirmation en ligne propose « Continuer sans apparaître » ou « Apparaître dans l'annuaire ». Aucune case n'est cochée par le code de l'écran : il reflète la valeur reçue du serveur (D-14).
- **F-118 (P1)** Profil : décocher « Recevoir des demandes » ou une plage de disponibilité affiche l'effet sur les demandes en attente. L'échec du second enregistrement de l'écran de bienvenue dit précisément ce qui est déjà enregistré.

**Fichiers possédés** `R/WelcomeForm.tsx`, `R/ProfileForm.tsx`, `P/[edition]/bienvenue.astro`.

**Critères d'acceptation** 1. Valider sans « annuaire » fait apparaître la confirmation, annoncée aux lecteurs d'écran, et le focus s'y place. 2. Le texte « facultatif » a disparu du bloc. 3. Les tests T-10 à T-13 restent verts.

**Tests** bout en bout `espace-consentement.spec.ts`. **Revue designer.**

## V2-C. Administration Strapi lisible

**Effort** M. **Dépend de** V1-D (même fichier, vague précédente).

**Exigences**
- **NF-68 (P0)** Libellé français et texte d'aide pour chaque réglage de l'espace sur l'édition (`participantSpaceEnabled`, `helloassoOrgSlug`, `helloassoFormType`, `helloassoFormSlug`, `helloassoFieldMap`, `slotDurationMinutes`, `tablesCount`, `meetingRequestsOpenAt`, `meetingRequestsCloseAt`, `welcomeStartedAt`) et pour `kind`, `theme`, `subtitle` et les heures des séquences. Les aides disent l'effet et le piège : « Publier pour appliquer », « Vide : fermeture la veille à 18h00 », « Écrire 10h45 ». Les réglages de l'espace sont regroupés en fin de formulaire, dans l'ordre d'usage.
- **NF-69 (P0)** Champ principal et colonnes de liste des types de l'espace : participant par nom (colonnes nom, prénom, entreprise, e-mail, rôle, statut), exposant par organisation, rendez-vous par statut et créneau, journal d'e-mails par gabarit, statut, date et motif.
- **R-86 (P0)** Les heures de séquence acceptent « 10h45 », « 10:45 », « 10 h 45 », « 10H45 » et sont comprises de la même façon. Une heure illisible sur une pause `b2b_break` est refusée à l'enregistrement, avec l'exemple attendu.
- Les libellés s'appliquent aussi au premier démarrage après l'ajout d'un type.
- `docs/espace/guide-organisateur.md` : deux pages pour Xylofutur, préparer une édition, ouvrir l'espace, corriger un inscrit, ce qu'il ne faut pas toucher.

**Fichiers possédés** `strapi/src/index.js`, `E/lib/time.js`, `docs/espace/guide-organisateur.md` (nouveau).

**Critères d'acceptation** 1. La configuration du gestionnaire de contenu lue par l'API d'admin porte les libellés attendus sur une base vide comme sur une base existante. 2. Les quatre écritures d'heure donnent les mêmes créneaux. 3. « 10.45 » sur une pause B2B est refusé.

**Tests** unitaire `time.test.js` complété, intégration `espace-admin-libelles.test.js`.

## V2-D. Pilotage lisible

**Effort** M. **Dépend de** V1-C.

**Exigences**
- **F-119 (P0)** Le lien « Pilotage » est visible pour un organisateur à toutes les largeurs : sixième entrée de la barre d'onglets sous 1024 px, libellés réduits si nécessaire.
- **F-120 (P0)** Carte de synchronisation : le titre reflète le statut de la dernière exécution (« Dernière synchronisation en échec il y a 12 min » en rouge) ; avertissement si la dernière réussite date de plus d'une heure alors que les tâches planifiées sont actives.
- **F-121 (P0, I-14)** Les erreurs d'import sont listées par ligne : nom, e-mail, motif en français, action attendue. Les cas attendus (`WAITING`, `UNKNOWN`) sont des informations repliées, pas des erreurs ; seuls `DUPLICATE_EMAIL`, les échecs de lecture et les erreurs internes sont rouges.
- **F-122 (P1)** « Régénérer les créneaux » demande confirmation avec le nombre de créneaux qui seront créés et supprimés (simulation côté serveur : paramètre `dryRun` de la route existante).
- **F-123 (P0)** Export participants : colonnes ajoutées `Actualités des prochaines éditions`, `Activé le`, `Dernière connexion`, `Statut`, et les annulés en fin de fichier. Noms de fichiers avec l'édition et la date (`participants-<slug>-AAAA-MM-JJ.csv`). Session expirée sur un lien d'export : redirection vers la connexion, pas de JSON.
- **F-124 (P1)** Un organisateur de `ORGANIZER_EMAILS` qui n'a jamais passé l'écran de bienvenue accède directement au pilotage.
- **F-125 (P1)** Indicateurs : « Profils complets » vaut 100 % de complétion ou le libellé dit « à 70 % et plus » ; les totaux par rôle n'incluent pas les annulés ; exports et indicateurs comptent les mêmes rendez-vous (T-40). Les chiffres se rechargent toutes les 60 s quand l'onglet est visible.

**Fichiers possédés** `W/components/espace/AppShell.astro`, `P/[edition]/organisateur.astro`, `R/organizer/{SyncCard,SyncHistory,StatsCards,SlotsCard,ExportsCard,WarningsCard}.tsx`, `E/services/exports.js`, `E/services/stats.js`, `E/services/slots.js`, `E/controllers/{sync,slots,exports}.js`, `W/lib/espace/api.ts`.

**Critères d'acceptation** 1. À 375 px, un organisateur voit « Pilotage » dans la barre ; un participant ne le voit pas. 2. Dernière exécution en `FETCH_FAILED` : titre rouge. 3. Un doublon d'e-mail du jeu de recette s'affiche avec son adresse. 4. `program-stats.test.js` reste vert et couvre les nouvelles colonnes. 5. `dryRun` ne modifie aucun créneau.

**Tests** intégration `espace-pilotage.test.js`, bout en bout `espace-pilotage.spec.ts`. **Revue designer.**

## V2-E. Finitions

**Effort** M. **Dépend de** rien.

**Exigences**
- **F-126 (P1)** Titres de l'espace : les lettres accentuées s'affichent accentuées. Une déclaration de police propre à l'espace limite Azonix aux caractères qu'elle possède, les autres retombent sur la police suivante. Aucun changement sur les pages publiques.
- **F-127 (P1)** E-mails : le bouton principal de `meeting-request` s'appelle « Répondre à la demande » ; `meeting-declined` renvoie vers la fiche de la personne quand elle existe encore ; « Gérer mes notifications » porte un lien d'action vers le profil.
- **F-128 (P1)** Bouton d'entrée de l'espace sur le site public (`ConnexionEspace.astro`) : contraste d'au moins 4,5.
- **F-129 (P1)** Programme : liens d'intervenants d'au moins 44 px de haut ; l'onglet actif est exposé (`aria-current`) ; alerte d'indisponibilité et état vide ne s'affichent plus ensemble.
- **F-130 (P1)** Manifeste : icône `maskable` 512 px ; balise `theme-color` de l'édition dans la mise en page.

**Fichiers possédés** `W/styles/espace.css`, `E/lib/mail/layout.js`, `E/lib/mail/templates/{meeting-request,meeting-declined}.js`, `E/services/meetings.js` (liens des e-mails seulement), `W/components/ConnexionEspace.astro`, `P/[edition]/programme.astro`, `P/[edition]/manifest.webmanifest.ts`, `W/layouts/EspaceLayout.astro`, `web/public/espace/icon-maskable-512.png` (nouveau).

**Critères d'acceptation** 1. « Accès réservé » s'affiche avec ses accents (capture). 2. Les tests de gabarits d'e-mail sont à jour et verts. 3. Les captures visuelles des pages publiques ne changent pas, hors le bouton d'entrée, mis à jour avec l'accord du superviseur.

**Tests** unitaire `mail-templates.test.js` et `meeting-templates.test.js` complétés, bout en bout `espace-pwa.spec.ts` complété. **Revue designer.**

## V2-Q. Audits de la porte

**Effort** M. Testeur seul. **Dépend de** l'intégration des autres lots de la vague pour le passage final, mais démarre dès le début.

**Exigences**
- **T-70 (P0, NF-30, T-43)** `@axe-core/playwright` en dépendance de développement ; `espace-a11y.spec.ts` passe axe (règles WCAG 2.1 A et AA) sur E0 à E9 en 390 px et 1280 px ; aucune violation `critical` ni `serious`. Parcours clavier complet : connexion, demande, acceptation, envoi d'un message.
- **T-71 (P0, T-44)** Lighthouse mobile sur E1, E4, E5 du front construit : au moins 90 en performance et en accessibilité. Mesure du JavaScript par écran (NF-20).
- Rapports datés dans `reports/quality/`. Chaque défaut est renvoyé au lot propriétaire du fichier, ou consigné au suivi s'il est accepté.

**Fichiers possédés** `web/package.json`, `web/pnpm-lock.yaml`, `web/tests/e2e/espace-a11y.spec.ts`, `reports/quality/**`.

---

# Vague 3 : relances et outils du jour J

## V3-A. Relances

**Effort** L. **Dépend de** V1-C. Le premier envoi planifié est celui du 27 novembre : intégration au plus tard le 25.

**Exigences** R-70, R-71, R-72, R-17 (information des demandes expirées), I-39, T-33, T-34, tels qu'écrits dans `04-regles-metier.md`, `05-integrations.md` et `03-ecrans.md` (E10), complétés par :
- **R-87 (P0)** Calendrier calculé à partir de la date de l'édition, jamais en dur : a et b à J-6 à 9h30 ; a aussi à J+2 de l'activation ; rappel `welcome` à J+3 de l'import et à J-6 ; c la veille à 16h00. L'envoi b « à l'ouverture » est remplacé par l'envoi manuel (D-12). Pour l'édition du 3 décembre, J-6 est le 27 novembre.
- Clé d'idempotence `scenarioKey = <scénario>:<date prévue AAAA-MM-JJ>`. Un envoi manuel utilise la date du jour.
- `reminder-eve` liste les rendez-vous acceptés du lendemain (heure, interlocuteur, table ou stand), les demandes expirées, le lieu et l'accès, et joint le `.ics`. Il part même sans rendez-vous, sous une forme courte.
- En-têtes `List-Unsubscribe` et `List-Unsubscribe-Post` sur les trois relances et le rappel `welcome`, vers un lien d'action qui coupe la préférence `reminders` en un clic et l'affiche.
- La préférence `reminders = false` exclut des scénarios a et b ; le scénario c est un e-mail de service, envoyé à tous les actifs qui ont au moins un rendez-vous accepté, et aux autres seulement si `reminders = true`.
- Contrat consommé par V3-B, figé :
  - `POST /api/espace/admin/{edition}/reminders/preview` `{ scenario: 'profile'|'no-meeting'|'eve'|'welcome' }` → `{ recipients: number, skipped: { alreadySent: number, optedOut: number }, sampleHtml: string }`
  - `POST /api/espace/admin/{edition}/reminders/send` `{ scenario }` → `{ sent: number, skipped: number, failed: number }` ; 409 `OUTSIDE_SENDING_HOURS`.
- La tâche de notification des messages passe à une exécution par minute (pour V3-D).

**Fichiers possédés** `E/lib/reminders.js`, `E/services/reminders.js`, `E/controllers/reminders.js`, `E/routes/reminders.js`, `E/lib/mail/templates/reminder-{profile,no-meeting,eve}.js` (nouveaux), `E/lib/mail/{index,brevo,smtp,console,render,layout}.js`, `E/services/mailer.js`, `strapi/config/cron-tasks.js`.

**Réalisation** La sélection des destinataires et le calcul des dates sont des fonctions pures (`E/lib/reminders.js`) prenant l'heure courante en paramètre. Une tâche `espaceReminders` tourne toutes les 15 min et n'envoie que ce qui est dû et pas encore journalisé : un redémarrage ou un retard ne fait rien perdre ni doubler.

**Critères d'acceptation**
1. T-33 : deux exécutions de la tâche et un envoi manuel le même jour donnent un seul e-mail par destinataire et par scénario.
2. T-34 : rien ne part entre 20h00 et 8h00 heure de Paris ; ce qui était dû part à l'exécution suivante dans la plage.
3. Horloge fixée à J-6 9h30 : a part aux actifs sous 70 %, b aux actifs sans rendez-vous, hors refus de rappels.
4. Veille 16h00 : chaque actif concerné reçoit `reminder-eve` avec ses rendez-vous du lendemain et ses demandes expirées.
5. Le lien de désabonnement coupe `reminders` sans connexion préalable et ne fonctionne que pour son destinataire.
6. `conventions.test.js` couvre les nouveaux gabarits (pas de tiret cadratin).

**Tests** unitaire `reminders.test.js`, `reminder-templates.test.js` ; intégration `espace-relances.test.js`. **Revue designer** sur les trois gabarits, d'après `docs/espace/maquettes/08-relance.png`.

## V3-B. Relance manuelle dans le pilotage

**Effort** S. **Dépend de** V3-A (contrat ci-dessus ; s'intègre après).

**Exigence** **F-92 (P0)** `RemindersCard` : choix du scénario, nombre de destinataires et d'exclus avec leur raison, aperçu de l'e-mail dans un cadre isolé, confirmation qui répète le nombre, résultat. Hors plage horaire, le bouton est inactif et dit pourquoi.

**Fichiers possédés** `R/organizer/RemindersCard.tsx`.

**Critères d'acceptation** 1. Un second envoi du même scénario le même jour affiche « 0 envoyé, N déjà relancés ». 2. Annuler la confirmation n'appelle pas `send`. 3. Retours annoncés par `role="status"`.

**Tests** bout en bout `espace-pilotage-relances.spec.ts`.

## V3-C. Consultation hors connexion

**Effort** M. **Dépend de** V1-E, V2-E.

**Exigences**
- **NF-24 (P1, complet)** Le service worker garde la dernière version réussie de l'accueil, de l'agenda, du programme et de la liste des messages de l'édition, ainsi que les feuilles de style, scripts, polices et icônes de l'espace. Stratégie réseau d'abord, avec délai de 4 s puis repli sur la copie. Les appels à l'API ne sont jamais mis en cache.
- **F-131 (P1)** Une page servie depuis la copie affiche un bandeau « Hors connexion : contenu enregistré à <heure> » et désactive les actions qui écrivent. La page hors connexion générale liste les liens vers les pages enregistrées.
- La déconnexion vide le cache de l'espace. Les copies sont propres à l'édition et expirent 48 h après la date de l'événement.

**Fichiers possédés** `web/public/espace/sw.js`, `web/public/espace/hors-ligne.html`, `W/layouts/EspaceLayout.astro`, `R/OfflineBanner.tsx` (nouveau), `P/[edition]/profil.astro` (formulaire de déconnexion seulement).

**Critères d'acceptation** 1. Agenda ouvert, réseau coupé, rechargement : l'agenda s'affiche avec le bandeau et l'heure. 2. Réseau à 10 s de latence : la copie arrive en moins de 5 s. 3. Après déconnexion puis coupure réseau, aucune page de l'espace n'est lisible. 4. Les en-têtes `no-store` des réponses ne changent pas.

**Tests** bout en bout `espace-hors-ligne.spec.ts`.

## V3-D. Fraîcheur

**Effort** M. **Dépend de** V2-D (AppShell, vague précédente), V3-A (cadence de la tâche).

**Exigences**
- **F-132 (P1)** Les badges de la barre d'onglets se mettent à jour toutes les 60 s quand l'onglet est visible et à chaque retour au premier plan, par un îlot léger qui lit `GET /me` avec ses compteurs. Une nouvelle demande ou un nouveau message est annoncé une fois dans une zone `aria-live` polie.
- **F-133 (P1)** La liste des messages se recharge au même rythme.
- **R-88 (P1)** Un message non lu déclenche l'e-mail après 2 min au lieu de 5 ; la règle « un e-mail au plus par conversation et par 30 min » ne change pas. `04-regles-metier.md` (R-62) est corrigé par le superviseur.
- Dans un fil, un échec de l'interrogation périodique affiche « Hors connexion, nouvelle tentative… » ; une ligne discrète indique que Ctrl ou Cmd + Entrée envoie.

**Fichiers possédés** `W/components/espace/AppShell.astro`, `R/LiveBadges.tsx` (nouveau), `P/[edition]/messages/index.astro`, `R/ConversationList.tsx` (nouveau), `R/ChatThread.tsx`, `E/lib/messages.js`, `W/lib/espace/messages.ts`.

**Critères d'acceptation** 1. Un message reçu fait passer le badge de 0 à 1 en moins de 60 s sans rechargement. 2. Onglet masqué : aucune requête. 3. Poids de l'îlot de badges inférieur à 5 Ko compressés. 4. Les tests de messagerie T-30 à T-32 sont adaptés au délai de 2 min.

**Tests** unitaire `messages.test.js` complété, bout en bout `espace-fraicheur.spec.ts`.

## V3-E. Participants dans le pilotage

**Effort** L. **Dépend de** V1-C.

**Exigences**
- **F-134 (P0)** `AttendeesCard` : liste paginée des inscrits de l'édition avec recherche (nom, entreprise, e-mail), filtres (rôle, activé ou non, visible ou non, annulé), tri par nom ou par dernière connexion.
- **F-135 (P0)** Fiche d'un inscrit : identité, rôle, statut, dates d'import, d'activation et de dernière connexion, choix de visibilité en lecture seule, nombre de rendez-vous, dix derniers e-mails avec statut et motif d'échec. Bouton « Renvoyer un lien de connexion », exempt de la limite par IP, limité à 3 par heure et par inscrit.
- **F-136 (P0)** « Ajouter un invité » : prénom, nom, e-mail, entreprise, fonction, rôle. E-mail mis en minuscules, unique dans l'édition. L'invité reçoit le `welcome` selon R-85.
- **F-137 (P0)** Corriger prénom, nom, fonction, entreprise, e-mail ou rôle d'un inscrit.
- **F-138 (P0)** « Désinscrire » : confirmation, statut `cancelled`, rendez-vous annulés avec notification des interlocuteurs (même traitement que R-18). « Réinscrire » fait l'inverse, sans restaurer les rendez-vous.
- **R-89 (P0)** Une correction ou une désinscription faite par l'organisateur l'emporte sur HelloAsso : les champs corrigés entrent dans `editedFields` ; un nouveau champ scalaire `statusLockedAt` sur le participant empêche la synchronisation de réactiver quelqu'un. L'import met les e-mails en minuscules avant comparaison.
- Routes, toutes sous `/api/espace/admin/{edition}/attendees`, garde organisateur : `GET /` (`q`, `role`, `activated`, `visible`, `status`, `page`, `sort`), `GET /{id}`, `POST /`, `PATCH /{id}`, `POST /{id}/link`, `POST /{id}/cancel`, `POST /{id}/restore`. Jamais de contenu de message (R-63).

**Fichiers possédés** `R/organizer/AttendeesCard.tsx`, `R/organizer/AttendeeSheet.tsx` (nouveau), `E/services/admin-attendees.js`, `E/controllers/admin-attendees.js`, `E/routes/admin-attendees.js`, `E/services/sync.js`, `E/lib/import.js`, `E/content-types/attendee/schema.json`.

**Critères d'acceptation**
1. Un nom corrigé depuis le pilotage survit à dix synchronisations.
2. Un inscrit désinscrit depuis le pilotage reste annulé après synchronisation, ses interlocuteurs reçoivent `meeting-cancelled`, ses tables sont libérées.
3. Un invité ajouté à la main n'est ni dupliqué ni supprimé par la synchronisation.
4. Recherche « dub » : réponse en moins de 300 ms sur 200 inscrits.
5. Participant non organisateur : 403 sur chaque route ; organisateur d'une autre édition : 403.
6. L'e-mail n'apparaît que dans ces routes d'administration, jamais dans une carte de profil.

**Tests** intégration `espace-admin-participants.test.js`, bout en bout `espace-pilotage-participants.spec.ts`. **Revue designer.**

## V3-F. Rendez-vous dans le pilotage

**Effort** M. **Dépend de** V1-C, V1-D.

**Exigences**
- **F-139 (P0)** `MeetingsCard` : rendez-vous de l'édition par créneau, avec les deux parties, la table ou le stand et le statut ; filtre par créneau et par statut ; recherche par nom.
- **F-140 (P0)** L'organisateur annule un rendez-vous accepté ou une demande en attente, avec un motif court facultatif ; les deux parties reçoivent `meeting-cancelled` avec la mention « annulé par l'organisation » ; la table est libérée.
- **F-141 (P0)** Bloquer une table sur un créneau, ou une table sur toute la journée, ou un créneau entier. Un blocage refuse les nouvelles attributions ; s'il touche un rendez-vous accepté, l'écran le signale et propose de le déplacer vers une table libre du même créneau, ou de l'annuler.
- **R-90 (P0)** Les blocages sont un champ JSON `blockedTables` sur le créneau (type de l'espace) et un champ `closed`. L'attribution des tables (R-13) les ignore comme des tables occupées ; la grille d'un participant montre un créneau fermé comme indisponible. Le test de concurrence T-17 reste vert.
- Routes sous `/api/espace/admin/{edition}` : `GET /meetings`, `POST /meetings/{id}/cancel`, `POST /meetings/{id}/move` `{ table }`, `PUT /slots/{id}/blocks` `{ blockedTables: number[], closed: boolean }`.

**Fichiers possédés** `R/organizer/MeetingsCard.tsx`, `E/services/admin-meetings.js`, `E/controllers/admin-meetings.js`, `E/routes/admin-meetings.js`, `E/services/meetings.js`, `E/lib/meetings.js`, `E/content-types/slot/schema.json`, `E/lib/mail/templates/meeting-cancelled.js`.

**Critères d'acceptation** 1. Table 2 bloquée sur 12h30 : vingt demandes simultanées n'attribuent jamais la table 2. 2. Créneau fermé : la grille le montre indisponible, une demande directe par l'API répond 409. 3. Annulation par l'organisateur : deux e-mails, table libre, statut `cancelled`. 4. Couverture des branches de `E/lib/meetings.js` mesurée et consignée (porte de phase 2).

**Tests** unitaire `meetings-blocks.test.js`, intégration `espace-admin-rendezvous.test.js`, `meetings-concurrency.test.js` complété.

## V3-G. Connexion par code (conditionnel, D-17)

**Effort** L. **Dépend de** V1-B. Lancé seulement si H-5 confirme la perte de session.

**Exigences**
- **I-44 (P0 si lancé)** L'e-mail `access-link` porte, en plus du lien, un code à six chiffres valable 30 min, à usage unique, lié à l'adresse et à l'édition, stocké haché.
- **F-142** L'état « Lien envoyé » affiche un champ « Code reçu par e-mail » (`inputmode="numeric"`, `autocomplete="one-time-code"`). Un code juste ouvre la session dans le navigateur où il est saisi. Cinq essais faux invalident le code. Le lien continue de fonctionner.

**Fichiers possédés** `E/services/auth.js`, `E/controllers/auth.js`, `E/services/tokens.js`, `E/lib/tokens.js`, `E/routes/auth.js`, `E/lib/mail/templates/access-link.js`, `P/[edition]/connexion.astro`, `W/components/espace/RequestLinkForm.astro`.

**Critères d'acceptation** 1. Code saisi dans un navigateur différent de celui qui a demandé le lien : session ouverte. 2. Sixième essai : refus même avec le bon code. 3. La réponse reste identique que l'adresse soit inscrite ou non (F-02). 4. Limites de débit de V1-B inchangées.

**Tests** intégration `espace-acces-code.test.js`, bout en bout `espace-acces-code.spec.ts`.

---

# Vague 4 : confort du jour J

## V4-A. Annuaire

**Effort** M.

**Exigences** **F-45** recherche, type et sujets dans l'URL, restaurés au retour d'une fiche avec la position de défilement. **F-143** sujets sur les cartes, les sujets communs mis en avant. **F-144** on ne figure pas dans sa propre liste (observation O1). **F-145** un échec de chargement de la page suivante n'entraîne ni boucle ni perte des pages déjà chargées ; « Réessayer » reprend la page manquante. Indice visuel de défilement horizontal des sujets ; aucun débordement à 360 px. Le lien de retour d'une fiche ramène à la page d'origine.

**Fichiers possédés** `R/DirectoryBrowser.tsx`, `R/ProfileCardView.tsx`, `P/[edition]/annuaire/index.astro`, `P/[edition]/annuaire/[type]/[id].astro`, `E/services/directory.js`, `E/lib/directory.js`.

**Critères d'acceptation** 1. Filtre « Exposants » et recherche « bois », ouverture d'une fiche, retour : mêmes filtres, même position. 2. L'URL copiée dans un autre onglet donne la même liste. 3. Les tests T-10 à T-13 et `directory.test.js` restent verts.

**Tests** bout en bout `espace-annuaire.spec.ts`.

## V4-B. Profil

**Effort** M.

**Exigences** **F-146** barre d'enregistrement collante dès qu'une modification existe, avec « Enregistrer » et « Annuler » ; alerte du navigateur en quittant avec des modifications ; focus replacé sur le message de succès. **F-147** suppression de la photo. **F-148** confirmation avant déconnexion, qui rappelle qu'un nouveau lien sera nécessaire. **F-149** sous 1024 px, l'avatar menant au profil est présent sur tous les écrans de l'espace, avec un nom accessible.

**Fichiers possédés** `R/ProfileForm.tsx`, `P/[edition]/profil.astro`, `W/components/espace/AppShell.astro`, `E/services/me.js`, `E/controllers/me.js`.

**Critères d'acceptation** 1. Modifier un champ puis changer d'onglet déclenche l'alerte. 2. La barre est atteignable au clavier et ne masque pas le champ en cours. 3. `profile.test.js` et `profile-photo.test.js` restent verts.

**Tests** bout en bout `espace-profil.spec.ts`.

## V4-C. Repères du jour J

**Effort** M.

**Exigences** **F-150** le jour de l'événement, le programme marque la séquence « En cours » et « À suivre », et s'ouvre sur elle. **F-151** mes rendez-vous acceptés apparaissent dans le programme, à leur pause, avec la table. **F-152** « Prendre RDV » n'est affiché que fenêtre ouverte et mène à l'annuaire ; sinon la pause affiche le nombre de mes rendez-vous. Les onglets du programme ne remplissent plus l'historique.

**Fichiers possédés** `P/[edition]/programme.astro`, `E/services/program.js`, `E/controllers/program.js`, `R/ProgramNow.tsx` (nouveau).

**Critères d'acceptation** 1. Horloge fixée au 3 décembre 11h20 : « Process, data et IA » est « En cours ». 2. Sans JavaScript, le programme reste complet (NF-31). 3. Un visiteur non connecté ne voit aucun rendez-vous.

**Tests** bout en bout `espace-jour-j.spec.ts`.

## V4-D. Badges (D-13 tranché le 17 novembre : réalisés)

Périmètre, exigences et critères : `12-badges.md` en entier (F-95 à F-99, R-80 à R-84, I-43, NF-54 à NF-57, T-60 à T-69). **Effort** L, deux à trois jours. Deux lots sans fichier commun, V4-D2 s'intègre après V4-D1. Questions ouvertes de `12-badges.md` : réponses par défaut de `13-orchestration.md`, section 8 (D-13).

**Choix du superviseur**
- Bibliothèques (I-43) : `pdfkit` (PDF vectoriel, polices embarquées, aucun appel réseau) et `qrcode` (seulement sa matrice, `QRCode.create(url, { errorCorrectionLevel: 'M' })`, dessinée en rectangles vectoriels par pdfkit). Ajoutées à `strapi/package.json` par V4-D1.
- Jeton de carte (R-80, NF-55) : dérivé, pour qu'un badge réimprimé garde son QR. `token = base64url(HMAC-SHA256(clé, documentId de l'Attendee + ":" + cardTokenCreatedAt))`, 256 bits ; la clé dérive des `APP_KEYS` de Strapi. Seul `cardTokenHash = sha256(token)` est stocké, pour la recherche. Le jeton est créé à la première génération d'un badge (pas de migration ni de changement de l'import) ; « Régénérer » change `cardTokenCreatedAt`, donc le jeton, et l'ancien cesse aussitôt.
- Polices : celles du site (`web/public/fonts`), copiées dans `strapi/src/api/espace/lib/badges/assets/` ; logo : celui du site en attendant le vectoriel des JIB.

### V4-D1. Badges, génération et carte

**Fichiers possédés** `E/lib/badges/**` (nouveau : mise en page, QR, jeton), `E/services/badges.js`, `E/controllers/badges.js`, `E/routes/badges.js`, `E/services/cards.js`, `E/controllers/cards.js`, `E/routes/cards.js` (nouveaux), `E/content-types/attendee/schema.json` (`cardTokenHash`, `cardTokenCreatedAt`), `strapi/src/api/edition/content-types/edition/schema.json` (`badgePlan`, `badgeAccent`), `strapi/package.json`, `strapi/pnpm-lock.yaml`, `P/[edition]/carte/[token].astro` (nouveau), `P/[edition]/connexion.astro` (retour de F-96 seulement si `next` ne le couvre pas déjà).

**Contrat consommé par V4-D2, figé** : routes de `12-badges.md` (`POST /api/espace/admin/{edition}/badges` corps `{ types?: string[], sort?: 'name'|'company' }` → `application/pdf` avec en-tête `X-Badges-Count` et `X-Badges-Reduced` ; `GET /api/espace/admin/{edition}/attendees/{id}/badge` → `application/pdf` ; `POST /api/espace/admin/{edition}/attendees/{id}/card-token/regenerate` → `{ regeneratedAt }` ; `GET /api/espace/cards/{edition}/{token}` public).

**Tests** unitaire `badges.test.js` (mise en page, troncature T-66, QR décodé T-65), intégration `espace-badges.test.js` (T-60 à T-65, T-68), bout en bout `espace-carte.spec.ts` (T-60, T-61, T-67) ; `conventions.test.js` étendu (T-69).

### V4-D2. Badges dans le pilotage

**Fichiers possédés** `R/organizer/BadgesCard.tsx` (nouveau), `R/organizer/AttendeeSheet.tsx` (boutons « Badge à l'unité » et « Régénérer le jeton »), `R/OrganizerPanel.tsx` (montage de la carte).

**Exigences** F-97 (filtre par type, tri, compte rendu : nombre de badges, profils en carte réduite), F-98. Le PDF se télécharge, il ne s'ouvre pas dans l'onglet de l'espace. Confirmation avant régénération : « L'ancien badge ne fonctionnera plus, il faudra le réimprimer ».

**Tests** bout en bout `espace-pilotage-badges.spec.ts`.

**Ordre en vague 4** : V4-F possède aussi le schéma de l'édition ; il s'intègre après V4-D1 et part de sa tête.

## V4-E. Charge

**Effort** M. Testeur seul. **T-73 (NF-21)** : jeu de 200 participants et 600 rendez-vous dans une base `*_test` ; mesure du p95 des routes `/me`, `/directory`, `/meetings`, `/admin/*/stats`, `/admin/*/attendees` sous 20 utilisateurs simultanés ; seuil 300 ms ; rapport dans `reports/quality/`. Fichiers possédés : `strapi/tests/load/**` (nouveau).

## V4-F. Lecture seule après l'événement

**Effort** M.

**Exigence** **NF-70 (P0 pour la semaine du 7 décembre)** Nouveau champ `readOnlyAt` sur l'édition. Passé cette date : toute route d'écriture de l'espace répond 409 `EDITION_READ_ONLY`, sauf la connexion, la déconnexion, les préférences e-mail et l'export ; les écrans affichent un bandeau « L'édition est terminée, votre espace reste consultable » et masquent les actions ; le pilotage et les exports restent disponibles ; les relances et les `welcome` cessent. Valeur par défaut calculée : sept jours après la date de l'édition.

**Fichiers possédés** `E/middlewares/context.js`, `strapi/src/api/edition/content-types/edition/schema.json`, `W/components/espace/EditionBanner.astro`, `W/lib/espace/api.ts`, `strapi/src/index.js` (libellé du champ seulement).

**Critères d'acceptation** 1. Après `readOnlyAt`, une demande de rendez-vous par l'API répond 409 et aucun bouton ne la propose. 2. L'export participants fonctionne. 3. Avant `readOnlyAt`, aucun comportement ne change.

**Tests** intégration `espace-lecture-seule.test.js`.

---

# Vague 5 : après l'événement

Lots à détailler par le superviseur au moment de les lancer, selon le même modèle. Périmètre arrêté :

| Lot | Contenu | Exigences | Effort |
|---|---|---|---|
| V5-A | Suppression et anonymisation depuis le profil et depuis le pilotage ; empreinte de l'e-mail contre la réimportation ; purge de l'édition 12 mois après sa date ; purge des journaux | F-33, R-44, NF-12, NF-13 | L |
| V5-B | Signaler un message ; file de signalements dans le pilotage, sans exposer les autres messages | F-75, R-63 | M |
| V5-C | Sélecteur d'édition dans le pilotage ; un organisateur déclaré une fois pour plusieurs éditions ; modèle d'édition à dupliquer | spec E9 | M |
| V5-D | Profil B2B : « Je cherche », « Je propose », téléphone facultatif visible seulement des interlocuteurs d'un rendez-vous accepté ; suggestions fondées sur ces champs | R-50, R-42 | M |
| V5-E | Flux d'abonnement calendrier ; webhook HelloAsso | I-42, I-13 | M chacun |
| V5-F | MCP : README en français propre au projet, jeton à droits limités passé en en-tête, suppression protégée, `content-types.json` complété des réglages d'édition | | S |
| V5-G | Rôle d'administration restreint pour Xylofutur (pas de suppression des types de l'espace, pas de jetons d'API) | | M |

Détail arrêté par le superviseur le 17 novembre (consigne de Mathieu : coder toutes les vagues à la suite). Répartition des fichiers chauds en vague 5 : schéma `attendee` à V5-D, `sync.js` et `lib/import.js` à V5-A, `lib/mail/**` et `OrganizerPanel.tsx` à V5-B, `strapi/src/index.js` à V5-G, `cron-tasks.js` à V5-A. V5-E (webhook) part de la tête intégrée de V5-A.

## V5-A. Effacement, export individuel et purge

**Exigences**
- **F-33, R-44** « Supprimer mes données » dans le profil : confirmation qui nomme les effets (rendez-vous à venir annulés avec notification, messages gardés chez l'interlocuteur sous « Participant supprimé », reconnexion impossible), puis anonymisation : prénom « Participant », nom « supprimé », entreprise, fonction, présentation, photo, LinkedIn, sujets et préférences vidés, `directoryOptIn` et `meetingsOptIn` à faux, statut `cancelled`, e-mail remplacé par une adresse technique non routable, session close. Même action depuis la fiche d'un inscrit du pilotage (« Anonymiser »).
- Empreinte : nouveau type `api::espace.erased-email` (édition, `emailHash` = sha256 de l'e-mail en minuscules salé par une clé dérivée des `APP_KEYS`, `erasedAt`). L'import ignore une ligne HelloAsso dont l'empreinte est présente pour l'édition, sans erreur rouge (information repliée « effacé à la demande »).
- **NF-12 (P1)** Export individuel : `GET /api/espace/me/export` → JSON du profil, des préférences, des rendez-vous (avec interlocuteur, créneau, table) et des messages envoyés par la personne ; téléchargé depuis le profil.
- **NF-13, R-44** Tâche planifiée `espacePurge`, quotidienne à 4h00 : supprime `EmailLog` et `SyncRun` de plus de 12 mois, et toutes les données de l'espace (participants, rendez-vous, conversations, messages, jetons, empreintes) d'une édition dont la date est passée de 12 mois. L'édition et son programme restent.
- Routes : `POST /api/espace/me/erase` `{ confirm: true }` ; `POST /api/espace/admin/{edition}/attendees/{id}/erase` (garde organisateur) ; `GET /api/espace/me/export`.

**Fichiers possédés** `E/lib/erase.js`, `E/services/privacy.js`, `E/controllers/privacy.js`, `E/routes/privacy.js`, `E/content-types/erased-email/schema.json` (nouveaux), `E/services/sync.js`, `E/lib/import.js`, `strapi/config/cron-tasks.js`, `R/PrivacyActions.tsx` (nouveau, monté dans le profil), `P/[edition]/profil.astro`, `R/organizer/AttendeeSheet.tsx`.

**Critères d'acceptation** 1. Après effacement, l'annuaire, les suggestions, les exports et les fiches ne montrent plus rien de la personne ; l'interlocuteur voit ses messages sous « Participant supprimé ». 2. Ses rendez-vous à venir sont annulés, tables libérées, interlocuteurs notifiés. 3. Dix synchronisations ne la réimportent pas. 4. L'export JSON ne contient aucune donnée d'un autre participant hors prénom, nom et entreprise des interlocuteurs. 5. Horloge à date + 12 mois et un jour : la purge vide l'espace de l'édition et garde le programme ; une seconde exécution ne fait rien.

**Tests** unitaire `erase.test.js`, intégration `espace-effacement.test.js`, bout en bout `espace-effacement.spec.ts`.

## V5-B. Signalement d'un message

**Exigences**
- **F-75** Dans un fil, chaque message reçu porte « Signaler » : motif court obligatoire (500 caractères au plus), confirmation, puis « Signalement transmis à l'organisation ». Un même message ne se signale qu'une fois par personne.
- Nouveau type `api::espace.message-report` (édition, message, auteur du signalement, motif, statut `open` ou `handled`, `handledAt`). Les organisateurs reçoivent l'e-mail `message-report` (sans le contenu du message ; lien vers le pilotage).
- **R-63** `ReportsCard` dans le pilotage : signalements ouverts puis traités, avec auteur du signalement, personne signalée, date, motif et le **seul** texte du message signalé ; aucun autre message n'est exposé. Action « Marquer comme traité ».
- Routes : `POST /api/espace/conversations/{id}/messages/{messageId}/report` `{ reason }` ; `GET /api/espace/admin/{edition}/reports` ; `POST /api/espace/admin/{edition}/reports/{id}/handle`.

**Fichiers possédés** `E/content-types/message-report/schema.json`, `E/services/reports.js`, `E/controllers/reports.js`, `E/routes/reports.js` (nouveaux), `E/lib/mail/**` (gabarit `message-report` et son enregistrement), `R/ChatThread.tsx`, `R/organizer/ReportsCard.tsx` (nouveau), `R/OrganizerPanel.tsx`.

**Critères d'acceptation** 1. On ne peut signaler que ses messages reçus, dans ses conversations (sinon 404). 2. La route d'administration ne renvoie aucun autre message de la conversation. 3. Deux signalements du même message par la même personne : le second répond 409. 4. Participant non organisateur : 403.

**Tests** intégration `espace-signalements.test.js`, bout en bout `espace-signalements.spec.ts`.

## V5-C. Plusieurs éditions dans le pilotage

**Exigences**
- Sélecteur d'édition en tête du pilotage : éditions que la personne connectée peut piloter (adresse dans `ORGANIZER_EMAILS`, ou Attendee de rôle `organizer` avec la même adresse dans l'édition). Passer à une autre édition ouvre une session pour celle-ci sans nouveau lien, si et seulement si la personne en est organisatrice.
- Un organisateur de `ORGANIZER_EMAILS` est organisateur de toutes les éditions, même sans Attendee.
- « Dupliquer cette édition » : nouvelle édition en brouillon (titre, `slug`, date saisis), qui reprend les réglages de l'espace (créneaux, tables, durée, sujets) et les séquences du programme en brouillon ; ni participants, ni exposants, ni rendez-vous, ni formulaire HelloAsso, `participantSpaceEnabled` à faux.
- Routes : `GET /api/espace/admin/editions` ; `POST /api/espace/admin/{edition}/switch` → 303 vers le pilotage de la cible ; `POST /api/espace/admin/{edition}/duplicate` `{ title, slug, date }`.

**Fichiers possédés** `E/services/admin-editions.js`, `E/controllers/admin-editions.js`, `E/routes/admin-editions.js` (nouveaux), `P/[edition]/organisateur.astro`, `R/organizer/EditionSwitcher.tsx`, `R/organizer/DuplicateEditionCard.tsx` (nouveaux, montés par `organisateur.astro` hors de `OrganizerPanel`).

**Critères d'acceptation** 1. Un organisateur de deux éditions passe de l'une à l'autre sans e-mail. 2. Un participant ou l'organisateur d'une seule édition ne peut pas basculer vers une autre (403). 3. L'édition dupliquée a ses séquences et ses réglages, aucune donnée personnelle, et n'est pas publiée. 4. `slug` déjà pris : 409.

**Tests** intégration `espace-multi-editions.test.js`, bout en bout `espace-multi-editions.spec.ts`.

## V5-D. Profil B2B

**Exigences**
- Nouveaux champs scalaires de l'Attendee : `lookingFor` et `offering` (texte, 300 caractères), `phone` (facultatif, format libre de 30 caractères).
- **R-42 amendé** : « Je cherche » et « Je propose » suivent R-42 (visibles des profils visibles). Le téléphone n'est visible que des interlocuteurs d'un rendez-vous **accepté** avec la personne, dans l'agenda et la fiche, jamais dans l'annuaire, les exports partagés ni la carte de badge. Le superviseur reporte l'amendement dans `04-regles-metier.md`.
- **R-50 étendu** : les suggestions comptent aussi les mots significatifs communs entre mon « Je cherche » et leur « Je propose » (et inversement), après les sujets communs.
- Profil : deux zones de texte et le téléphone, avec l'aide « Visible seulement des personnes avec qui vous avez un rendez-vous confirmé ».

**Fichiers possédés** `E/content-types/attendee/schema.json`, `E/lib/profile.js`, `E/services/me.js`, `E/controllers/me.js`, `E/lib/cards.js`, `E/lib/suggestions.js`, `E/services/directory.js`, `E/lib/directory.js`, `R/ProfileForm.tsx`, `R/ProfileCardView.tsx`, `P/[edition]/annuaire/[type]/[id].astro`, `R/AgendaBoard.tsx` (téléphone sur la carte d'un rendez-vous accepté).

**Critères d'acceptation** 1. Le téléphone n'apparaît dans aucune réponse d'API pour un tiers sans rendez-vous accepté. 2. Il apparaît pour l'interlocuteur d'un rendez-vous accepté, et disparaît si le rendez-vous est annulé. 3. Une suggestion fondée sur « Je cherche / Je propose » apparaît quand aucun sujet n'est commun. 4. `profile.test.js`, `directory.test.js` et `suggestions.test.js` restent verts.

**Tests** unitaire `suggestions.test.js` complété, intégration `espace-profil-b2b.test.js`.

## V5-E. Abonnement calendrier et webhook HelloAsso

**Exigences**
- **I-42** Nouveau type `api::espace.calendar-feed` (Attendee, `tokenHash`, `createdAt`, `revokedAt`). `GET /api/espace/calendar/{token}.ics` public, limité en débit, 404 uniforme : rendez-vous acceptés de la personne (même contenu que les `.ics` des e-mails). Dans l'agenda : « S'abonner à mon agenda » qui crée le flux et affiche l'URL une seule fois (`webcal://` et copie), « Révoquer ». Routes : `POST /api/espace/me/calendar-feed`, `DELETE /api/espace/me/calendar-feed`.
- **I-13** `POST /api/espace/webhooks/helloasso` : n'accepte que `eventType = Order` ; ne fait pas confiance au contenu, relit la commande (`GET /orders/{orderId}`) puis l'importe par le même chemin que la synchronisation ; répond 200 vite et traite en tâche de fond ; limité en débit ; ignoré si l'édition n'a pas de formulaire HelloAsso correspondant. Documenté dans `docs/espace/exploitation.md` par le superviseur.

**Fichiers possédés** `E/content-types/calendar-feed/schema.json`, `E/services/calendar-feed.js`, `E/controllers/calendar-feed.js`, `E/routes/calendar-feed.js`, `E/services/webhooks.js`, `E/controllers/webhooks.js`, `E/routes/webhooks.js` (nouveaux), `E/lib/helloasso.js`, `P/[edition]/agenda.astro`, `R/CalendarFeed.tsx` (nouveau). Consomme en lecture `services/sync.js` (importer une commande) : la fonction manquante est ajoutée par ce lot, qui part de la tête intégrée de V5-A.

**Critères d'acceptation** 1. Le flux ne contient que les rendez-vous acceptés de son propriétaire. 2. Jeton révoqué ou régénéré : 404. 3. Webhook avec une commande inventée dans le corps : seule la version relue sur le faux HelloAsso est importée. 4. Webhook d'un autre type : 200 sans effet.

**Tests** intégration `espace-calendrier.test.js`, `espace-webhook.test.js` (contre le faux HelloAsso).

## V5-F. MCP

**Exigences** `strapi/mcp/README.md` en français, propre au projet ; le jeton d'API passe uniquement par l'en-tête `Authorization` (aucun jeton dans l'URL ni dans les journaux) ; les outils de suppression exigent un paramètre de confirmation explicite et refusent les types de l'espace (`api::espace.*`) ; `content-types.json` complété des réglages d'édition de l'espace et des champs ajoutés par les vagues 1 à 5.

**Fichiers possédés** `strapi/mcp/**`, `web/public/llms.txt`, `web/public/.well-known/mcp.json`.

**Tests** unitaire `mcp.test.js` (outils, confirmation, refus des types de l'espace, synchronisation de `content-types.json` avec les schémas).

## V5-G. Rôle d'administration restreint

**Exigences** À l'amorçage, création idempotente d'un rôle d'administration « Organisation Xylofutur » : gestionnaire de contenu en lecture, création et modification sur tous les types ; suppression interdite sur les types de l'espace (`api::espace.*`) et sur l'édition ; ni jetons d'API, ni jetons de transfert, ni gestion des utilisateurs et des rôles, ni constructeur de types, ni réglages. Le rôle existant n'est jamais écrasé dans ses ajouts manuels : seules les permissions interdites sont retirées. Documenté dans `docs/espace/guide-organisateur.md` par le superviseur.

**Fichiers possédés** `strapi/src/index.js`, `strapi/src/admin-role.js` (nouveau).

**Critères d'acceptation** 1. Deux démarrages : un seul rôle, mêmes permissions. 2. Un utilisateur de ce rôle reçoit 403 sur la suppression d'un participant et sur la création d'un jeton d'API.

**Tests** intégration `espace-role-admin.test.js`.

# Dette documentaire, à la charge du superviseur

À solder au fil des intégrations, sans lot dédié : comptes rendus `phase-1.md` à `phase-3.md`, `strapi/tests/SPEC.md` (par le testeur), report des routes dans `06-api.md` et des champs dans `02-modele-donnees.md`, mise en accord de F-10 et R-40 avec D-07, correction de R-62 (V3-D) et de R-70 (R-87), `docs/espace/CLAUDE.md` (recette sur preprod, variables nouvelles, overlays), lignes de `01-contexte-perimetre.md` sur les badges.
