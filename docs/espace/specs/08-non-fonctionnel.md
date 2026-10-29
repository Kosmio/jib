# 08. Exigences non fonctionnelles

## Sécurité

- **NF-01 (P0)** Toutes les routes de l'espace vérifient session, édition et droits sur chaque objet (pas de contrôle uniquement côté front). Tests d'accès croisés obligatoires (un participant A ne lit ni ne modifie rien de B).
- **NF-02 (P0)** Jetons hachés en base, comparaison en temps constant, usage unique (I-20).
- **NF-03 (P0)** Limitation de débit : demande de lien (5 / 15 min par e-mail et par IP), création de demandes (R-11.9), messages (R-64).
- **NF-04 (P0)** Protection CSRF sur les routes en écriture (en-tête personnalisé ou jeton double soumission) puisque l'authentification est par cookie.
- **NF-05 (P0)** Contenus saisis (présentation, messages) échappés à l'affichage ; aucun HTML accepté.
- **NF-06 (P0)** Secrets uniquement en variables d'environnement ; `.env.example` à jour ; aucun secret dans le dépôt ni dans les journaux.
- **NF-07 (P0)** En-têtes de sécurité sur `/espace` : CSP sans script tiers, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`.

## RGPD

- **NF-10 (P0)** Base légale : exécution du service pour l'inscription, consentement pour l'annuaire et les rendez-vous (R-40). Texte de la page Confidentialité de l'espace fourni par Xylofutur ; l'équipe prépare un brouillon.
- **NF-11 (P0)** Minimisation : aucune donnée de paiement importée, pas d'adresse postale, pas de téléphone.
- **NF-12 (P0)** Droit d'accès et d'effacement (F-33, R-44) ; export individuel en JSON (P1).
- **NF-13 (P0)** Journal des envois et des synchronisations conservé 12 mois.

## Performance et sobriété numérique

- **NF-20 (P0)** Poids transféré d'un écran participant au premier chargement ≤ 500 Ko hors photos ; JavaScript d'îlots ≤ 80 Ko compressé par écran.
- **NF-21 (P0)** Réponse API p95 ≤ 300 ms pour 200 participants et 600 rendez-vous.
- **NF-22 (P0)** Photos servies en WebP 256 px, chargement différé.
- **NF-23 (P0)** Aucun outil d'analytics ni police externe supplémentaire ; interrogation de la messagerie suspendue quand l'onglet est masqué.
- **NF-24 (P1)** Service worker : mise en cache de l'enveloppe applicative et du programme pour une consultation hors ligne du programme et de l'agenda déjà chargé ; jamais de cache des réponses d'API privées hors de l'agenda.

## Accessibilité

- **NF-30 (P0)** Conformité visée RGAA niveau AA sur les écrans E0 à E8 : contrastes ≥ 4,5:1, navigation clavier complète, focus visible, libellés de champs, `aria-live` pour les confirmations et erreurs, titres hiérarchisés, langue `fr`.
- **NF-31 (P0)** Fonctionne sans JavaScript pour E0 et E8 (rendu serveur).

## Compatibilité

- **NF-40 (P0)** Safari iOS 16.4+, Chrome Android 110+, navigateurs de bureau récents. Testé à 360, 390 et 1280 px.

## Exploitation

- **NF-50 (P0)** Journalisation structurée des erreurs serveur avec identifiant de requête ; page d'erreur générique côté utilisateur.
- **NF-51 (P0)** Sauvegarde de la base avant la mise en production du 20 novembre et quotidienne jusqu'au 4 décembre (procédure à confirmer avec l'hébergeur actuel).
- **NF-52 (P0)** Mode « gel » : un interrupteur par édition (`participantSpaceEnabled`) coupe l'espace sans toucher au site public.
- **NF-53 (P0)** Bascule bac à sable / production HelloAsso et fournisseur d'e-mail console / réel par variables d'environnement.
