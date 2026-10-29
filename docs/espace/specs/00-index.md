# 00. Index des spécifications

| Fichier | Contenu | Lu par |
|---|---|---|
| `01-contexte-perimetre.md` | Objectifs, personas, périmètre, hors périmètre | tous |
| `02-modele-donnees.md` | Types de contenu Strapi, champs, relations, index | architect, developer, tester |
| `03-ecrans.md` | Les 10 écrans, éléments, états, comportements, critères d'acceptation | designer, developer, tester |
| `04-regles-metier.md` | Créneaux, rendez-vous, tables, statuts, visibilité, messagerie | tous |
| `05-integrations.md` | HelloAsso, connexion par lien magique, e-mails, calendrier | architect, developer, tester |
| `06-api.md` | Contrat des routes HTTP de l'espace participant | developer, tester |
| `07-design.md` | Tokens issus du site actuel, composants, accessibilité | designer, developer |
| `08-non-fonctionnel.md` | Sécurité, RGPD, performance, sobriété, accessibilité, exploitation | tous |
| `09-phases.md` | Découpage en phases, dates, portes de validation | architect |
| `10-recette.md` | Scénarios de bout en bout et jeu de données de recette | tester |
| `11-questions-ouvertes.md` | Points non tranchés et hypothèses par défaut | architect |

## Maquettes de référence

Les 9 maquettes validées (accueil, connexion, annuaire, fiche et demande, agenda, messagerie, programme, e-mail de relance, tableau de bord) sont sur le canevas Kosmio « Espace participant JIB, maquettes Kosmio ». Les captures sont dans `docs/espace/maquettes/` (fichiers `01-connexion.png` à `09-pilotage.png`). En cas d'écart entre maquette et spec, **la spec fait foi** pour le comportement, **la maquette** pour l'aspect.

## Conventions d'identifiants

- `F-xx` exigence fonctionnelle (dans `03-ecrans.md`)
- `R-xx` règle métier (dans `04-regles-metier.md`)
- `I-xx` intégration (dans `05-integrations.md`)
- `NF-xx` exigence non fonctionnelle (dans `08-non-fonctionnel.md`)
- `T-xx` scénario de recette (dans `10-recette.md`)

Priorités : **P0** indispensable au 20 novembre, **P1** souhaitable si le temps le permet, **P2** à préparer dans le modèle sans le développer.
