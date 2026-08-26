import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EYE_HEIGHT,
  FOV,
  columnOf,
  focalLength,
  groundDepth,
  groundPoint,
  horizonRow,
  rowOf,
  hslToRgb,
  toEyeSpace,
  worldDirection,
} from '../src/systems/firstperson.ts';
import type { Eye, Lens } from '../src/systems/firstperson.ts';

/**
 * La projection est faite de fonctions pures : elle se vérifie sans canevas,
 * sans navigateur, et sans regarder l'écran. Ce qui se voit à l'œil, ce sont
 * les couleurs ; ce qui se prouve, c'est la géométrie.
 */

const LENS: Lens = { width: 960, height: 540, fov: FOV };
const AT_ORIGIN: Eye = { x: 0, y: 0, yaw: 0 };

test('un point droit devant tombe au centre de l écran', () => {
  const { forward, right } = toEyeSpace(AT_ORIGIN, 300, 0);
  assert.ok(Math.abs(forward - 300) < 1e-9);
  assert.ok(Math.abs(right) < 1e-9);
  assert.ok(Math.abs(columnOf(LENS, forward, right) - LENS.width / 2) < 1e-9);
});

test('le repère de l œil tourne avec le regard', () => {
  // Le monde a ses y vers le bas : en regardant vers l'est, la droite du
  // joueur est au sud. Une erreur de signe ici retournerait le monde.
  const east: Eye = { x: 0, y: 0, yaw: 0 };
  const south = toEyeSpace(east, 0, 200);
  assert.ok(south.forward < 1e-9, 'le sud ne doit pas être devant');
  assert.ok(south.right > 199, 'le sud doit être à droite');

  // En pivotant d'un quart de tour, ce qui était à droite passe devant.
  const facingSouth: Eye = { x: 0, y: 0, yaw: Math.PI / 2 };
  const now = toEyeSpace(facingSouth, 0, 200);
  assert.ok(Math.abs(now.forward - 200) < 1e-6);
  assert.ok(Math.abs(now.right) < 1e-6);
});

test('la distance ne déplace pas un point du centre', () => {
  for (const depth of [20, 100, 900]) {
    const { forward, right } = toEyeSpace(AT_ORIGIN, depth, 0);
    assert.ok(Math.abs(columnOf(LENS, forward, right) - LENS.width / 2) < 1e-9);
  }
});

test('le bord du champ de vision tombe sur le bord de l écran', () => {
  // Un point placé exactement à l'angle du champ doit atterrir au bord : si
  // ce n'était pas le cas, le champ affiché ne serait pas celui annoncé.
  const depth = 400;
  const lateral = depth * Math.tan(FOV / 2);
  const { forward, right } = toEyeSpace(AT_ORIGIN, depth, lateral);
  assert.ok(Math.abs(columnOf(LENS, forward, right) - LENS.width) < 1e-6);
});

test('la ligne du sol et la profondeur sont réciproques', () => {
  // C'est l'aller-retour dont dépend tout le rendu du sol : la bande peinte à
  // une ligne doit être celle du terrain qu'on y a échantillonné.
  for (const depth of [15, 60, 250, 1000]) {
    const row = rowOf(LENS, depth, 0);
    assert.ok(Math.abs(groundDepth(LENS, row) - depth) < 1e-6, `à ${depth} unités`);
  }
});

test("à hauteur d'yeux, tout est sur l horizon", () => {
  for (const depth of [20, 300, 5000]) {
    assert.ok(Math.abs(rowOf(LENS, depth, EYE_HEIGHT) - horizonRow(LENS)) < 1e-9);
  }
});

test('ce qui est plus haut que les yeux passe au-dessus de l horizon', () => {
  const arbre = rowOf(LENS, 200, 62);
  const caillou = rowOf(LENS, 200, 8);
  assert.ok(arbre < horizonRow(LENS), 'la cime d un arbre devrait dépasser l horizon');
  assert.ok(caillou > horizonRow(LENS), 'un caillou ne devrait pas dépasser l horizon');
});

test('un objet qui s éloigne rétrécit et remonte vers l horizon', () => {
  let previousHeight = Number.POSITIVE_INFINITY;
  let previousBase = Number.POSITIVE_INFINITY;
  for (const depth of [30, 60, 120, 240, 480, 960]) {
    const base = rowOf(LENS, depth, 0);
    const height = base - rowOf(LENS, depth, 40);
    assert.ok(height < previousHeight, `la taille devrait décroître à ${depth}`);
    assert.ok(base < previousBase, `la base devrait remonter à ${depth}`);
    previousHeight = height;
    previousBase = base;
  }
});

test('au-dessus de l horizon, le sol est à l infini', () => {
  // Sans cette borne, une ligne du ciel donnerait une profondeur négative et
  // le sol se dessinerait à l'envers, en haut de l'écran.
  assert.equal(groundDepth(LENS, horizonRow(LENS)), Number.POSITIVE_INFINITY);
  assert.equal(groundDepth(LENS, 0), Number.POSITIVE_INFINITY);
});

test('le point du sol vu par un pixel se reprojette sur ce pixel', () => {
  // La boucle complète : écran → monde → écran. C'est elle qui garantit que la
  // couleur peinte à un endroit est celle du terrain qui s'y trouve.
  const eye: Eye = { x: 1420, y: -730, yaw: 0.9 };
  for (const column of [40, 300, 480, 700, 920]) {
    for (const row of [280, 340, 460, 530]) {
      const point = groundPoint(eye, LENS, column, row);
      const { forward, right } = toEyeSpace(eye, point.x, point.y);
      assert.ok(Math.abs(columnOf(LENS, forward, right) - column) < 1e-6, `colonne ${column}`);
      assert.ok(Math.abs(rowOf(LENS, forward, 0) - row) < 1e-6, `ligne ${row}`);
    }
  }
});

test('la longueur focale suit le champ de vision', () => {
  // Un champ plus large rapproche le plan de projection : les objets
  // rétrécissent. L'inverse donnerait un effet de longue-vue.
  const large = focalLength({ ...LENS, fov: 1.6 });
  const étroit = focalLength({ ...LENS, fov: 0.8 });
  assert.ok(large < étroit);
});

test('avancer va où l on regarde, se déporter va sur le côté', () => {
  // C'est le seul endroit où le regard touche au jeu : il transforme une
  // demande vue de l'œil en direction du monde. Ce qui entre dans la trame
  // d'entrée est cette direction-là, et la simulation ignore tout du reste.
  const east = worldDirection(0, 1, 0);
  assert.ok(Math.abs(east.x - 1) < 1e-9 && Math.abs(east.y) < 1e-9);

  const rightOfEast = worldDirection(0, 0, 1);
  assert.ok(Math.abs(rightOfEast.y - 1) < 1e-9, 'la droite doit être au sud');

  const backwards = worldDirection(0, -1, 0);
  assert.ok(Math.abs(backwards.x + 1) < 1e-9);
});

test('une demande en diagonale ne va pas plus vite', () => {
  for (const yaw of [0, 0.7, 2.2, -1.1]) {
    const diagonal = worldDirection(yaw, 1, 1);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9, `à ${yaw} radians`);
  }
});

test('ne rien demander ne déplace pas', () => {
  const still = worldDirection(1.3, 0, 0);
  assert.deepEqual(still, { x: 0, y: 0 });
});

test('tourner sur place ne change pas où l on va quand on avance', () => {
  // Avancer d'un quart de tour à droite doit mener exactement là où mènerait
  // un déport à droite sans tourner : deux chemins, une même géométrie.
  const turned = worldDirection(Math.PI / 2, 1, 0);
  const strafed = worldDirection(0, 0, 1);
  assert.ok(Math.abs(turned.x - strafed.x) < 1e-9);
  assert.ok(Math.abs(turned.y - strafed.y) < 1e-9);
});

test('une couleur en teinte devient des composantes justes', () => {
  // Les entités portent leur couleur en teinte, le décor en hexadécimal. Un
  // décodeur qui n'attendait que la seconde forme rendait NaN sur la première,
  // et toutes les bêtes se dessinaient en noir — sans qu'aucune assertion de
  // géométrie ne s'en aperçoive.
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255]);
  assert.deepEqual(hslToRgb(0, 0, 0.5), [128, 128, 128]);
  assert.deepEqual(hslToRgb(200, 0.62, 0.52), hslToRgb(560, 0.62, 0.52));

  // Et surtout : jamais de NaN, quelle que soit la teinte reçue.
  for (let hue = -400; hue <= 760; hue += 7) {
    for (const [s, l] of [[0.38, 0.46], [0.62, 0.52], [1, 0.5], [0, 0]] as Array<[number, number]>) {
      for (const channel of hslToRgb(hue, s, l)) {
        assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `teinte ${hue} → ${channel}`);
      }
    }
  }
});
