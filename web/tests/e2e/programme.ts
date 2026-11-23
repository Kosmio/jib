import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Changer le programme de l'édition de recette depuis un test du navigateur (F-94, R-02).
 *
 * Aucune route du navigateur ne modifie une pause B2B (l'admin de Strapi n'est pas construit dans les tests e2e). Chaque appel lance
 * `strapi/tests/e2e-edit.js` dans un sous-processus : Strapi chargé sans serveur HTTP sur la base e2e de l'exécution, opérations du
 * Document Service, arrêt. Le Strapi du serveur e2e relit la base à chaque requête et voit le changement aussitôt. Compter environ 10 s
 * par appel : regrouper les opérations d'un test dans un seul appel.
 */

const { STRAPI_DIR, buildTestEnv, e2eDatabaseName } = createRequire(import.meta.url)('../../../strapi/tests/helpers/env.js');

/** Préfixe du titre de toute séquence créée par ces tests : `reset` supprime celles qui le portent. */
export const TEST_PAUSE_PREFIX = 'F-94';

export type ProgramOperation =
  | { op: 'create-sequence'; data: { title: string; start_time: string; end_time?: string | null; kind: 'talk' | 'b2b_break' | 'other'; order?: number } }
  | { op: 'update-sequence'; match: { title: string; start_time?: string }; data: { title?: string; start_time?: string; end_time?: string | null; kind?: string } }
  | { op: 'delete-sequences'; titlePrefix: string }
  | { op: 'update-edition'; data: { date: string | null } }
  | { op: 'reset' };

/** Applique les opérations dans l'ordre sur la base e2e ; lève l'erreur du sous-processus s'il échoue. */
export function editProgram(...operations: ProgramOperation[]): void {
  const env = buildTestEnv({ database: e2eDatabaseName() });
  const result = spawnSync(
    process.execPath,
    [path.join(STRAPI_DIR, 'tests/e2e-edit.js'), JSON.stringify(operations)],
    {
      cwd: STRAPI_DIR,
      env: { ...env, NODE_OPTIONS: `--require=${path.join(STRAPI_DIR, 'tests/helpers/no-network.js')}` },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Modification du programme échouée (code ${result.status}) :\n${result.stdout}\n${result.stderr}`);
  }
}
