# 11. Questions ouvertes et hypothèses par défaut

Tant qu'une question n'est pas tranchée par Xylofutur, les agents appliquent l'hypothèse par défaut et la mentionnent dans le compte rendu de phase.

| Id | Question | Qui tranche | Hypothèse par défaut |
|---|---|---|---|
| Q-01 | Qui maintient le site et l'hébergement ? Accès au dépôt et à la base ? | Xylofutur | Bloquant pour la phase 0 : à obtenir le 2 novembre |
| Q-02 | Version de Strapi et base de données (SQLite, PostgreSQL) ? | Phase 0 | Adapter ; si SQLite en production, vérifier la tenue des transactions de R-13 |
| Q-03 | Libellés exacts des champs personnalisés HelloAsso (fonction, entreprise) | Xylofutur | Ajout demandé ; à défaut, saisie à la première connexion |
| Q-04 | Nombre de tables disponibles par créneau | Xylofutur | 20 |
| Q-05 | Durée d'un créneau | Xylofutur | 15 minutes |
| Q-06 | Ouverture et fermeture de la prise de RDV | Xylofutur | 20 novembre 10h00 au 2 décembre 18h00 |
| Q-07 | Demandes de RDV autorisées le jour J sur place ? | Xylofutur | Non en v1 (fenêtre fermée la veille) ; P1 : réouverture le jour J pour les créneaux de l'après-midi |
| Q-08 | Les exposants ont-ils tous un billet HelloAsso nominatif ? | Xylofutur | Oui ; rattachement au stand par l'organisateur dans Strapi |
| Q-09 | Fournisseur d'e-mail et domaine d'envoi (SPF, DKIM sur xylofutur.fr) | Xylofutur | Brevo, sous-domaine dédié ; configuration DNS à demander dès le 2 novembre |
| Q-10 | Texte de la politique de confidentialité de l'espace | Xylofutur | Brouillon fourni par l'équipe, validation Xylofutur avant le 19 novembre |
| Q-11 | Domaine de l'espace : même domaine que le site ? | Phase 0 | `journees-innovation-bois.xylofutur.fr/espace/…` |
| Q-12 | Nom des organisateurs ayant accès au tableau de bord | Xylofutur | Liste d'e-mails dans `ORGANIZER_EMAILS` |
| Q-13 | Le lien magique s'ouvre-t-il d'un seul clic dans l'e-mail ? Les analyseurs de liens des messageries d'entreprise (Outlook Safe Links, passerelles antivirus) ouvrent les URL avant le destinataire et consommeraient un jeton à usage unique | Mathieu | `/espace/verifier?token=…` affiche un bouton « Ouvrir mon espace » (formulaire, sans JavaScript) ; le jeton n'est consommé qu'au clic (F-03, I-20, I-21). Aucune action (accepter un rendez-vous) n'est exécutée par un simple GET |
| Q-14 | Polices de l'espace : le site charge Sora et Source Sans 3 depuis Google Fonts (service tiers, transmission de l'adresse IP), seule Azonix est servie par le site | designer, Mathieu | L'espace sert Sora et Source Sans 3 depuis `web/public/fonts` (woff2, sous-ensemble latin) et n'appelle pas Google (NF-07, NF-23) ; le site public reste inchangé |
| Q-15 | Quels états de billet HelloAsso importer ? | architecte | `Processed` et `Registered` : actif. `Canceled`, `Refused`, `Deleted`, `Abandoned`, ou paiement `Refunded` : `cancelled` si déjà importé, sinon ignoré. `Waiting` et `Unknown` : ignoré jusqu'au changement d'état, signalé dans `SyncRun.errors` |
| Q-16 | Adresse d'expédition des e-mails de l'espace (`EMAIL_FROM`) : le site n'envoie aujourd'hui que des gabarits Brevo, dont l'expéditeur est réglé dans Brevo | Mathieu | Une adresse du domaine d'envoi déjà vérifié dans Brevo (Q-09), au nom « Journées de l'Innovation Filière Bois » ; d'ici là, `ConsoleMailProvider` |
| Q-17 | Population du jeu de recette (`10-recette.md`) : les intervenants et représentants sont-ils comptés parmi les 12 participants ? | architecte | Non : 12 participants, plus 2 intervenants et 3 représentants d'exposants, soit 17 billets fictifs ; l'organisateur se connecte par `ORGANIZER_EMAILS`, sans billet |

## Réponses et décisions au 29 octobre 2026

| Id | Réponse | Source |
|---|---|---|
| Q-01 | Dépôt GitHub `Kosmio/jib`, maintenu par Kosmio. Serveurs dev et prod déployés par le workflow Deploy (GitHub Actions, SSH). | constat |
| Q-02 | Strapi 5.59 sur PostgreSQL 17, en dev comme en prod. Les transactions requises par R-13 sont disponibles. | constat |
| Q-04, Q-05, Q-06 | Réglables dans Strapi pour chaque édition (`tablesCount`, `slotDurationMinutes`, `meetingRequestsOpenAt`, `meetingRequestsCloseAt`). Les hypothèses par défaut servent de valeurs initiales. | Mathieu |
| Q-09 | Même compte et même domaine d'envoi Brevo que le site actuel (formulaire de contact, newsletter). | Mathieu |
| Q-11 | Même domaine confirmé : Traefik sert le site sur `/` et Strapi sur `/strapi`. Le cookie de session (I-22) est posé sur le domaine du site, sans proxy supplémentaire. | constat |
| Q-03 | Libellés relevés sur le formulaire Nouvelle-Aquitaine : « Email », « Organisation », « Poste », tous obligatoires. `helloassoFieldMap` de l'édition : `{ "email": "Email", "company": "Organisation", "jobTitle": "Poste" }`. Les autres questions (Type d'organisation, N° de téléphone, Code Postal, Accès PMR) ne sont pas importées (NF-11). | capture de Nétih, 29 octobre |
| Q-08 | Demandé à Xylofutur (Nétih), avec les identifiants API HelloAsso de production. En attendant, le développement se fait contre une organisation créée sur le bac à sable HelloAsso. | en attente |

| Id | Décision | Source |
|---|---|---|
| D-01 | Recette du 19 novembre sur le serveur de dev ; la prod reste inchangée jusqu'au 20 novembre (remplace l'alternative de la phase 4 de `09-phases.md`). | Mathieu |
| D-02 | Réalisation par l'équipe d'agents décrite dans `09-phases.md` (architecte, designer, developer, tester), avec les portes de validation prévues. | Mathieu |
| D-03 | Aucun paramètre d'édition en dur : tout ce qui varie d'une édition à l'autre se règle dans Strapi. | Mathieu |

## Constats préalables pour la phase 0

- Le programme vit dans le type `sequence` (titre, `start_time` et `end_time` en texte au format « 10h45 », relation `edition`). Pas de champ `kind` : les pauses B2B se repèrent aujourd'hui à leur titre. L'édition Nouvelle-Aquitaine compte déjà les trois pauses de R-01.
- Les intervenants sont le type `intervenant`, rattachés aux séquences par `intervention`.
- `partenaire` porte un rôle de soutien (soutien, co-organisateur, institutionnel, privé) entre une `organisation` et des éditions : ce n'est pas un exposant. Le type Exhibitor est à créer, en s'appuyant sur `organisation` pour le nom, le logo et la description.
- La couleur d'édition existe déjà : champ `hero_bg_color` (sélecteur de couleur), `#600e24` pour Nouvelle-Aquitaine.
- Les étiquettes `tag` mêlent thèmes et rôles ; les Topic par édition de `02-modele-donnees.md` restent à créer.
- Formulaire HelloAsso Nouvelle-Aquitaine (capture du 29 octobre) : Nom, Prénom et Accès PMR valent pour tous les montants, mais Email, Organisation et Poste ne sont rattachés qu'au tarif « Journée Innovation Filière Bois en Nouvelle-Auitaine » (coquille dans le nom, signalée). Le rattachement à tous les montants a été demandé à Xylofutur le 29 octobre. D'ici là, un billet d'un autre tarif arrive sans ces champs : l'import se replie sur `payer.email` (I-11) et une commande groupée produit des doublons d'e-mail (I-14).
- HelloAsso saisit « Email » en texte court, sans contrôle de format : l'import valide l'adresse et se replie sur `payer.email` si elle est invalide.
- L'information sur l'espace participant (I-15) prend la forme d'une phrase dans la description de la billetterie, demandée le 29 octobre. Pas de case à cocher côté HelloAsso : le consentement reste recueilli en E2 (R-40).

## Constats de la phase 0 (architecte, 29 octobre 2026)

Correspondance complète avec les types existants : `02-modele-donnees.md`. Décisions d'architecture : `docs/espace/journal/phase-0-plan.md`.

- **Versions installées** : Strapi 5.59.0, Astro 6.0.7 (adaptateur Node 10.0.4, mode `standalone`, `output: "server"`), React 19.2.4 par `@astrojs/react` 5.0.1, Tailwind 4.2.2, PostgreSQL 17 (image `postgres:17-alpine`), Node 24 (images Docker `node:24-alpine`), pnpm 12.15.0.
- **Édition** : pas de champs `name` ni `venue`. Le nom est `title`, le lieu est le composant répétable `lieux` (« Auditorium du Crédit Agricole, 106 Quai de Bacalan, 33300 Bordeaux » pour Nouvelle-Aquitaine), `date` est une date sans heure. Les éditions, séquences, interventions, intervenants et organisations sont en brouillon et publication.
- **Billetterie Nouvelle-Aquitaine** : `inscription_url` donne l'organisation HelloAsso `xylofutur-produits-et-materiaux-des-forets-cultivees` et le formulaire `journee-regionale-de-l-innovation-en-nouvelle-aquitaine` (type `Event`). Ce sont les valeurs initiales de `helloassoOrgSlug` et `helloassoFormSlug`, à confirmer avec les identifiants API (Q-08).
- **États HelloAsso** (documentation de l'endpoint `items`) : un billet vaut `Waiting`, `Processed`, `Registered`, `Deleted`, `Unknown`, `Canceled`, `Refused` ou `Abandoned`. Il n'existe pas d'état « remboursé » au niveau du billet : le remboursement se lit sur ses paiements. Les champs personnalisés ne sont renvoyés qu'avec `withDetails=true`. Traitement retenu : Q-15.
- **Programme Nouvelle-Aquitaine** : les horaires sont du texte sans zéro initial (« 9h15 ») ou « -- ». Le champ `order` est vide : un tri sur le texte place « 18h00 » avant « 9h15 », il faut trier sur l'heure analysée. La mention « (les horaires sont indiqués à titre provisoire) » est une séquence sans horaire (F-80) ; la « Conférence de clôture » n'a qu'une heure de fin. Les trois pauses de R-01 (« Pause et B2B » à 10h45 et à 15h30, « Cocktail déjeunatoire & B2B » à 12h30) devront recevoir `kind = b2b_break` à la main, en brouillon puis publication, à la mise en production.
- **Polices** : le site charge Sora et Source Sans 3 depuis Google Fonts ; seule Azonix est servie par le site (`web/public/fonts/Azonix.otf`). Voir Q-14.
- **E-mails existants** : le formulaire de contact et la newsletter appellent Brevo directement (`@getbrevo/brevo` 5, gabarits Brevo, clé `EMAIL_API_KEY`). Le plugin e-mail de Strapi est resté sur son fournisseur par défaut (sendmail) : l'espace ne doit jamais l'utiliser.
- **Démarrage de Strapi** : sur une base vide, le bootstrap (`strapi/src/index.js`) crée des éditions de démonstration et téléverse les images de `strapi/seed-assets/`.
- **Déploiement** : les images Docker sont étiquetées par le fichier `VERSION` (0.1.0), qui est aussi la version déployée en prod. Construire une image de la branche sans changer `VERSION` exposerait la prod au code de l'espace au prochain redémarrage. Chaque variable d'environnement de Strapi est listée une à une dans `infra/deploy/base/docker-compose.base.yml` : toute nouvelle variable doit y être ajoutée.
- **Strapi derrière Traefik** : `config/server.js` ne règle pas `proxy.koa`. Sans ce réglage, Strapi voit l'adresse IP de Traefik (limitation de débit de E0 inopérante) et refuse de poser un cookie `Secure`.
