'use strict';

/**
 * Tests d'abord (phase 1, lot 3). Un test écrit avant le code qui le satisfait porte `pending('lot N')` dans ses
 * options : le test s'exécute et s'affiche, mais son échec ne fait pas échouer la suite (option `todo` de node:test).
 *
 *   it('…', pending('lot 2'), () => { … })
 *   describe('…', pending('lot 5'), () => { … })    // tous les tests de la suite héritent du marqueur
 *
 * À chaque lot livré, le tester retire le marqueur du groupe correspondant (grep « pending('lot N ») et rapporte
 * les échecs. Pour voir les vraies erreurs de tous les groupes en attente, comme avec un code en place :
 *
 *   TESTS_FIRST_STRICT=1 corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit
 *
 * Cette variable n'est lue que par ce fichier ; elle sert au tester pour vérifier qu'un test échoue pour la bonne raison.
 */

const STRICT = process.env.TESTS_FIRST_STRICT === '1';

/** Options de test : marqueur `todo` portant le lot d'activation, ou rien en mode strict. */
const pending = (lot, options = {}) => (STRICT ? options : { ...options, todo: `tests d’abord, ${lot}` });

module.exports = { pending };
