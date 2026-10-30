'use strict';

/**
 * Tests d'abord (phase 1, lot 3 ; phases 2 et 3, lot 13). Un test écrit avant le code qui le satisfait porte `pending('lot N')`
 * dans ses options : le test s'exécute et s'affiche, mais son échec ne fait pas échouer la suite (option `todo` de node:test).
 *
 *   it('…', pending('lot 2'), () => { … })
 *   describe('…', pending('lot 5'), () => { … })    // tous les tests de la suite héritent du marqueur
 *
 * À chaque lot livré, le tester retire le marqueur du groupe correspondant (grep « pending('lot N') ») et rapporte
 * les échecs. Pour voir les vraies erreurs des groupes en attente, comme avec un code en place :
 *
 *   TESTS_FIRST_STRICT=1 corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit      tous les groupes en attente
 *   TESTS_FIRST_STRICT=8 corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit      les seuls groupes `pending('lot 8')`
 *   TESTS_FIRST_STRICT=8,9 …                                                        les groupes des lots 8 et 9
 *
 * `1` rend tout strict (aucun groupe de la phase 1 ne subsiste, le numéro n'est donc plus ambigu). Cette variable n'est lue que
 * par ce fichier ; elle sert au tester et aux developers à vérifier qu'un test échoue pour la bonne raison.
 */

const strictLots = () =>
  String(process.env.TESTS_FIRST_STRICT ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

/** « lot 8 » -> « 8 » */
const lotNumber = (lot) => String(lot).replace(/^lot\s*/i, '').trim();

/** Options de test : marqueur `todo` portant le lot d'activation, ou rien en mode strict (tout, ou ce lot). */
const pending = (lot, options = {}) => {
  const strict = strictLots();
  return strict.includes('1') || strict.includes(lotNumber(lot)) ? options : { ...options, todo: `tests d’abord, ${lot}` };
};

module.exports = { pending };
