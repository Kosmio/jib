# Phase 1 : décisions du designer (E0, vérification, E2, E1 provisoire, e-mails)

Réponses du designer aux questions de la section 6 de `phase-1-plan.md`, rendues le 29 octobre 2026 et transcrites telles quelles. Elles font foi pour le lot 6. Contrastes WCAG calculés sur les valeurs de `07-design.md`. Dans le code : apostrophe ’, espace insécable (U+00A0) avant `: ; ! ?` et entre un nombre et son unité, aucun tiret cadratin.

Q-13, Q-14 et la mention neutre sur les données d'E0 sont validées par Mathieu le 29 octobre (voir `11-questions-ouvertes.md`) ; la mention reste à faire confirmer par Xylofutur avant la recette.

## 0. Socle (`espace.css`, `EspaceLayout`)

- `web/src/styles/espace.css` commence par `@import "./app.css";` et `EspaceLayout` n'importe que lui (une seule racine Tailwind, sinon les `@theme` ajoutés ne servent pas aux utilitaires ; les pages publiques ne changent pas). À vérifier au build.
- Ajouts : `@theme { --color-ink:#2a3a44; --color-gold-ink:#3a2410; --color-primary-ink:#007a5e; --color-danger:#9b1c1c; }`, les `@font-face`, et `@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}`. `danger` n'est pas dans 07 : l'architecte l'y ajoute (8,2:1 sur blanc, erreurs seulement, toujours avec icône et texte).
- Piège : `app.css` met tous les h1 et h2 en Azonix capitales. Le h1 du bandeau en profite ; les h2 de carte prennent `font-heading text-xl font-semibold normal-case`.
- Focus global (NF-30), sans `outline-none` (que ContactForm utilise, à ne pas copier) : `:where(a,button,input,textarea,select,summary):focus-visible{outline:2px solid var(--color-title);outline-offset:2px}`. 8,5:1 sur blanc, 7,5:1 sur `surface`, visible en contraste forcé.

## Q1. E0 et E2

**E0** = bandeau + carte, rien d'autre.

- Bandeau pleine largeur, `pb-16`, fond `themeColor` (repli `bg-title` si l'hex ne passe pas `^#[0-9a-fA-F]{6}$`, ou si le blanc dessus tombe sous 4,5:1, soit luminance > 0,18 : Strapi accepte toute couleur). Logos : Xylofutur `h-8` dans `rounded-lg bg-white px-2 py-1.5`, `logo-jib-blanc.svg` `h-9`, avec `alt` « Xylofutur » et « La Journée de l’Innovation de la Filière Bois ». Halo `radial-gradient` avec `color-mix(in srgb, var(--color-gold) 15%, transparent)`, constellation SVG en ligne `aria-hidden`. Si la CSP restreint `style-src`, elle doit admettre l'attribut `style` du bandeau.
- Carte : `-mt-10 rounded-xl border border-surface-alt bg-white p-6`, dans `mx-auto max-w-180 px-4`.
- Textes : h1 `Bienvenue dans votre espace participant` ; sous-titre `Préparez vos rencontres de la journée du jeudi 3 décembre à Bordeaux.` (date et ville de l'édition par `Intl` fr-FR Europe/Paris ; édition inconnue : `Préparez vos rencontres de la journée.`) ; h2 `Recevoir mon lien de connexion` ; label `Adresse e-mail utilisée pour l’inscription` ; bouton `Recevoir mon lien` ; mention `text-sm text-muted` `Pas de mot de passe : un lien valable 30 minutes vous est envoyé par e-mail. Vos données servent uniquement à l’organisation de la journée.` + lien `Confidentialité` vers `/confidentialite` (`text-title underline`).
- Champ : `type="email" required autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false"`, sans placeholder, `min-h-12 w-full rounded-lg border-2 border-accent bg-white px-4 text-lg text-ink`. `accent` sur blanc donne 3,2:1, suffisant pour un contour de champ (RGAA 3.3) ; sur fond `surface` ce serait 2,8:1, donc `border-muted`.

**E2** : bandeau (h1 `Bienvenue, {prénom}`, sous-titre `Vérifiez vos informations, puis choisissez ce que les autres participants voient de vous.`), puis une carte avec un seul `<form noValidate>`, dans cet ordre :

1. h2 `Vos informations`, aide muted `Importées depuis votre inscription, modifiables.` Champs `Prénom`, `Nom`, `Fonction (facultatif)`, `Entreprise` (1 colonne, 2 dès `md`). `autocomplete` : `given-name`, `family-name`, `organization-title`, `organization`. `required` sur prénom, nom, entreprise.
2. `<fieldset class="rounded-xl bg-surface p-4">`, `<legend>` `Vos choix de visibilité` (`font-heading font-semibold text-title`), intro `Ces choix sont facultatifs et modifiables à tout moment depuis votre profil.` Trois cases décochées : `<input class="size-5 accent-primary-ink">` dans un `<label class="flex min-h-11 gap-3">` cliquable en entier, libellé `font-semibold`, aide `text-sm text-muted` :
   - `Apparaître dans l’annuaire des participants` / `Nom, fonction, entreprise, photo et sujets. Jamais votre adresse e-mail.`
   - `Recevoir des demandes de rendez-vous et des messages` / `Les autres participants peuvent vous proposer un rendez-vous ou vous écrire en premier.`
   - `Recevoir des nouvelles des prochaines éditions` / `Vous pouvez vous désinscrire à tout moment.`
3. Note F-11 sous les cases : conteneur `role="status"` toujours présent, vide ; affichée, `rounded-lg bg-white p-3 text-sm` avec icône info et le texte exact de F-11.
4. Bouton `Continuer` (primary, pleine largeur) ; en cours : désactivé, `aria-busy`, libellé `Enregistrement…`. Dessous, lien `Confidentialité`.
5. Erreurs : sous chaque champ `<p id="{champ}-erreur" class="text-sm font-semibold text-danger">` avec icône, `aria-invalid`, `aria-describedby`, bordure `border-danger`. Texte = `error.fields[champ]` de l'API, repli `Indiquez votre prénom.` / `Indiquez votre nom.` / `Indiquez votre entreprise.` / `100 caractères au plus.` Au-dessus du bouton, `role="alert"` `Corrigez les champs signalés pour continuer.` et focus sur le premier champ en erreur. Échec réseau ou 500 : même boîte, `L’enregistrement a échoué. Vérifiez votre connexion et réessayez.` 401 : redirection vers E0.
6. Îlot en `client:load`, plus `<noscript>` `Cette étape demande JavaScript. Activez-le ou utilisez un autre navigateur.` (NF-31 ne couvre que E0 et E8).

## Q2. États et textes

- E0 `?envoye=1` : même carte, formulaire remplacé (pas de double envoi). h2 `Vérifiez votre messagerie` ; `<p role="status" class="font-semibold">` `Si cette adresse est inscrite, un lien vient de vous être envoyé.` ; muted `Le lien est valable 30 minutes et ne fonctionne qu’une seule fois. Rien reçu ? Regardez dans vos courriers indésirables, puis demandez un nouveau lien.` ; bouton secondary `Demander un nouveau lien` (lien vers `/connexion` sans paramètre). Adresse inconnue : cet état, jamais un autre texte.
- `?erreur=trop` : formulaire conservé, boîte `role="alert"` `border-2 border-danger` + icône au-dessus du champ : `Trop de demandes, réessayez dans quelques minutes.`
- `?erreur=email` : sous le champ (`aria-invalid`) `Saisissez une adresse e-mail valide, par exemple prenom.nom@entreprise.fr.`
- `?deconnecte=1` : `role="status"` sur `bg-surface` + icône coche, au-dessus du champ : `Déconnexion effectuée.`
- Le 303 recharge la page, donc l'annonce live y est peu fiable : chaque état a son `<title>`, format `{État} | Espace participant, Journées de l’Innovation Filière Bois` (`Connexion`, `Lien envoyé`, `Trop de demandes`, `Adresse non valide`, `Lien non valable`, `Ouvrir mon espace`, `Vos informations`, `Accueil`).
- Vérification, lien valable : mêmes bandeau et carte. h2 `Votre lien est valable` ; `Appuyez sur le bouton pour entrer dans votre espace participant.` ; bouton primary `Ouvrir mon espace` (formulaire POST, champs cachés `token` et `next`) ; muted `Ce lien ne fonctionne qu’une seule fois.`
- Lien invalide ou expiré : h2 `Ce lien n’est plus valable` ; `Il a expiré ou a déjà été utilisé. Recevez un nouveau lien à l’adresse de votre inscription.` ; même `RequestLinkForm.astro` qu'E0, champ prérempli (valeur seulement), bouton `Recevoir un nouveau lien`. Sans édition déductible de `next` : pas de formulaire, lien `Retour au site des Journées` vers `/`, bandeau en `bg-title`.
- Sous-titre neutre : celui d'E0 ci-dessus. La première phrase de la maquette disparaît, la seconde convient à tout visiteur.

## Q3. Contraste et focus

- `#007a5e` : token `primary-ink`, 5,3:1 sur blanc et 4,7:1 sur `surface`. Il sert à la case cochée (`accent-primary-ink`, que la maquette 01 emploie déjà), aux liens d'action, à « Confirmé » et à l'onglet actif.
- `#00b388` : 2,7:1 sur blanc, jamais en texte ni en contour fonctionnel.
- Texte du bouton or : `gold-ink` (7,3:1). Le `text-wood-dark` du Hero ne passe pas (environ 4,3:1).
- Focus : règle globale du socle.

## Q4. Polices (hypothèse Q-14)

- Deux fontes variables, sous-ensemble latin : Sora `sora-latin-wght-normal.woff2` 33,7 Ko (`font-weight: 100 800`) et Source Sans 3 `source-sans-3-latin-wght-normal.woff2` 28,9 Ko (`200 900`). 62,5 Ko en 2 requêtes, contre 62 Ko en 4 requêtes pour quatre statiques.
- Graisses : Sora 500 (heures, chiffres) et 600 (titres de carte) ; Source Sans 3 400 (corps), 600 (libellés, statuts), 700 (noms, boutons). Pas d'italique.
- Source : `@fontsource-variable/sora@5.3.0` et `@fontsource-variable/source-sans-3@5.3.1`, dossier `files/`. Copier le `LICENSE` (OFL) de chaque paquet et une note de provenance dans `web/public/fonts/`.
- `@font-face` sous les noms `"Sora"` et `"Source Sans 3"`, déjà ceux de `--font-heading` et `--font-sans`, avec `font-display: swap` et `<link rel="preload" as="font" type="font/woff2" crossorigin>` pour Source Sans 3 seulement. Le sous-ensemble latin couvre œ, ’, « » et U+00A0.

## Q5. E-mails

**Gabarit commun** (`mail/layout.js`) :

- Tables `role="presentation"`, styles en ligne, `<html lang="fr">`, préheader masqué fourni par chaque gabarit. Fond externe `#e8dfd4` ; carte blanche 600 px, rayon 16 px.
- En-tête : `bgcolor` et `background-color` = `themeColor` (mêmes garde-fous que le bandeau web), `logo-jib-blanc.png` 180 px de large (`alt="La Journée de l’Innovation de la Filière Bois"`), titre du gabarit en blanc 24 px gras capitales (`letter-spacing`), puis `edition.title` en blanc 16 px semi-gras. Ni Azonix, ni constellation, ni dégradé.
- Corps : marges 32/40 px, 17 px/1,5, `#2a3a44`, police `'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif` sans `@font-face`. Bouton : `<a>` en bloc, fond `#f0ab00`, texte `#3a2410` 700 17 px, `padding:16px 28px`, rayon 8 px.
- Pied : filet `#e8dfd4`, `logo-xylofutur.png` 90 px (`alt="Xylofutur"`), texte `#54585a` 14 px, liens soulignés `#007a5e`. Les valeurs sont celles des tokens de 07, recopiées une seule fois dans un objet `COLORS` de `layout.js` (pas de variables CSS en e-mail).
- Pied par défaut : `Vous recevez ce message car vous participez à l’édition {edition.title}.` + lien `Gérer mes notifications` (vers `/espace/{slug}/profil`, 404 tant que E3 n'existe pas, phase 2). Option `manage: false` pour `access-link`.
- Texte brut : mêmes paragraphes, bouton rendu `Libellé : URL`.

**`access-link`** : objet `Votre lien de connexion à l’espace participant` ; préheader `Valable {validityMinutes} minutes, à usage unique.` ; titre `Votre lien de connexion`. Corps : `Bonjour {firstName},` / `Voici votre lien pour ouvrir votre espace participant des Journées de l’Innovation Filière Bois.` / bouton `Me connecter` (distinct du `Ouvrir mon espace` de la page de vérification : deux étapes, deux verbes) / `Ce lien est valable {validityMinutes} minutes et ne fonctionne qu’une seule fois. Ensuite, demandez-en un nouveau depuis la page de connexion.` / `Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : personne ne peut se connecter sans ce lien.` / `Le bouton ne s’ouvre pas ? Copiez cette adresse dans votre navigateur :` + URL. Pied : `Vous recevez ce message car un lien de connexion a été demandé avec cette adresse pour l’édition {edition.title}.`

**`welcome`** : objet `{firstName}, votre espace participant est prêt` (sans prénom : `Votre espace participant est prêt`) ; préheader `Profil, annuaire, rendez-vous B2B et messages, en un seul lien.` ; titre `Bienvenue dans votre espace`. Corps : `Bonjour {firstName},` / `Votre inscription aux Journées de l’Innovation Filière Bois est enregistrée. Votre espace participant vous aide à préparer la journée :` / puces `complétez votre profil et choisissez ce que les autres participants voient ;` `parcourez l’annuaire et proposez des rendez-vous pendant les pauses B2B ;` `écrivez aux autres participants.` / bouton `Accéder à mon espace` / `Ce lien personnel est valable {validityHours} heures et ne fonctionne qu’une seule fois. Pas de mot de passe à retenir : ensuite, demandez un nouveau lien depuis la page de connexion, avec l’adresse de votre inscription.` / repli URL comme ci-dessus.

**`meeting-cancelled`** : objet `Rendez-vous annulé : {slotLabel}` (`slotLabel` déjà formaté, ex. `jeudi 3 décembre à 10h45`) ; préheader `Le créneau est de nouveau libre.` ; titre `Rendez-vous annulé`. Corps : `Bonjour {firstName},` / `Votre rendez-vous avec {counterpartName} prévu le {slotLabel} est annulé.` / si `reason` : `Motif : {reason}` / `Le créneau est de nouveau libre. Vous pouvez proposer un autre rendez-vous depuis l’annuaire ou consulter votre agenda.` / bouton `Voir mon agenda` (`agendaUrl`). Pour R-18, ne pas passer `reason` : « Inscription annulée » se lirait comme celle du destinataire.

## Q6. Gabarit des écrans

- Bouton propre : `components/espace/EspaceButton.astro` (props `variant` primary|secondary|quiet, `type`, `href?` qui rend un `<a>`). primary : `inline-flex min-h-13 w-full items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:opacity-60 disabled:cursor-not-allowed`. secondary : `border-2 border-title bg-white text-title hover:bg-surface`. quiet : `min-h-11 text-title underline`. `Button.astro` (lien vert, blanc sur `#00b388` = 2,7:1) ne sert pas.
- Pas d'onglets ni de barre latérale sur E0, vérification, E2 et E1 provisoire : l'AppShell arrive en phase 2. `EspaceLayout` seul : skip link `Aller au contenu`, `lang="fr"`, noindex, `<main id="main-content">`, `bg-surface text-ink font-sans antialiased`.
- Colonne de 720 px : `max-w-180` (45 rem) centré dès 720 px, bandeau pleine largeur à l'extérieur. Rien ne change à 1024 px tant qu'il n'y a pas de barre latérale.

## Q7. E1 provisoire

Suffisant jusqu'à la phase 2 : bandeau (h1 `Bonjour {prénom}`, sous-titre date et ville), carte (h2 `Connexion réussie`, `L’annuaire, les rendez-vous et la messagerie arrivent bientôt.`), bouton secondary `Me déconnecter` (formulaire POST, champ caché `editionSlug`). Pas de J-n, d'avatar ni d'onglets : leurs cibles n'existent pas. La phase 2 ajoute le J-n (F-20) au même `EditionBanner`.

## Écarts entre maquettes, spec et code

- 01 : cases cochées sur E0 (contraire à R-40 et F-10) et encart d'installation PWA (F-05 est en phase 3) : retirés. Le consentement se fait en E2, décoché.
- 01 : « Votre inscription HelloAsso est confirmée » est faux pour un inconnu : remplacé.
- 01, 02, 05, 08 : apostrophes droites, « informé·e », « inscrit·e ». Non repris : convention ’, et le point médian est mal lu par les lecteurs d'écran.
- 07 : le « texte `#2a3a44` » n'existe pas dans `app.css` (`--color-text` vaut `#2E3133`) : token `ink` ajouté, `--color-text` laissé tel quel. 07 dit aussi les polices « déjà chargées par le site », ce qui est faux pour Sora et Source Sans 3 (Google Fonts) : Q-14 s'applique.
- 07 : barre de progression `#00b388` sur la piste `surface-alt` = 2,0:1, sous le 3:1 de RGAA 3.3. En phase 2, remplissage `primary-ink` (4,0:1), pourcentage en texte conservé. 07 n'a pas de couleur d'erreur : `danger` proposé.
- Mention « Vos données restent hébergées par Xylofutur » (maquette 01) : aucune spec ne l'établit, et les serveurs de dev et de prod sont déployés par Kosmio (Q-01). Repli retenu dans E0 : `Vos données servent uniquement à l’organisation de la journée.` À faire confirmer par Mathieu ou Xylofutur avant la recette.
- `/confidentialite` est la page publique du site (Matomo et Google Fonts y chargent) ; la politique propre à l'espace attend Q-10.
