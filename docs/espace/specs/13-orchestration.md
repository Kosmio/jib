# 13. Orchestration de la finalisation

Ce fichier s'adresse à l'agent **superviseur**. Il décrit comment découper, déléguer, intégrer et suivre les lots de `14-lots-finalisation.md` sans collision de branches. Origine des lots : `docs/espace/journal/2026-11-17-audit-ux-et-plan.md`.

Lecture obligatoire du superviseur, dans l'ordre : `docs/espace/CLAUDE.md`, ce fichier, `14-lots-finalisation.md`, puis `04-regles-metier.md` avant tout lot qui touche aux rendez-vous.

## 1. Rôles

| Rôle | Qui | Fait | Ne fait jamais |
|---|---|---|---|
| Superviseur | agent `architect` | découpe, lance les agents, tranche les ambiguïtés par les valeurs par défaut de la section 8, intègre, lance la suite complète, pousse, tient le tableau de suivi | n'écrit pas de code de lot, ne résout pas un conflit à la place du propriétaire du lot |
| Développeur de lot | agent `developer` | implémente un lot dans son arbre de travail, sur les seuls fichiers qu'il possède | n'écrit pas de tests, ne touche ni à la branche d'intégration ni aux fichiers d'un autre lot |
| Testeur de lot | agent `tester` | écrit et exécute les tests du lot, dans le même arbre de travail, sur `strapi/tests/**` et `web/tests/**` seulement | ne modifie pas le code applicatif |
| Designer | agent `designer` | relit les lots marqués « revue designer » avant intégration | n'écrit pas dans le dépôt |
| Mathieu | humain | décisions de la section 8, tâches humaines de `14`, déploiements | |

La règle du dépôt reste : aucun lot n'est intégré sans feu vert du testeur.

## 2. Modèle de branches

```
main                      production, intouchable
feat/espace-participant   branche d'intégration, seule branche poussée
lot/<id>-<nom>            une branche courte par lot, locale, jamais poussée
```

Règles, sans exception :

1. **Un lot = une branche = un arbre de travail.** Le superviseur lance chaque agent de lot avec l'isolation par arbre de travail (`isolation: "worktree"`). À défaut : `git -C <dépôt> worktree add ../jib-lots/<id> -b lot/<id>-<nom> feat/espace-participant`. Jamais deux lots dans le même arbre, jamais un lot dans le dépôt principal.
2. **Le dépôt principal reste sur `feat/espace-participant`.** On n'y change jamais de branche, on n'y fait ni `stash`, ni `reset`, ni `rebase`. Il porte des modifications locales hors périmètre qui doivent survivre (section 4).
3. **Seul le superviseur écrit sur `feat/espace-participant`**, et seulement par avance rapide (`merge --ff-only`). L'historique reste linéaire : pas de commit de fusion.
4. **Un lot part de la tête de la branche d'intégration** au moment où il démarre. Avant intégration, c'est le lot qui se remet à jour (`git rebase feat/espace-participant` dans son arbre), jamais l'inverse.
5. **Les branches de lot ne sont jamais poussées.** Seule `feat/espace-participant` l'est, par `git push` simple. Jamais de `--force`, sur aucune branche.
6. **Ni PR, ni déploiement, ni `make build`, ni `make stage`** sans demande de Mathieu. La poussée de `feat/espace-participant` en fin de lot est autorisée.
7. Dans un arbre de lot, les commits suivent la règle du dépôt : `git add <chemins>` puis `git commit -m "…" -- <chemins>`, jamais `git add -A`, `git add .` ni `git commit -a`. Le message cite les identifiants d'exigences et se termine par la ligne `Co-Authored-By` du modèle qui a travaillé.

## 3. Propriété des fichiers

Les conflits se préviennent à la découpe, pas à la fusion.

- Chaque lot de `14` liste ses **fichiers possédés**. Un agent ne modifie rien d'autre. S'il lui faut un fichier hors liste, il s'arrête et le demande au superviseur.
- Un **fichier chaud** (liste ci-dessous) appartient à un seul lot par vague. La colonne « Vague » de `14` en tient compte : deux lots de la même vague ne partagent aucun fichier.
- **Créer plutôt que modifier.** Strapi charge chaque fichier de `strapi/src/api/espace/routes/` : une fonction nouvelle arrive avec son fichier de routes, son contrôleur et son service. Côté pilotage, chaque carte est un composant dans `web/src/react-components/espace/organizer/` (structure posée par le lot V1-C).
- Tests : un fichier nouveau par lot, nommé d'après le lot (`strapi/tests/unit/<sujet>.test.js`, `web/tests/e2e/espace-<sujet>.spec.ts`). Les fichiers de test partagés sont des fichiers chauds.

Fichiers chauds :

| Fichier | Pourquoi |
|---|---|
| `strapi/src/index.js` | amorçage, libellés d'admin, gardes |
| `strapi/config/cron-tasks.js` | toutes les tâches planifiées |
| `strapi/src/api/espace/services/meetings.js`, `lib/meetings.js` | cœur des rendez-vous |
| `strapi/src/api/espace/services/sync.js`, `lib/import.js` | import HelloAsso |
| `strapi/src/api/espace/services/auth.js`, `services/mailer.js` | accès, envois |
| `strapi/src/api/edition/content-types/edition/schema.json`, `strapi/src/api/espace/content-types/attendee/schema.json` | schémas partagés |
| `web/src/middleware.ts`, `web/src/lib/espace/api.ts`, `web/src/layouts/EspaceLayout.astro`, `web/src/components/espace/AppShell.astro` | enveloppe de l'espace |
| `web/src/pages/espace/[edition]/index.astro` | accueil |
| `web/src/react-components/espace/AgendaBoard.tsx`, `ProfileForm.tsx`, `OrganizerPanel.tsx`, `SlotPicker.tsx` | gros îlots |
| `web/public/espace/sw.js`, `web/src/styles/espace.css` | |
| `web/package.json`, `strapi/package.json`, les `pnpm-lock.yaml` | dépendances |
| `infra/deploy/**`, `.github/workflows/**`, `VERSION` | déploiement |
| `strapi/tests/helpers/env.js`, `strapi/tests/unit/conventions.test.js`, `strapi/tests/SPEC.md`, `strapi/tests/fixtures/**`, `strapi/scripts/espace/seed.js`, `web/tests/e2e/fixtures.ts` | socle de test |
| `docs/espace/**` | propriété du superviseur |

## 4. Fichiers interdits à tous les lots

Jamais modifiés, jamais commités : `.claude/launch.json`, `strapi/.strapi-updater.json`, `strapi/types/generated/contentTypes.d.ts`, `web/.astro/**`, `.vscode/**`, `web/package-lock.json`, tout fichier `.env` non versionné. Un lot dont un commit contient l'un d'eux est refusé à l'intégration.

Rappels du dépôt qui valent pour chaque lot : pas de tiret cadratin dans les textes de l'espace, typographie française, données fictives en `@example.org`, aucun changement du type d'une relation existante (A-15), jamais `strapi.plugin('email')`, bases `strapi` et `strapi_espace` intouchables.

## 5. Ressources par créneau d'exécution

Trois créneaux de lot au plus tournent en même temps (Docker Desktop fige au-delà). Chaque créneau a ses bases et ses ports ; le superviseur garde les valeurs par défaut.

| Créneau | `TEST_DATABASE` | `E2E_DATABASE` | `E2E_STRAPI_PORT` | `E2E_WEB_PORT` |
|---|---|---|---|---|
| superviseur | `strapi_test` | `strapi_e2e` | 1348 | 4332 |
| 1 | `strapi_c1_test` | `strapi_c1_e2e` | 1358 | 4342 |
| 2 | `strapi_c2_test` | `strapi_c2_e2e` | 1368 | 4352 |
| 3 | `strapi_c3_test` | `strapi_c3_e2e` | 1378 | 4362 |

- Dans un arbre neuf : `corepack pnpm@12.15.0 --dir <arbre>/strapi install`, puis la même commande pour `web` si le lot touche au front. Les tests sont hermétiques (`buildTestEnv`), aucun `.env` n'est nécessaire.
- Un agent de lot lance les tests unitaires et les tests d'intégration **de son sujet** avec les variables de son créneau. La suite complète et les tests de bout en bout sont lancés par le superviseur, un à la fois.
- Aucun agent de lot ne démarre de serveur de développement sur 1337 ou 4321.
- Si Docker fige : attendre, relancer Docker Desktop, puis `docker start jib-postgres`. Si le conteneur refuse de démarrer sur un fichier de verrou vide, le recréer (`docker rm jib-postgres` puis `make -C <dépôt> infra-up`) : les données sont sur le disque de l'hôte.

## 6. Cycle d'un lot

1. **Lancement.** Le superviseur vérifie que les dépendances du lot sont intégrées, attribue un créneau, lance le testeur puis le développeur avec le gabarit de la section 9. Le testeur écrit d'abord les tests à partir des critères d'acceptation, marqués `pending('<id du lot>')`.
2. **Réalisation.** Le développeur implémente, commit par petites unités. Le testeur retire les marqueurs, complète, exécute.
3. **Compte rendu.** Chaque agent rend le gabarit de la section 10. Un compte rendu n'est pas une preuve : le superviseur relit le `git diff --stat feat/espace-participant...lot/<id>` et refuse tout fichier hors de la liste du lot.
4. **Intégration**, un lot à la fois, dans cet ordre exact :
   1. dans l'arbre du lot : `git rebase feat/espace-participant`. En cas de conflit, le lot retourne à son développeur ; le superviseur ne tranche pas un conflit de code.
   2. dans l'arbre du lot : tests unitaires et d'intégration du lot, verts après remise à jour.
   3. dans le dépôt principal : `git merge --ff-only lot/<id>-<nom>`.
   4. dans le dépôt principal : suite Strapi complète, construction du front, tests de bout en bout.
   5. vert : `git push`, puis suppression de l'arbre et de la branche du lot (`git worktree remove`, `git branch -d`). Rouge : `git revert` des commits du lot sur la branche d'intégration, jamais de `reset`, et retour au développeur.
5. **Suivi.** Le superviseur met à jour `docs/espace/journal/suivi-finalisation.md` (section 11) et, si une connaissance opérationnelle se confirme, `docs/espace/CLAUDE.md`.

Une vague est close quand tous ses lots sont intégrés ou explicitement reportés, que la suite complète est verte sur la tête poussée et que la CI `Tests` est verte.

## 7. Contrats entre lots

Quand un lot dépend de l'interface d'un autre lot de la même vague, cette interface est figée dans `14` (routes, forme des réponses, propriétés d'un composant). Les deux lots la respectent à la lettre et le lot consommateur s'intègre en second. Toute modification d'un contrat passe par le superviseur, qui prévient les deux agents et corrige `14`.

Toute route nouvelle ou modifiée est reportée dans `06-api.md` par le superviseur à l'intégration, tout champ nouveau dans `02-modele-donnees.md`, toute variable d'environnement dans `docs/espace/CLAUDE.md`, `strapi/tests/helpers/env.js`, `infra/deploy/base/docker-compose.base.yml` et les trois fichiers d'overlay.

## 8. Décisions et valeurs par défaut

Le superviseur applique la valeur par défaut sans attendre, la consigne au suivi, et ne bloque que sur les lignes marquées « bloquant ».

| # | Décision | Valeur par défaut | Bloquant |
|---|---|---|---|
| D-12 | Relances au 20 novembre | ouverture avec le seul `welcome` ; relances livrées en vague 3 pour l'envoi du 27 | non |
| D-13 | Badges | **tranché par Mathieu le 17 novembre : réalisés pour cette édition, obligatoires.** V4-D est lancé en vague 4. Questions ouvertes de `12-badges.md` : imprimante de bureau A4, marges de 10 mm ; logo du site existant (`web/public`) en attendant le vectoriel ; texte NF-56 tel qu'écrit, à valider par Xylofutur ; pas de badge hors Attendee | non |
| D-14 | Case « rendez-vous et messages » précochée (D-07) | inchangée, et signalée à Xylofutur ; le texte de l'écran de bienvenue la rend explicite (V2-B) | non |
| D-15 | Numéro de version de l'espace | `0.2.0` | non |
| D-16 | Plafond de demandes de lien par adresse IP | 60 par 15 min, réglable par `LINK_RATE_IP_MAX` ; 5 par adresse e-mail inchangé | non |
| D-17 | Connexion par code à six chiffres (V3-G) | **tranché par Mathieu le 17 novembre : réalisée sans attendre l'essai H-5.** Le code complète le lien, il ne le remplace pas | non |
| D-18 | Adresse d'expédition, liste des organisateurs, texte de confidentialité, fichier exposants | fournis par Xylofutur ; les lots posent la tuyauterie, pas les valeurs | oui pour la mise en production, non pour le code |

Ce qui remonte à Mathieu, et rien d'autre : une décision bloquante de ce tableau, un conflit que le propriétaire d'un lot ne sait pas résoudre, une suite rouge après deux tentatives de correction, toute action sur la prod, la preprod, les secrets GitHub ou une image Docker.

## 9. Gabarit de consigne à un agent de lot

```
Tu es le <développeur|testeur> du lot <ID> « <titre> » de l'espace participant JIB.
Arbre de travail : <chemin>. Branche : lot/<id>-<nom>, issue de feat/espace-participant à <sha>.
Lis en entier, dans l'ordre : docs/espace/CLAUDE.md, docs/espace/specs/13-orchestration.md (sections 2 à 5),
la section <ID> de docs/espace/specs/14-lots-finalisation.md, puis <specs citées par le lot>.

Fichiers que tu possèdes : <liste du lot>. Tu ne modifies aucun autre fichier. S'il t'en faut un autre,
arrête-toi et dis lequel et pourquoi.
Créneau <n> : TEST_DATABASE=<…> E2E_DATABASE=<…> E2E_STRAPI_PORT=<…> E2E_WEB_PORT=<…>.
Terminé quand : chaque critère d'acceptation du lot est couvert par un test vert, les suites <…> passent,
tout est commité sur ta branche avec des chemins explicites. Tu ne pousses rien, tu ne touches pas à
feat/espace-participant, tu ne lances ni la suite complète ni un serveur sur 1337 ou 4321.
Rends le compte rendu de la section 10.
```

## 10. Gabarit de compte rendu d'un agent de lot

```
Lot <ID>, <rôle>. Branche lot/<id>-<nom>, tête <sha>.
Fait : <exigence par exigence, avec fichier:ligne>.
Non fait ou partiel : <et pourquoi>.
Fichiers modifiés : <sortie de git diff --stat feat/espace-participant...HEAD>.
Tests : <commande exacte, nombre de tests, résultat>.
Hypothèses appliquées : <référence à 11-questions-ouvertes ou à la section 8>.
Interfaces exposées ou consommées : <routes, propriétés>.
Risques et points à vérifier par le superviseur : <…>.
```

## 11. Tableau de suivi

Le superviseur tient `docs/espace/journal/suivi-finalisation.md`, une ligne par lot :

| Lot | Vague | État | Créneau | Branche | Tête | Tests du lot | Intégré le | Reste, blocage |
|---|---|---|---|---|---|---|---|---|

États : à lancer, tests d'abord, en cours, à relire, à intégrer, intégré, reporté, bloqué. Sous le tableau : les décisions appliquées, les écarts aux specs, la dette créée. Ce fichier remplace les comptes rendus de phase manquants pour la période et sert de base à `phase-3.md`.
