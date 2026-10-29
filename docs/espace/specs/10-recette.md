# 10. Recette

## Jeu de données (`seed`)

- Édition « nouvelle-aquitaine-test » : 3 décembre, pauses B2B 10h45 à 11h15, 12h30 à 14h00, 15h30 à 16h00, pas de 15 min, 3 tables (capacité volontairement faible pour tester la saturation), fenêtre de RDV ouverte.
- 5 sujets : Forêt et adaptation ; Process, data et IA ; Économie circulaire ; Territoires résilients ; Construction bois.
- 12 participants fictifs (dont 2 sans consentement annuaire, 1 annulé), 2 intervenants liés à des Speaker, 2 exposants (stands 4 et 12) avec 2 et 1 représentants, 1 organisateur.
- Noms de personnes et d'entreprises **fictifs** uniquement.

## Scénarios

| Id | Scénario | Résultat attendu |
|---|---|---|
| T-01 | Demande de lien pour un inscrit | E-mail `access-link` journalisé, lien valable 30 min |
| T-02 | Demande de lien pour un e-mail inconnu | Même message, aucun e-mail |
| T-03 | Lien réutilisé ou expiré | Écran « lien plus valable » |
| T-04 | 6 demandes de lien en 15 min | 429 à la 6e |
| T-05 | Import bac à sable deux fois | Aucun doublon, SyncRun cohérents |
| T-06 | Commande annulée côté HelloAsso | Attendee `cancelled`, rendez-vous annulés et notifiés (R-18) |
| T-10 | Première connexion sans rien cocher | Invisible dans l'annuaire et les suggestions, peut demander un RDV |
| T-11 | Recherche « econ » | Trouve « Économie circulaire » (accents ignorés) |
| T-12 | Accès direct à la fiche d'un participant sans consentement | 404 |
| T-13 | Fiche d'un autre participant | Aucun e-mail dans la réponse API |
| T-14 | Demande de RDV valide | `pending`, e-mail à la cible avec bouton Accepter |
| T-15 | Acceptation | `accepted`, plus petite table libre, .ics joint au demandeur |
| T-16 | Deux demandes en attente pour la même cible et le même créneau, acceptation de l'une | L'autre passe `declined` avec notification (R-15) |
| T-17 | 20 demandes concurrentes acceptées sur un créneau à 3 tables | 3 acceptées au plus, tables 1 à 3 sans collision, les autres en erreur `NO_TABLE_LEFT` |
| T-18 | Demande sur un créneau où le demandeur a déjà un RDV | 409 `SLOT_TAKEN` |
| T-19 | Demande à un exposant à 2 représentants sur un même créneau, 3 fois | 2 acceptations possibles, la 3e refusée |
| T-20 | Contre-proposition | Demande initiale `declined`, nouvelle demande dans l'autre sens |
| T-21 | Annulation d'un RDV accepté | `cancelled`, table libérée, notification |
| T-22 | Fermeture de la fenêtre | Demandes `pending` passent `expired` |
| T-23 | Export .ics | Fichier valide (validateur RFC 5545), fuseau Europe/Paris |
| T-24 | Participant A tente d'accepter une demande adressée à B | 403 |
| T-30 | Premier message à une personne sans `meetingsOptIn` | 403 `TARGET_UNAVAILABLE` |
| T-31 | Message non lu après 5 min | Un seul e-mail `new-message` sur 30 min |
| T-32 | 31 messages en une heure | 429 au 31e |
| T-33 | Relance profil lancée deux fois le même jour | Un seul envoi par personne (R-71) |
| T-34 | Relance programmée à 21h00 | Différée à 8h00 (R-72) |
| T-40 | Tableau de bord | Indicateurs égaux aux comptes de l'export CSV |
| T-41 | Export participants ouvert dans Excel FR | Accents corrects, colonnes séparées |
| T-42 | Participant non organisateur sur `/organisateur` | 403 |
| T-43 | Navigation clavier complète E0 à E8 | Tous les éléments atteignables, focus visible |
| T-44 | Lighthouse mobile E1, E4, E5 | ≥ 90 accessibilité et performance |
| T-45 | Installation PWA sur Android et iOS | Icône, ouverture plein écran, connexion conservée |
| T-50 | Parcours complet : import, lien, consentement, profil, recherche, demande, acceptation par la cible, message, agenda, .ics, tableau de bord | Sans erreur, sur mobile, en moins de 5 minutes par participant |
