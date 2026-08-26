import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS_PER_DAY,
  clockLabel,
  daylight,
  horizonGlow,
  isNight,
  phaseAt,
  skyTint,
  sunHeight,
  timeOfDay,
} from '../src/world/daynight.ts';

/** Les composantes d'une couleur `rgb(r g b)`, pour comparer deux teintes. */
function channels(color: string): [number, number, number] {
  const found = (color.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
  return [found[0] ?? 0, found[1] ?? 0, found[2] ?? 0];
}

test("l heure ne dépend que du compteur de pas", () => {
  // C'est l'invariant qui tient tout le reste : si une seule de ces fonctions
  // lisait l'horloge murale, un rejeu de partie nocturne se rejouerait en
  // plein jour, et deux pairs verraient deux ciels.
  for (const step of [0, 137, 3600, 90210]) {
    assert.equal(daylight(step), daylight(step));
    assert.equal(phaseAt(step), phaseAt(step));
    assert.equal(skyTint(step).alpha, skyTint(step).alpha);
  }
});

test('le cycle se referme exactement', () => {
  // Un cycle qui ne boucle pas dériverait : après cent jours, midi tomberait
  // la nuit.
  for (const step of [0, 512, 3333]) {
    assert.equal(daylight(step), daylight(step + STEPS_PER_DAY));
    assert.equal(phaseAt(step), phaseAt(step + STEPS_PER_DAY * 7));
    assert.equal(clockLabel(step), clockLabel(step + STEPS_PER_DAY));
  }
});

test('la lumière ne saute jamais d un pas à l autre', () => {
  // Une lumière qui claque se voit immédiatement à l'écran. La borne est
  // large : ce qu'on interdit, c'est la marche d'escalier, pas le mouvement.
  let worst = 0;
  for (let step = 0; step < STEPS_PER_DAY * 2; step++) {
    worst = Math.max(worst, Math.abs(daylight(step + 1) - daylight(step)));
  }
  assert.ok(worst < 0.01, `saut de lumière de ${worst}`);
});

test('le voile de lumière est continu, en opacité comme en couleur', () => {
  // Les deux voiles sont mêlés plutôt que choisis. Un `if` entre eux ferait
  // basculer la couleur d'un coup au crépuscule ; ce test l'interdit.
  let worstAlpha = 0;
  let worstChannel = 0;
  for (let step = 0; step < STEPS_PER_DAY * 2; step++) {
    const here = skyTint(step);
    const next = skyTint(step + 1);
    worstAlpha = Math.max(worstAlpha, Math.abs(next.alpha - here.alpha));
    if (here.alpha > 0.01 && next.alpha > 0.01) {
      const a = channels(here.color);
      const b = channels(next.color);
      for (let i = 0; i < 3; i++) worstChannel = Math.max(worstChannel, Math.abs(b[i]! - a[i]!));
    }
  }
  assert.ok(worstAlpha < 0.01, `saut d opacité de ${worstAlpha}`);
  assert.ok(worstChannel <= 3, `saut de couleur de ${worstChannel} sur 255`);
});

test('les quatre phases existent, et dans le bon ordre', () => {
  const order: string[] = [];
  let previous = phaseAt(0);
  for (let step = 1; step <= STEPS_PER_DAY; step++) {
    const phase = phaseAt(step);
    if (phase !== previous) {
      order.push(phase);
      previous = phase;
    }
  }
  // Un jour entier depuis le petit matin : jour, crépuscule, nuit, aube.
  assert.deepEqual(order, ['jour', 'crépuscule', 'nuit', 'aube']);
});

test("le nom de la phase ne contredit jamais la lumière", () => {
  // La barre annonçait « jour » à huit heures du soir, sur un ciel bleu nuit :
  // le nom lisait l'embrasement de l'horizon, la teinte lisait la lumière.
  for (let step = 0; step < STEPS_PER_DAY; step++) {
    const phase = phaseAt(step);
    const light = daylight(step);
    if (phase === 'jour') assert.ok(light > 0.8, `« jour » avec ${light.toFixed(2)} de lumière`);
    if (phase === 'nuit') assert.ok(light < 0.2, `« nuit » avec ${light.toFixed(2)} de lumière`);
  }
});

test('la nuit occupe une part du cycle, sans le dominer', () => {
  // Calibré en comptant les pas plutôt qu'à vue : une bande étroite donnait
  // onze heures de noir sur vingt-quatre.
  let night = 0;
  for (let step = 0; step < STEPS_PER_DAY; step++) if (isNight(step)) night++;
  const share = night / STEPS_PER_DAY;
  assert.ok(share > 0.2 && share < 0.4, `la nuit occupe ${(share * 100).toFixed(0)} % du cycle`);
});

test("à midi il ne reste aucun voile, et la nuit n est jamais opaque", () => {
  const noon = Math.round(STEPS_PER_DAY * (0.5 - 0.27));
  assert.equal(skyTint(noon).alpha, 0);
  assert.equal(daylight(noon), 1);

  let worst = 0;
  for (let step = 0; step < STEPS_PER_DAY; step++) worst = Math.max(worst, skyTint(step).alpha);
  // Une nuit où l'on ne voit plus rien n'est pas une ambiance, c'est un écran
  // éteint.
  assert.ok(worst < 0.6, `voile de nuit à ${worst}`);
});

test('le soleil et l embrasement se répondent', () => {
  // L'horizon s'embrase quand le soleil le rase, jamais au zénith ni au nadir.
  for (let step = 0; step < STEPS_PER_DAY; step += 13) {
    const glow = horizonGlow(step);
    const height = Math.abs(sunHeight(step));
    if (glow > 0.5) assert.ok(height < 0.5, `embrasement ${glow} à ${height} de hauteur`);
    if (height > 0.6) assert.equal(glow, 0);
  }
});

test("l heure affichée avance et repasse par minuit", () => {
  assert.match(clockLabel(0), /^\d{2}:\d{2}$/);
  const midnight = Math.round(STEPS_PER_DAY * (1 - 0.27)) % STEPS_PER_DAY;
  assert.equal(clockLabel(midnight), '00:00');

  // Sur une journée, l'heure ne recule qu'une fois : au passage de minuit.
  let backwards = 0;
  let previous = timeOfDay(0);
  for (let step = 1; step <= STEPS_PER_DAY; step++) {
    const now = timeOfDay(step);
    if (now < previous) backwards++;
    previous = now;
  }
  assert.equal(backwards, 1);
});

test('un compteur de pas négatif ne casse pas le cycle', () => {
  // Rien n'en produit aujourd'hui, mais une horloge qui rend NaN sur un pas
  // négatif contaminerait tout l'affichage sans dire d'où ça vient.
  for (const step of [-1, -3599, -STEPS_PER_DAY * 3 - 5]) {
    const t = timeOfDay(step);
    assert.ok(t >= 0 && t < 1, `heure ${t} au pas ${step}`);
    assert.ok(Number.isFinite(daylight(step)));
    assert.equal(daylight(step), daylight(step + STEPS_PER_DAY * 4));
  }
});
