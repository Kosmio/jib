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
