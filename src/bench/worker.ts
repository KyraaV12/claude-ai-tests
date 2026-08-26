import { CHECKS, runCheck } from './checks.ts';
import type { CheckResult } from './checks.ts';

/**
 * Le lanceur, dans son propre fil.
 *
 * Une vérification comme « montée en charge » occupe le processeur une dizaine
 * de secondes d'affilée. Sur le fil principal, la page se figerait : ni bouton,
 * ni défilement, ni résultat affiché avant la fin. Ici l'interface reste vive et
 * les verdicts tombent au fur et à mesure.
 *
 * Aucune vérification n'est définie ici : ce sont celles de `checks.ts`, les
 * mêmes que fait tourner la CI.
 */

export type RunRequest = { run: 'all' } | { run: 'one'; id: string };

export type RunEvent =
  | { type: 'started'; id: string }
  | { type: 'result'; result: CheckResult }
  | { type: 'done' };

const post = (event: RunEvent): void => {
  (self as unknown as Worker).postMessage(event);
};

self.addEventListener('message', (event: MessageEvent<RunRequest>) => {
  const request = event.data;
  const wanted = request.run === 'all' ? CHECKS : CHECKS.filter((c) => c.id === request.id);

  for (const check of wanted) {
    post({ type: 'started', id: check.id });
    post({ type: 'result', result: runCheck(check) });
  }
  post({ type: 'done' });
});
