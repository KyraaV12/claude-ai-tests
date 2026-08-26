import { CHECKS, runCheck } from './checks.ts';
import type { Check, CheckResult } from './checks.ts';
import type { RunEvent, RunRequest } from './worker.ts';

/**
 * La page Test Runner.
 *
 * Elle n'invente rien : elle affiche les vérifications de `checks.ts`, celles
 * que la CI exécute sous `node:test`. Une case verte ici et un vert en CI
 * parlent du même code — c'était la condition pour que le tableau serve à
 * quelque chose.
 */

const rows = new Map<string, Row>();
let running = false;

interface Row {
  check: Check;
  element: HTMLElement;
  verdict: HTMLElement;
  timing: HTMLElement;
  detail: HTMLElement;
  result: CheckResult | null;
}

/** Le lanceur : un fil séparé si le navigateur veut bien, la page sinon. */
interface Runner {
  start(request: RunRequest, onEvent: (event: RunEvent) => void): void;
  readonly threaded: boolean;
}

function createRunner(): Runner {
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    let listener: ((event: RunEvent) => void) | null = null;
    worker.addEventListener('message', (event: MessageEvent<RunEvent>) => listener?.(event.data));
    return {
      threaded: true,
      start(request, onEvent) {
        listener = onEvent;
        worker.postMessage(request);
      },
    };
  } catch {
    // Repli sur le fil principal. La page se fige pendant chaque vérification —
    // mieux vaut un tableau lent qu'un tableau absent — mais on rend la main
    // entre deux pour que les verdicts s'affichent au fur et à mesure.
    return {
      threaded: false,
      start(request, onEvent) {
        const wanted = request.run === 'all' ? CHECKS : CHECKS.filter((c) => c.id === request.id);
        let index = 0;
        const next = (): void => {
          if (index >= wanted.length) {
            onEvent({ type: 'done' });
            return;
          }
          const check = wanted[index++]!;
          onEvent({ type: 'started', id: check.id });
          // Un tour de boucle d'affichage avant de bloquer : sans lui, la ligne
          // « en cours » ne serait jamais peinte.
          requestAnimationFrame(() => {
            onEvent({ type: 'result', result: runCheck(check) });
            setTimeout(next, 0);
          });
        };
        next();
      },
    };
  }
}

const runner = createRunner();

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(check: Check): Row {
  const item = element('div', 'check');
  item.dataset.state = 'idle';

  const head = element('button', 'check-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');

  // La case est purement décorative : le verdict est écrit à côté, en toutes
  // lettres, et c'est lui que lit une synthèse vocale.
  const status = element('span', 'check-status');
  status.setAttribute('aria-hidden', 'true');
  const label = element('span', 'check-label', check.label);
  const verdict = element('span', 'check-verdict', 'en attente');
  const timing = element('span', 'check-timing', '—');

  head.append(status, label, verdict, timing);

  const detail = element('div', 'check-detail');
  detail.hidden = true;
  detail.append(element('p', 'check-about', check.about));

  head.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    head.setAttribute('aria-expanded', String(!detail.hidden));
  });

  item.append(head, detail);
  return { check, element: item, verdict, timing, detail, result: null };
}

function renderResult(row: Row, result: CheckResult): void {
  row.result = result;
  row.element.dataset.state = result.passed ? 'pass' : 'fail';
  row.verdict.textContent = result.passed ? 'PASS' : 'FAIL';
  row.timing.textContent = `${result.durationMs.toFixed(0)} ms`;

  row.detail.replaceChildren(element('p', 'check-about', result.about));
  row.detail.append(element('p', 'check-said', result.detail));

  if (result.metrics?.length) {
    const table = element('dl', 'check-metrics');
    for (const [name, value] of result.metrics) {
      table.append(element('dt', undefined, name), element('dd', undefined, value));
    }
    row.detail.append(table);
  }

  // Un échec s'ouvre de lui-même : c'est le seul moment où l'on veut lire.
  if (!result.passed) {
    row.detail.hidden = false;
    row.element.querySelector('.check-head')?.setAttribute('aria-expanded', 'true');
  }
}

function markRunning(row: Row): void {
  row.element.dataset.state = 'running';
  row.verdict.textContent = 'en cours…';
  row.timing.textContent = '—';
}

function reset(row: Row): void {
  row.element.dataset.state = 'idle';
  row.verdict.textContent = 'en attente';
  row.timing.textContent = '—';
  row.result = null;
  row.detail.replaceChildren(element('p', 'check-about', row.check.about));
  row.detail.hidden = true;
}

const summary = document.getElementById('summary')!;
const button = document.getElementById('run')! as HTMLButtonElement;
const board = document.getElementById('board')!;

function updateSummary(state: 'idle' | 'running' | 'done'): void {
  const finished = [...rows.values()].filter((r) => r.result);
  const passed = finished.filter((r) => r.result!.passed).length;
  const total = rows.size;
  const millis = finished.reduce((sum, r) => sum + r.result!.durationMs, 0);

  if (state === 'idle') {
    summary.dataset.tone = 'neutre';
    summary.textContent = `${total} vérifications, jamais lancées.`;
    return;
  }

  const elapsed = millis >= 1000 ? `${(millis / 1000).toFixed(1)} s` : `${millis.toFixed(0)} ms`;
  if (state === 'running') {
    summary.dataset.tone = 'neutre';
    summary.textContent = `${finished.length}/${total} — ${passed} au vert — ${elapsed}`;
    return;
  }

  const failed = finished.length - passed;
  summary.dataset.tone = failed === 0 ? 'ok' : 'alerte';
  summary.textContent =
    failed === 0
      ? `${passed}/${total} au vert en ${elapsed}.`
      : `${failed} échec${failed > 1 ? 's' : ''} sur ${finished.length} — ${elapsed}.`;
}

function run(request: RunRequest): void {
  if (running) return;
  running = true;
  button.disabled = true;
  button.textContent = 'en cours…';

  if (request.run === 'all') for (const row of rows.values()) reset(row);
  updateSummary('running');

  runner.start(request, (event) => {
    if (event.type === 'started') {
      const row = rows.get(event.id);
      if (row) markRunning(row);
      return;
    }
    if (event.type === 'result') {
      const row = rows.get(event.result.id);
      if (row) renderResult(row, event.result);
      updateSummary('running');
      return;
    }
    running = false;
    button.disabled = false;
    button.textContent = 'Tout relancer';
    updateSummary('done');
  });
}

// ── Montage ──────────────────────────────────────────────────────────────

let currentGroup = '';
for (const check of CHECKS) {
  if (check.group !== currentGroup) {
    currentGroup = check.group;
    board.append(element('h2', 'group', currentGroup));
  }
  const row = buildRow(check);
  rows.set(check.id, row);
  board.append(row.element);
}

button.addEventListener('click', () => run({ run: 'all' }));
updateSummary('idle');

const thread = document.getElementById('thread');
if (thread) {
  thread.textContent = runner.threaded
    ? 'Les vérifications tournent dans un fil séparé : la page reste vive pendant les longues.'
    : "Ce navigateur n'a pas voulu du fil séparé : la page se figera pendant chaque vérification.";
}
