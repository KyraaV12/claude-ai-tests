import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedStep } from '../src/core/time.ts';

test('accumule les fractions de pas jusqu à en produire un', () => {
  const clock = new FixedStep(1 / 60);
  assert.equal(clock.advance(1 / 120).steps, 0);
  assert.equal(clock.advance(1 / 120).steps, 1);
});

test('produit autant de pas que le temps écoulé en contient', () => {
  const clock = new FixedStep(1 / 60);
  assert.equal(clock.advance(4 / 60).steps, 4);
});

test('alpha reste dans [0, 1)', () => {
  const clock = new FixedStep(1 / 60);
  for (const elapsed of [0, 0.003, 1 / 60, 0.05, 0.4]) {
    const tick = clock.advance(elapsed);
    assert.ok(tick.alpha >= 0 && tick.alpha < 1, `alpha hors bornes : ${tick.alpha}`);
  }
});

test('plafonne le rattrapage après une longue pause', () => {
  const clock = new FixedStep(1 / 60, 5);
  // Dix secondes d'absence : sans plafond, ce serait 600 pas d'un coup.
  assert.equal(clock.advance(10).steps, 5);
});

test('un retard plafonné ne se reporte pas sur les images suivantes', () => {
  const clock = new FixedStep(1 / 60, 5);
  clock.advance(10);
  assert.equal(clock.advance(1 / 60).steps, 1);
});

test('ignore les durées absurdes plutôt que de propager NaN', () => {
  const clock = new FixedStep(1 / 60);
  for (const bad of [NaN, -1, Number.POSITIVE_INFINITY]) {
    const tick = clock.advance(bad);
    assert.ok(Number.isFinite(tick.alpha), `alpha non fini pour ${bad}`);
  }
  assert.equal(clock.advance(1 / 60).steps, 1);
});

test('refuse un dt non positif', () => {
  assert.throws(() => new FixedStep(0), RangeError);
  assert.throws(() => new FixedStep(-1 / 60), RangeError);
});

test('le découpage des images ne change pas le nombre de pas simulés', () => {
  // Une seconde de temps réel, livrée en petites et en grosses images. Aucune
  // image ne dépasse le plafond, donc rien n'est abandonné : des deux côtés,
  // la simulation doit avoir avancé d'exactement une seconde.
  const fine = new FixedStep(1 / 60);
  const coarse = new FixedStep(1 / 60);
  let fineSteps = 0;
  let coarseSteps = 0;
  for (let i = 0; i < 240; i++) fineSteps += fine.advance(1 / 240).steps;
  for (let i = 0; i < 30; i++) coarseSteps += coarse.advance(1 / 30).steps;
  assert.equal(fineSteps, 60);
  assert.equal(coarseSteps, 60);
});
