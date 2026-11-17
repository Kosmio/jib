# Charge de l'espace participant, 18 novembre 2026 (V4-E, T-73, NF-21)

## Conditions

- Script : `strapi/tests/load/run.js`, lancé par `TZ=UTC node --require ./tests/helpers/no-network.js tests/load/run.js` depuis `strapi/`. Base `strapi_load_test`, supprimée à la fin (dropdb).
- Jeu : 200 participants actifs (annuaire et rendez-vous consentis), 600 rendez-vous répartis à parts égales entre pending, accepted et declined sur les 10 créneaux de l'édition, 1 organisateur.
- Charge : 20 utilisateurs simultanés, 30 s par route, routes mesurées l'une après l'autre, une session par utilisateur (`/me`, `/directory`, `/meetings`) ou la session de l'organisateur (`/admin/charge/stats`, `/admin/charge/attendees`). Mesure côté client, de l'envoi à la lecture complète du corps.
- Seuil : p95 de 300 ms (NF-21).
- Machine : poste de développement, Apple M2, 8 coeurs, 16 Go, Node 24.22.1, Postgres dans Docker Desktop (`jib-postgres`), mémoire limitée (0,4 à 1 Go libres pendant les mesures, autres projets actifs). **La prod est différente** (serveur dédié, Postgres hors Docker Desktop, mémoire non saturée) : ces chiffres sont indicatifs.
- Biais connu : Strapi et le générateur de charge partagent le même processus Node (helpers existants), donc le même boucle d'événements. Les latences incluent le coût du client et sont pessimistes.

## Résultats (exécution retenue)

| Route | Requêtes | p50 ms | p95 ms | max ms | SQL par appel | Octets | Seuil 300 ms |
|---|---|---|---|---|---|---|---|
| GET /me | 1642 | 351 | 509 | 868 | 20 | 660 | dépassé |
| GET /directory | 1991 | 295 | 386 | 505 | 25 | 5766 | dépassé |
| GET /meetings | 883 | 694 | 823 | 890 | 37 | 7232 | dépassé |
| GET /admin/charge/stats | 1734 | 347 | 418 | 534 | 35 | 1292 | dépassé |
| GET /admin/charge/attendees | 4359 | 131 | 195 | 583 | 15 | 7034 | tenu |

Toutes les réponses sont des 200. Une première exécution, avec seulement 200 rendez-vous (défaut du générateur, corrigé), donnait des p95 de 403, 591, 470, 487 et 427 ms : l'ordre de grandeur est le même, avec une variabilité de 20 à 30 % d'une exécution à l'autre sur cette machine (`/me` : p50 289 puis 351 ms, sans changement de code).

Le nombre de requêtes SQL est compté par le journal de knex (événement `query`) sur un appel isolé, hors charge.

## Causes probables, routes hors seuil

Chaque requête authentifiée paie d'abord `loadSession` (`strapi/src/api/espace/services/auth.js` : jeton avec participant et édition, puis édition publiée : environ 10 à 15 des requêtes SQL de `/me`).

- **GET /meetings** (823 ms, la pire) : `load()` de `strapi/src/api/espace/services/meetings.js` (lignes 75 à 98) charge à chaque appel toute l'édition : créneaux, les 200 participants avec leurs relations de carte, exposants et les 600 rendez-vous avec leurs relations, puis filtre en mémoire (`attendees.some(...)` imbriqué dans la boucle des rendez-vous, quadratique : 600 x 200). Le coût croît avec la taille de l'édition, pas avec celle de l'utilisateur. Piste : ne lire que les rendez-vous du participant.
- **GET /admin/:edition/stats** (418 ms) : `strapi/src/api/espace/services/stats.js` (lignes 74 à 88) charge en entier les participants, les rendez-vous, les créneaux et les exposants pour les compter en mémoire (35 requêtes). Piste : des `count` SQL ou un cache de quelques secondes.
- **GET /directory** (386 ms, p50 295 ms) : `strapi/src/api/espace/controllers/directory.js`, 25 requêtes, charge toute la population de l'édition pour filtrer et paginer en mémoire.
- **GET /me** (509 ms) : seulement 660 octets mais 20 requêtes SQL, dont l'essentiel est la session. Le p95 reflète surtout la saturation du processus partagé avec le générateur et le Docker Desktop sous charge ; à confirmer par une mesure sur un Strapi séparé du générateur.

`GET /admin/:edition/attendees` (15 requêtes, paginée) tient le seuil avec une marge.

## Limites

Mesure unique de 30 s par route, sur une machine chargée, générateur et serveur dans le même processus. Pour trancher les cas proches du seuil (`/directory`, `/me`), refaire la mesure avec un Strapi dans son propre processus. Aucune correction n'a été faite : le lot est de test seul.

## Après le lot PERF (lot/perf-meetings-stats, NF-21)

Changements : `GET /meetings`, `GET /slots` et `GET /meetings.ics` ne lisent plus toute l'édition (rendez-vous de la personne, ou pending et accepted pour les créneaux ; participants limités à la personne, aux contreparties, aux tables dédiées et à la cible) ; l'écarté des orphelins (NF-67) et `findMeeting` passent par des Set et Map ; `stats` compte les rendez-vous en base (deux requêtes groupées knex sur les tables de liaison Strapi 5) au lieu de les charger. Mêmes formes de réponse, mêmes règles.

Mesure sur la même machine, même script, avant puis après (le même jour, exécutions successives) :

| Route | p95 avant (ms) | p95 après (ms) | p50 avant / après | SQL avant / après |
|---|---|---|---|---|
| GET /me (non modifié, témoin de bruit) | 259 | 540 | 200 / 353 | 20 / 20 |
| GET /directory (non modifié) | 359 | 445 | 219 / 325 | 25 / 25 |
| GET /meetings | 685 | 526 | 550 / 349 | 37 / 47 |
| GET /admin/charge/stats | 435 | 527 | 336 / 281 | 35 / 29 |
| GET /admin/charge/attendees (non modifié) | 135 | 254 | 106 / 157 | 15 / 15 |

Les routes non modifiées ont perdu 40 à 100 % entre les deux exécutions : la machine était plus chargée pendant la seconde, les p95 absolus ne se comparent donc pas. Lecture fiable : p50 de `/meetings` en baisse de 37 % malgré un bruit de fond en hausse, p50 de `/stats` en baisse de 16 %. Le seuil de 300 ms n'est toujours pas tenu sur ce poste ; le coût restant est la session (une dizaine de requêtes par appel) et le processus partagé avec le générateur. À refaire sur un Strapi séparé.
