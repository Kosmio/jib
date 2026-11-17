# Audit d'expérience et plan de développement, espace participant JIB

Date : mardi 17 novembre 2026. Branche `feat/espace-participant`, commit `47ecad6`.
Échéances : recette client jeudi 19, mise en production vendredi 20, événement jeudi 3 décembre.

## Méthode et limites

- Parcours réel dans le navigateur, en 375 px puis en large, sur la base de démonstration (17 participants fictifs) : connexion, lien, bienvenue, accueil, annuaire, fiche, demande de rendez-vous, agenda, annulation, messages, programme, profil, tableau de bord organisateur.
- Trois lectures de code indépendantes : écrans participant, organisateur et admin Strapi, état des exigences. Les constats bloquants ont été revérifiés à la main dans le code.
- Mesures dans la page (contrastes, tailles de cibles, libellés, titres) sur accueil, annuaire, fiche, programme, pilotage.
- **Non fait** : audit axe et Lighthouse (aucun outil installé, `reports/quality/` vide), essai sur téléphone réel, ouverture de l'admin Strapi (jugé sur les schémas), essai contre HelloAsso et Brevo réels. Les points marqués « à tester » en dépendent.

## Verdict

Le parcours nominal du participant est bon : propre, lisible, cohérent, sérieux sur l'accessibilité de base. Ce qui est fragile, c'est tout ce qui sort du parcours nominal : réseau du lieu, lien rouvert, erreur serveur, contenu qui change pendant qu'on regarde.

Côté organisateur, le tableau de bord est une page de chiffres et quatre exports. Dès qu'il faut agir sur une personne, un rendez-vous ou un e-mail, il n'y a rien, et l'admin Strapi défait ou casse ce qu'on y corrige.

Enfin la phase 3 n'est pas finie : les relances e-mail, classées P0, ne sont pas commencées, et la production n'enverrait aujourd'hui aucun e-mail.

## 1. Ce qui empêche la mise en production du 20

| # | Constat | Preuve | Effort |
|---|---|---|---|
| B1 | `EMAIL_FROM` n'est défini ni dans `.env.prod` ni dans les secrets fusionnés par `deploy.yml`. Sous `NODE_ENV=production`, Brevo refuse d'envoyer, l'erreur est avalée, chaque e-mail est journalisé `failed`. Aucun lien de connexion ne part, personne ne le voit. | `strapi/src/api/espace/lib/mail/index.js:70`, `services/mailer.js:24-27`, `infra/deploy/overlays/prod/.env.prod` | S |
| B2 | `ORGANIZER_EMAILS` est vide en prod : personne n'accède au pilotage. | `.env.prod:50` | S |
| B3 | Aucune sauvegarde (NF-51, P0), et le workflow de déploiement propose `reset_db` (`DROP SCHEMA public CASCADE`) sur tout environnement, prod comprise. | `.github/workflows/deploy.yml:154-165` | S (garde), M (sauvegarde quotidienne) |
| B4 | Ouvrir l'espace (une case dans Strapi, puis Publier) envoie le `welcome` à tous les inscrits à la synchronisation suivante, à toute heure, sans aperçu ni confirmation. Et tant que l'espace est fermé, l'organisateur ne peut pas se connecter pour vérifier l'import. | `services/sync.js:99-141`, `services/auth.js:64` | M |
| B5 | Limite de 5 demandes de lien par 15 min **par adresse IP**. Sur le Wi-Fi du lieu, la sixième personne est refusée. | `services/auth.js:98`, `lib/rate-limit.js:11` | S |
| B6 | Les relances (R-70 à R-72, F-92, I-39, T-33, T-34, toutes P0) n'existent pas : aucun gabarit `reminder-*`, aucune tâche planifiée, aucune route. La case « Rappels avant la journée » du profil ne pilote rien. | `strapi/config/cron-tasks.js` (4 tâches), `lib/mail/templates/` (7 gabarits) | L |
| B7 | L'import HelloAsso n'a jamais tourné contre HelloAsso, seulement contre le faux. Aucun e-mail n'est jamais parti par Brevo. | `strapi/tests/SPEC.md:223` | M |
| B8 | `VERSION` vaut toujours 0.1.0, l'image de prod actuelle. | `VERSION`, `.env.prod:20` | S |
| B9 | Texte de confidentialité : la page ne mentionne ni l'espace ni l'annuaire (NF-10, P0, attend Xylofutur). | `web/src/pages/confidentialite.astro` | S |
| B10 | Porte de phase 3 : ni Lighthouse, ni axe, ni essai sur iPhone et Android. | `reports/quality/` vide | M |

## 2. Expérience du participant, par ordre d'importance

### Ce qui marche

Lien magique consommé au clic et non à l'ouverture (résiste aux analyseurs de liens des messageries), demande de rendez-vous en trois gestes avec retour clair, confirmation avant annulation, statuts toujours en mot et icône, libellés et focus gérés, aucun défaut de contraste ni de cible mesuré sur les écrans de l'espace, e-mail de confirmation avec heure, table et `.ics`.

### Classement

| Rang | Constat | Gravité | Effort |
|---|---|---|---|
| 1 | **Connexion bloquée sur place** : limite par IP (B5), et `/connexion` ne reconnaît pas une session active, donc le bouton du site public et le QR code font redemander un lien pour rien. | bloquant | S |
| 2 | **Liens d'e-mail morts** : usage unique. Rouvrir le 3 décembre « Rendez-vous confirmé » affiche « Ce lien n'est plus valable », même avec une session ouverte ; la page ne lit jamais la session. | majeur | S |
| 3 | **Rien hors ligne** : le service worker ne garde qu'une page « Vous êtes hors connexion ». Ni agenda ni programme, sur le contenu le plus consulté le jour J. | majeur | M |
| 4 | **Pas de page d'erreur** : une lenteur de Strapi au-delà de 8 s ou une erreur serveur donne une page 500 brute sur l'accueil, l'agenda, la fiche, le fil. | majeur | S |
| 5 | **Écrans figés** : accueil, agenda, liste des messages et badges ne se rafraîchissent jamais. Une demande acceptée ou un message reçu n'apparaît qu'au rechargement. L'e-mail de message part 5 à 10 min après : « j'ai 5 minutes de retard » arrive trop tard. | majeur | M |
| 6 | **Pas de récapitulatif de la veille** ni de relance (B6). Une demande expirée ne prévient personne. | majeur | L |
| 7 | **Consentement** : sur l'écran de bienvenue, rien ne dit qu'en ne cochant pas « annuaire » on devient invisible, et rien ne le rappelle ensuite. L'annuaire fait toute la valeur du produit. Par ailleurs la case « rendez-vous et messages » est précochée depuis la décision D-07, ce qui contredit F-10 et R-40 : à faire valider par Xylofutur. | majeur | S |
| 8 | **Accueil trompeur** : avec trois demandes reçues à traiter, la carte dit « Aucun rendez-vous pour le moment ». Elle dit la même chose quand l'API échoue. | majeur | S |
| 9 | **Agenda pauvre en actions** : la carte d'une demande reçue n'a pas de lien vers la fiche du demandeur ; aucun « Écrire à » depuis un rendez-vous (F-70, P0, partiel) ; pas de distinction passé, en cours, à venir. | majeur | S |
| 10 | **Connexion par lien seul** : le lien s'ouvre dans le navigateur de l'application de messagerie, la session n'existe pas dans le navigateur habituel ni dans la PWA installée sur iOS. À tester en premier sur iPhone avec Gmail et Outlook. Un code à six chiffres règle le problème. | majeur, à tester | L |
| 11 | **Navigation lente** : chaque onglet est un rechargement complet en `no-store`, avec 2 à 4 appels Strapi avant le premier octet. | majeur sur réseau saturé | M |
| 12 | **Annuaire remis à zéro** au retour d'une fiche : recherche, filtres et position perdus (F-45, P1). Les cartes n'affichent pas les sujets, et l'on figure dans sa propre liste. | majeur à 200 profils | M |
| 13 | **Profil** : page de 2 700 px, un seul « Enregistrer » tout en bas, aucune alerte de modifications non enregistrées. | majeur | M |
| 14 | **Fenêtre de rendez-vous fermée** : message sans date ; « Prendre RDV » du programme et « Rencontrer » de l'accueil restent affichés et mènent à une impasse le jour J. | mineur | S à M |
| 15 | **Profil trop mince pour du B2B** : aucun champ « je cherche / je propose », pas de téléphone. On accepte ou refuse sur un nom et 250 caractères. | mineur, structurel | M |
| 16 | **Suppression de mes données** absente (F-33, alors que NF-12 est en P0). | mineur pour l'usage, obligation légale | L |
| 17 | Détails : titres en capitales sans accents (« ACCES RESERVE », « PILOTAGE DE L'EDITION », la police Azonix n'a pas les glyphes accentués) ; « Non, la garder » au lieu de « le garder » ; bouton « Accepter » de l'e-mail qui n'accepte rien ; « Créneau pris » affiché quand c'est moi qui suis déjà occupé ; état « Lien envoyé » qui ne rappelle pas l'adresse saisie ; aucun contact d'aide pour qui s'est inscrit avec une autre adresse ; bouton d'entrée du site public en blanc sur vert à 2,69 de contraste ; liens d'intervenants du programme en 20 px de haut ; pas d'invite d'installation (F-05) ni d'icône maskable. | cosmétique | S chacun |

## 3. Expérience de l'organisateur, par ordre d'importance

### Ce qui marche

Indicateurs lisibles, synchronisation robuste (verrou, un billet en échec n'arrête pas les autres), régénération des créneaux idempotente, CSV corrects pour Excel (BOM, point-virgule, neutralisation des formules), garde d'accès côté serveur.

### Classement

| Rang | Constat | Gravité | Effort |
|---|---|---|---|
| 1 | **Pas d'e-mails en prod, pas d'accès, pas de sauvegarde** : B1, B2, B3. | bloquant | S |
| 2 | **Aucune relance**, ni manuelle avec aperçu, ni planifiée (B6). Le calendrier prévoit des envois les 20/11, 27/11 et 2/12. | bloquant | L |
| 3 | **Ouverture de l'espace** incontrôlée (B4). | bloquant | M |
| 4 | **Pièges mortels dans Strapi** : supprimer un participant, un créneau ou une pause qui porte un rendez-vous fait tomber l'agenda de toute l'édition (à confirmer par un test) ; une date de fermeture passée saisie par erreur fait expirer toutes les demandes en 5 min, sans retour ; changer le `slug` casse tous les liens envoyés. | bloquant en cas d'erreur | S |
| 5 | **Les corrections dans Strapi sont défaites en silence** : nom, entreprise et statut sont réécrits par la synchronisation dans les 15 min. Désinscrire ou suspendre quelqu'un est impossible sans annuler le billet HelloAsso. | majeur | M |
| 6 | **Les pannes sont invisibles** : le bandeau affiche « synchronisé il y a 3 min » même après un échec ; erreurs réduites à un décompte par code, sans nom ; alerte rouge permanente pour des cas normaux ; aucun motif d'échec d'e-mail, aucun suivi des rebonds Brevo, aucune alerte. Un `welcome` en échec est retenté toutes les 15 min sans plafond. | majeur | S à M |
| 7 | **Aucune liste à l'écran** : ni participants ni rendez-vous. Retrouver une personne le jour J, c'est télécharger un CSV sur son téléphone. Pas de « renvoyer le lien », pas de « qui n'a pas activé ». | majeur | L |
| 8 | **Aucune action sur un rendez-vous** : annuler, déplacer, bloquer une table ou un créneau. Le faire dans Strapi ne libère pas la table et ne prévient personne. | majeur | M |
| 9 | **RGPD** : pas d'effacement ; messages privés lisibles dans l'admin (contraire à R-63, P0) ; consentements modifiables à la main ; `newsOptIn` absent de l'export, donc consentement recueilli et inutilisable. | majeur | S pour masquer et exporter, L pour l'effacement |
| 10 | **Admin Strapi d'un développeur** : neuf réglages de l'édition sans libellé ni aide (`participantSpaceEnabled`, `tablesCount`, `helloassoFieldMap` en JSON brut...) ; heures en texte libre qui doivent s'écrire « 10h45 », sinon aucun créneau et aucun message ; brouillon enregistré sans publication, donc sans effet ; participants listés par identifiant HelloAsso et exposants par numéro de stand ; types techniques (jetons, messages, journaux) exposés. | majeur | S à M |
| 11 | **Pilotage introuvable sur téléphone** : absent de la barre d'onglets, accessible par un bouton en bas du profil. Et l'organisateur doit d'abord passer l'écran de bienvenue du participant. | majeur le jour J | S |
| 12 | **Pas de lecture seule** après l'événement : seul l'arrêt total existe, qui coupe aussi les exports. | majeur après le 3/12 | M |
| 13 | **MCP** : ne couvre pas l'espace ; son README recommande un jeton « Full access » illimité passé dans l'URL ; `delete_entry` sans garde. | majeur (sécurité) | S |
| 14 | **Badges** (12-badges, P1, attendus avant le 2 décembre) : rien n'est commencé. L'export participants sert de repli. | à décider | L, 2 à 3 jours |
| 15 | Détails : chiffres non rafraîchis avec une ancienneté qui avance ; « Profils complets » compté dès 70 % ; régénération des créneaux sans confirmation ; export sans date dans le nom ; pas de sélecteur d'édition. | mineur | S |

## 4. Plan de développement

Efforts : S moins de 2 h, M une demi-journée, L un jour ou plus. La charge du lot 1 dépasse une journée d'un seul développeur : elle suppose deux flux en parallèle (configuration et exploitation d'un côté, code de l'autre) et le tester en continu.

### Décisions à prendre d'abord

1. **Relances** : elles ne tiennent pas proprement avant le 20 avec le reste. Proposition : ouvrir le 20 avec le seul `welcome`, livrer les relances le 25 pour l'envoi du 27, le récapitulatif de la veille pour le 2 décembre.
2. **Badges** : les faire (2 à 3 jours, après le lot 3) ou s'en tenir à l'export pour cette édition.
3. **Case précochée** « rendez-vous et messages » : validation écrite de Xylofutur, ou retour à décoché.
4. **Xylofutur doit fournir avant le 19** : adresse d'expédition, liste des organisateurs, fichier exposants et intervenants, texte de confidentialité, confirmation des champs HelloAsso sur tous les tarifs.

### Lot 1, mercredi 18 : pouvoir ouvrir sans casse

| Tâche | Effort |
|---|---|
| `EMAIL_FROM` et `ORGANIZER_EMAILS` en prod, numéro de version, premier envoi réel par Brevo (SPF, DKIM, rendu Gmail et Outlook) | S à M |
| Interdire `reset_db` en prod ; sauvegarde manuelle documentée, puis tâche quotidienne jusqu'au 4/12 | M |
| Essai HelloAsso réel sur preprod (pagination, doublons, champs Organisation et Poste) | M |
| Limite de débit : plafond par IP relevé nettement, la limite par adresse reste | S |
| `/connexion` et `/espace/verifier` : rediriger si la session est active, conserver la destination | S |
| Page d'erreur de l'espace (`500.astro`), accueil qui distingue « aucun rendez-vous » d'une erreur | S |
| Ouverture en deux temps : accès organisateur espace fermé, envoi des `welcome` par un bouton avec décompte et confirmation, jamais la nuit | M |
| Gardes Strapi : refus de supprimer un participant, un créneau ou une pause qui porte un rendez-vous ; refus d'une date de fermeture passée ; `slug` verrouillé après ouverture | S à M |
| Masquer les types techniques dans l'admin (messages, jetons, journaux), champs internes en lecture seule | S |

### Lot 2, jeudi 19 matin, avant la recette

| Tâche | Effort |
|---|---|
| Accueil : carte « demandes à traiter » ; agenda : lien vers la fiche du demandeur, « Écrire à », rafraîchissement au retour au premier plan | S à M |
| Bienvenue : dire ce que chaque case change, rappel sur l'accueil si l'on est invisible | S |
| Pilotage : lien dans la navigation mobile, état réel de la dernière synchronisation, erreurs nominatives, `newsOptIn` dans l'export | S à M |
| Libellés et aides en français des réglages d'édition et des séquences, champ principal des types de l'espace | M |
| Accents des titres (police de repli), « le garder », libellés des e-mails | S |
| Audits axe et Lighthouse sur preprod, essai iPhone et Android du parcours T-50, CSV dans Excel FR | M |

Vendredi 20 : sauvegarde, bascule, synchronisation réelle, contrôle de cinq fiches avec le référent, envoi des `welcome`, surveillance deux heures.

### Lot 3, du 23 au 26 novembre : relances et jour J

| Tâche | Effort |
|---|---|
| Relances : trois gabarits, tâche planifiée, idempotence, plage 8 h à 20 h, `List-Unsubscribe`, tests T-33 et T-34 | L |
| Relance manuelle avec aperçu et décompte dans le pilotage (F-92) | M |
| Hors ligne : agenda et programme en cache dans le service worker | M |
| Rafraîchissement des badges et de la liste des messages ; e-mail de message plus rapide | M |
| Pilotage : liste des participants avec recherche, renvoi de lien, statut d'activation, derniers e-mails et leur motif d'échec | L |
| Pilotage : annuler un rendez-vous ou bloquer une table, avec notification | M |
| Corrections manuelles respectées par la synchronisation ; désinscription qui annule et prévient | M |
| Connexion par code à six chiffres, si l'essai sur iPhone confirme le problème | L |

### Lot 4, du 27 novembre au 2 décembre

| Tâche | Effort |
|---|---|
| Récapitulatif de la veille, avec tables, horaires et demandes expirées | compris dans le lot 3, envoi le 2 |
| Annuaire : filtres dans l'URL, sujets sur les cartes, retrait de soi-même | M |
| Profil : enregistrement par section ou alerte de modifications non enregistrées | M |
| Programme et agenda le jour J : « en cours », « à suivre », mes rendez-vous dans le programme | M |
| Badges, si retenus | L |
| Essai de charge à 200 participants et 600 rendez-vous (NF-21) | M |

### Lot 5, après l'événement

Suppression et anonymisation des données, purge à 12 mois, mode lecture seule, sélecteur d'édition, champs « je cherche / je propose », signalement d'un message, flux d'abonnement calendrier, webhook HelloAsso, MCP sécurisé et documenté, rôle d'administration restreint pour Xylofutur.

### Dette documentaire à solder en parallèle

Comptes rendus `phase-1.md` à `phase-3.md` inexistants, `strapi/tests/SPEC.md` arrêté au 31 octobre, `06-api.md` qui liste des routes absentes, F-10 et R-40 à mettre en accord avec D-07, `docs/espace/CLAUDE.md` qui situe encore la recette sur dev alors qu'elle se fera sur preprod.
