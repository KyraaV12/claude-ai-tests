import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, runCheck } from '../src/bench/checks.ts';
import { runScenario, expand, SCENARIO_018 } from '../src/bench/scenario.ts';
import { Simulation } from '../src/core/simulation.ts';

/**
 * Le harnais Node du banc.
 *
 * Il ne définit aucune vérification : elles vivent dans `src/bench/checks.ts`
 * et la page Test Runner exécute exactement les mêmes. Ce fichier ne fait que
 * les brancher sur `node:test`, pour que la CI rende un rouge là où le
 * navigateur rendrait une case rouge.
 */

for (const check of CHECKS) {
  test(`banc — ${check.label}`, () => {
    const result = runCheck(check);
    const measures = (result.metrics ?? []).map(([k, v]) => `\n    ${k} : ${v}`).join('');
    assert.ok(result.passed, `${result.detail}${measures}`);
  });
}

test('le banc couvre bien la liste des vérifications attendues', () => {
  // Une vérification qu'on retire par inadvertance ne se voit pas : la suite
  // passe au vert avec un trou dedans. On nomme donc ce qui doit exister.
  const required = [
    'determinisme',
    'sauvegarde',
    'rejeu',
    'deux-joueurs',
    'huit-joueurs',
    'prediction',
    'reconciliation',
    'perte-de-paquets',
    'latence-elevee',
    'replication',
    'construction',
    'recolte',
    'deconnexion',
    'reconnexion',
    'scenario-018',
  ];
  const present = new Set(CHECKS.map((c) => c.id));
  const missing = required.filter((id) => !present.has(id));
  assert.deepEqual(missing, [], `vérifications manquantes : ${missing.join(', ')}`);
});

test('deux identifiants de vérification ne se confondent pas', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("l'empreinte attendue du scénario de référence est bien figée", () => {
  assert.ok(SCENARIO_018.expectedHash, 'sans empreinte figée, le scénario ne garde rien');
  assert.equal(runScenario(SCENARIO_018).matchesExpected, true);
});

test('le garde-fou détecte réellement une régression', () => {
  // Contrôle négatif du contrôle : une empreinte figée qui accepterait tout ne
  // protégerait de rien. On change le monde d'un cheveu — une seule graine — et
  // le verdict doit basculer.
  const altered = { ...SCENARIO_018, seed: SCENARIO_018.seed + 1 };
  const result = runScenario(altered);
  assert.equal(result.matchesExpected, false, "un monde différent a passé l'empreinte");
  assert.equal(result.deterministic, true, 'le monde altéré doit rester déterministe');
});

test('un scénario se déplie en une demande par joueur et par pas', () => {
  const frames = expand(SCENARIO_018);
  assert.equal(frames.length, SCENARIO_018.steps);
  for (const frame of frames) assert.equal(frame.length, SCENARIO_018.players.length);

  // Une action tenue vaut pour toute sa durée, et pas seulement à son premier pas.
  const held = frames[130]!.find((input) => input.player === 2)!;
  assert.equal(held.harvest, true, 'la récolte du pas 120 devait tenir jusqu au pas 180');
  const after = frames[200]!.find((input) => input.player === 2)!;
  assert.equal(after.harvest, false, 'elle ne devait pas déborder');
});

test('une direction de scénario est normalisée', () => {
  // Sans normalisation, une diagonale ferait courir plus vite qu une ligne
  // droite — et le scénario dirait autre chose que ce qu il montre.
  const frames = expand({
    id: 'diagonale',
    seed: 1,
    players: [1],
    steps: 1,
    actions: [{ atStep: 1, player: 1, kind: 'move', dx: 3, dy: 4 }],
  });
  const input = frames[0]![0]!;
  assert.ok(Math.abs(Math.hypot(input.x, input.y) - 1) < 1e-12);
});

test("l'empreinte d'état ne dépend pas de l'objet, seulement de son contenu", () => {
  // Deux simulations distinctes, même histoire : même empreinte. Sans quoi
  // l'empreinte parlerait de la mémoire et non du monde.
  const a = new Simulation(SCENARIO_018.seed, SCENARIO_018.players);
  const b = new Simulation(SCENARIO_018.seed, SCENARIO_018.players);
  const frames = expand(SCENARIO_018).slice(0, 120);
  for (const frame of frames) {
    a.step(frame);
    b.step(frame);
  }
  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
});
