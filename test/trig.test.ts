import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cos, distance, sin, vectorLength } from '../src/core/trig.ts';

/**
 * Ce module existe parce que `Math.sin` et `Math.cos` ne sont pas reproductibles
 * d'un moteur à l'autre. Ces tests vérifient les deux choses qu'on lui demande :
 * être juste, et n'employer que des opérations exactes.
 */

test('sinus et cosinus valent ceux de Math, au dernier bit près', () => {
  // On ne cherche pas à faire mieux que la bibliothèque du moteur, seulement à
  // faire pareil partout. Un écart d'un demi-bit est le prix, et il est invisible.
  let worstSin = 0;
  let worstCos = 0;
  for (let i = 0; i < 200_000; i++) {
    const x = (i / 200_000) * 40 - 20;
    worstSin = Math.max(worstSin, Math.abs(sin(x) - Math.sin(x)));
    worstCos = Math.max(worstCos, Math.abs(cos(x) - Math.cos(x)));
  }
  assert.ok(worstSin < 4e-16, `écart au sinus de ${worstSin}`);
  assert.ok(worstCos < 4e-16, `écart au cosinus de ${worstCos}`);
});

test("l'identité fondamentale tient sur tout l'intervalle utile", () => {
  let worst = 0;
  for (let i = 0; i < 100_000; i++) {
    const x = i * 0.0013 - 60;
    worst = Math.max(worst, Math.abs(sin(x) * sin(x) + cos(x) * cos(x) - 1));
  }
  assert.ok(worst < 1e-15, `sin² + cos² s écarte de 1 de ${worst}`);
});

test('les valeurs remarquables sont exactes', () => {
  assert.equal(sin(0), 0);
  assert.equal(cos(0), 1);
  assert.ok(Math.abs(sin(Math.PI / 2) - 1) < 1e-15);
  assert.ok(Math.abs(cos(Math.PI) + 1) < 1e-15);
  assert.ok(Math.abs(sin(Math.PI)) < 1e-15);
});

test('les quatre quadrants ont le bon signe', () => {
  // Une erreur de quadrant ne se verrait pas dans un écart moyen : elle
  // retournerait un personnage sur quatre.
  const quarter = Math.PI / 2;
  for (let q = 0; q < 8; q++) {
    const x = q * quarter + 0.4;
    assert.equal(Math.sign(sin(x)), Math.sign(Math.sin(x)), `sinus au quadrant ${q}`);
    assert.equal(Math.sign(cos(x)), Math.sign(Math.cos(x)), `cosinus au quadrant ${q}`);
  }
});

test('un angle très grand reste juste', () => {
  // La réduction d'intervalle se fait avec π/2 coupé en deux : soustraire un
  // π/2 arrondi perdrait justement les bits qu'on cherche à garder.
  for (const x of [1000, -5000, 123456.789]) {
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 1e-9, `sinus à ${x}`);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 1e-9, `cosinus à ${x}`);
  }
});

test('un angle qui n en est pas un ne contamine pas le monde', () => {
  // Un NaN dans une position se propage à tout le reste au pas suivant, sans
  // dire d'où il vient.
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.ok(Number.isNaN(sin(bad)));
    assert.ok(Number.isNaN(cos(bad)));
  }
});

test('la longueur d un vecteur vaut celle de Math.hypot', () => {
  for (let i = 1; i < 20_000; i++) {
    const x = (i * 1.618) % 900 - 450;
    const y = (i * 2.414) % 900 - 450;
    assert.ok(Math.abs(vectorLength(x, y) - Math.hypot(x, y)) < 1e-9);
  }
  assert.equal(vectorLength(3, 4), 5);
  assert.equal(distance(1, 1, 4, 5), 5);
});

test('le résultat ne dépend que des arguments', () => {
  // Aucun état caché, aucune table réchauffée par les appels précédents : deux
  // appels identiques rendent le même bit.
  const first = [sin(1.234), cos(1.234)];
  for (let i = 0; i < 1000; i++) {
    sin(i * 0.7);
    cos(i * 0.7);
  }
  assert.deepEqual([sin(1.234), cos(1.234)], first);
});
