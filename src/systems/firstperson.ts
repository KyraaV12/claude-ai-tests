import type { Entity } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import type { ChunkCache, PropKind } from '../world/chunk.ts';
import { CHUNK_SIZE, TILE_SIZE, TILES_PER_SIDE, chunkCoordOf } from '../world/chunk.ts';
import type { Biome } from '../world/terrain.ts';
import { BIOME_COLORS } from './terrain-painter.ts';
import { harvestedKeys, propKey } from './harvest.ts';
import { daylight, skyTint } from '../world/daynight.ts';
import { cos, sin, vectorLength } from '../core/trig.ts';

/**
 * La vue subjective.
 *
 * Le monde reste plat et vu de dessus dans la simulation : rien ici ne le
 * change. Une vue à la première personne n'est qu'une autre façon de projeter
 * les mêmes coordonnées — et c'est ce qui permet de l'ajouter sans toucher au
 * déterminisme, à l'empreinte du scénario, au rejeu ni au réseau.
 *
 * **La direction du regard n'est pas de l'état.** Elle vit ici, dans
 * l'affichage. Ce qui entre dans la trame d'entrée reste une direction du
 * monde, exactement comme avant : le joueur tourne la tête, et seul le
 * déplacement qui en résulte est simulé. Réserve honnête : les autres joueurs
 * ne voient donc pas où vous regardez. Tant qu'aucune action ne vise, cela ne
 * coûte rien ; le jour où l'on visera, le regard devra passer par la trame.
 */

/** Hauteur des yeux, en unités du monde. Un peu moins qu'un personnage. */
export const EYE_HEIGHT = 26;
/** Champ de vision horizontal, en radians. Soixante-quinze degrés. */
export const FOV = 1.309;
/** Au-delà, le décor se fond dans le ciel plutôt que d'apparaître d'un coup. */
export const VIEW_DISTANCE = 1150;
/** En deçà, un objet est derrière l'œil ou collé dessus : on ne le projette pas. */
const NEAR = 12;

export interface Eye {
  x: number;
  y: number;
  /** Direction du regard, en radians depuis l'axe des x. */
  yaw: number;
}

export interface Lens {
  width: number;
  height: number;
  fov: number;
}

/**
 * Distance du plan de projection, en pixels.
 *
 * C'est le nombre qui relie le monde à l'écran : tout le reste — colonne d'un
 * point, taille d'un objet, ligne du sol — s'en déduit.
 */
export function focalLength(lens: Lens): number {
  return lens.width / 2 / Math.tan(lens.fov / 2);
}

export function horizonRow(lens: Lens): number {
  return lens.height / 2;
}

/**
 * Un point du monde, ramené dans le repère de l'œil.
 *
 * `forward` est la profondeur — devant, c'est positif. `right` est l'écart
 * latéral. Le monde ayant ses y vers le bas, la droite du regard est obtenue
 * par une rotation d'un quart de tour dans ce sens-là.
 */
export function toEyeSpace(eye: Eye, x: number, y: number): { forward: number; right: number } {
  const dx = x - eye.x;
  const dy = y - eye.y;
  const c = cos(eye.yaw);
  const s = sin(eye.yaw);
  return { forward: dx * c + dy * s, right: -dx * s + dy * c };
}

/** La colonne d'écran d'un point déjà ramené dans le repère de l'œil. */
export function columnOf(lens: Lens, forward: number, right: number): number {
  return lens.width / 2 + (right / forward) * focalLength(lens);
}

/**
 * La ligne d'écran d'un point à une hauteur donnée, à une profondeur donnée.
 *
 * À hauteur nulle c'est le sol ; à hauteur d'yeux c'est l'horizon, quelle que
 * soit la distance — ce qui est la définition même de l'horizon.
 */
export function rowOf(lens: Lens, forward: number, height = 0): number {
  return horizonRow(lens) + ((EYE_HEIGHT - height) * focalLength(lens)) / forward;
}

/** La profondeur du sol sous une ligne d'écran. Réciproque exacte de `rowOf`. */
export function groundDepth(lens: Lens, row: number): number {
  const below = row - horizonRow(lens);
  if (below <= 0) return Number.POSITIVE_INFINITY;
  return (EYE_HEIGHT * focalLength(lens)) / below;
}

/** Le point du monde vu à travers un pixel du sol. */
export function groundPoint(eye: Eye, lens: Lens, column: number, row: number): { x: number; y: number } {
  const depth = groundDepth(lens, row);
  if (!Number.isFinite(depth)) return { x: eye.x, y: eye.y };
  const lateral = ((column - lens.width / 2) * depth) / focalLength(lens);
  const c = cos(eye.yaw);
  const s = sin(eye.yaw);
  return { x: eye.x + c * depth - s * lateral, y: eye.y + s * depth + c * lateral };
}

// ────────────────────────────────────────────────────────── ce qu'on dessine

/**
 * Une couleur, en composantes plutôt qu'en texte.
 *
 * Les couleurs traversent ici plusieurs transformations — lumière du moment,
 * fondu vers l'horizon — et les faire passer par une chaîne à chaque étape
 * obligerait à la relire. Pire : les entités portent leur couleur en `hsl(…)`
 * et le décor en `#rrggbb`. Un décodeur qui n'attendait que la seconde forme
 * rendait `NaN` sur la première, et **toutes les bêtes et tous les murs se
 * dessinaient en noir** — un défaut qu'aucun test de géométrie ne pouvait
 * voir, puisque les positions, elles, étaient justes.
 */
type Rgb = readonly [number, number, number];

interface Billboard {
  x: number;
  y: number;
  /** Largeur au sol, en unités du monde. */
  width: number;
  height: number;
  color: Rgb;
  shape: 'arbre' | 'dome' | 'bloc' | 'bête' | 'flamme';
  depth: number;
  column: number;
}

const PROP_LOOK: Record<PropKind, { height: number; color: Rgb; shape: Billboard['shape'] }> = {
  arbre: { height: 62, color: [39, 76, 49], shape: 'arbre' },
  rocher: { height: 20, color: [110, 114, 117], shape: 'dome' },
  buisson: { height: 15, color: [78, 122, 58], shape: 'dome' },
  roseau: { height: 30, color: [138, 155, 78], shape: 'arbre' },
};

/** La palette du terrain, décodée une fois pour toutes plutôt qu'à chaque bande. */
const BIOME_RGB: Record<Biome, Rgb> = Object.fromEntries(
  Object.entries(BIOME_COLORS).map(([biome, hex]) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return [biome, [(value >> 16) & 255, (value >> 8) & 255, value & 255] as Rgb];
  }),
) as Record<Biome, Rgb>;

const TRUNK: Rgb = [74, 58, 40];
const TORCH_WOOD: Rgb = [107, 74, 34];

/** Teinte, saturation et clarté vers composantes rouge, vert, bleu. */
export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Le ciel, du zénith à l'horizon — puis la couleur de l'horizon jusqu'en bas.
 *
 * La couleur suit la même lumière que le voile posé sur le monde : les deux
 * lisent `daylight`, donc le ciel ne peut pas être bleu quand le sol est noir.
 *
 * Le fond est peint **sur toute la hauteur**, et non jusqu'à l'horizon. Les
 * premières lignes sous l'horizon regardent si loin que le sol n'y est plus
 * dessiné ; ne rien y peindre les laissait transparentes, et le voile de
 * lumière posé par-dessus révélait le fond de la page — une bande blafarde en
 * travers du paysage, d'autant plus visible que l'aube était chaude. Ce qui
 * est peint là est précisément la couleur vers laquelle tout le lointain fond :
 * la jonction ne se voit pas.
 */
function paintSky(ctx: CanvasRenderingContext2D, lens: Lens, steps: number): void {
  const light = daylight(steps);
  const horizon = horizonRow(lens);
  const rim = horizonColor(steps);
  const zenith = mixToward([12, 20, 46], [92, 148, 214], light);

  ctx.fillStyle = `rgb(${rim[0]} ${rim[1]} ${rim[2]})`;
  ctx.fillRect(0, 0, lens.width, lens.height);

  const gradient = ctx.createLinearGradient(0, 0, 0, horizon);
  gradient.addColorStop(0, `rgb(${zenith[0]} ${zenith[1]} ${zenith[2]})`);
  gradient.addColorStop(1, `rgb(${rim[0]} ${rim[1]} ${rim[2]})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, lens.width, horizon + 1);
}

function mixToward(dark: Rgb, bright: Rgb, t: number): Rgb {
  return [
    Math.round(dark[0]! + (bright[0]! - dark[0]!) * t),
    Math.round(dark[1]! + (bright[1]! - dark[1]!) * t),
    Math.round(dark[2]! + (bright[2]! - dark[2]!) * t),
  ];
}

/** Le biome sous un point, lu dans le cache plutôt que recalculé. */
function biomeUnder(chunks: ChunkCache, x: number, y: number): Biome | null {
  const cx = chunkCoordOf(x);
  const cy = chunkCoordOf(y);
  const chunk = chunks.get(cx, cy);
  const tx = Math.floor((x - cx * CHUNK_SIZE) / TILE_SIZE);
  const ty = Math.floor((y - cy * CHUNK_SIZE) / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= TILES_PER_SIDE || ty >= TILES_PER_SIDE) return null;
  return chunk.biomes[ty * TILES_PER_SIDE + tx] ?? null;
}

/**
 * Le sol, peint par bandes.
 *
 * Un vrai lancer de rayon par pixel coûterait des centaines de milliers
 * d'échantillons par image. On échantillonne une grille grossière et l'on
 * remplit des rectangles : à cette résolution de terrain — une tuile fait dix
 * unités — la différence ne se voit pas, et le coût tient dans une image.
 *
 * Les bandes sont plus serrées près de l'horizon, où un pixel couvre beaucoup
 * plus de monde : à pas constant, le lointain se lisait en marches d'escalier.
 */
function paintGround(ctx: CanvasRenderingContext2D, scene: FirstPersonScene): void {
  const { lens, eye, chunks, steps } = scene;
  const horizon = horizonRow(lens);
  const light = sceneLight(steps);
  const rim = horizonColor(steps);
  const columnStep = 7;

  let row = Math.ceil(horizon) + 1;
  while (row < lens.height) {
    const depth = groundDepth(lens, row);
    // Plus on regarde loin, plus une bande fine couvre de terrain : on épaissit
    // en s'approchant, là où une bande fine ne montrerait rien de plus.
    const step = depth > 600 ? 1 : depth > 260 ? 2 : depth > 120 ? 4 : 8;
    const nextRow = Math.min(row + step, lens.height);

    if (depth <= VIEW_DISTANCE) {
      const fog = fogOf(depth);
      for (let column = 0; column < lens.width; column += columnStep) {
        const point = groundPoint(eye, lens, column + columnStep / 2, row + step / 2);
        const biome = biomeUnder(chunks, point.x, point.y);
        if (!biome) continue;
        ctx.fillStyle = fade(BIOME_RGB[biome], light, fog, rim);
        ctx.fillRect(column, row, columnStep + 1, nextRow - row + 1);
      }
    }
    row = nextRow;
  }
}

/** Ce que la distance retire de netteté : 0 tout près, 1 au bout du regard. */
function fogOf(depth: number): number {
  const t = Math.min(1, Math.max(0, depth / VIEW_DISTANCE));
  return t * t;
}

/**
 * La couleur d'une chose vue de loin, sous une lumière donnée.
 *
 * Le lointain ne s'assombrit pas vers un gris : il **fond dans la couleur du
 * ciel à l'horizon**. C'est ce qui manquait — un plancher de luminosité fixe
 * donnait un sol lointain plus clair que la nuit elle-même, et l'on voyait une
 * bande blafarde percer entre les troncs. En plein jour, le même défaut
 * traçait une ligne d'horizon nette comme un trait de règle.
 *
 * Fondre vers le ciel, c'est aussi ce qui fait qu'un arbre au bout du regard
 * s'efface au lieu de disparaître d'un coup.
 */
function fade(color: Rgb, brightness: number, fog: number, rim: Rgb): string {
  const [r0, g0, b0] = color;
  const k = Math.min(1.35, Math.max(0.06, brightness));
  const t = Math.min(1, Math.max(0, fog));
  const blend = (channel: number, sky: number): number =>
    Math.round(Math.min(255, channel * k) * (1 - t) + sky * t);
  return `rgb(${blend(r0, rim[0]!)} ${blend(g0, rim[1]!)} ${blend(b0, rim[2]!)})`;
}

/**
 * La lumière sous laquelle le décor est peint.
 *
 * Jamais tout à fait nulle : une nuit sans lune est un écran éteint, pas une
 * ambiance. Ce fond de clarté suffit à distinguer un tronc d'un rocher sans
 * jamais rendre les torches inutiles — c'est le contraste qu'elles apportent
 * qui compte, pas le fait de voir ou non.
 */
export function sceneLight(steps: number): number {
  return 0.2 + 0.8 * daylight(steps);
}

/** La couleur du ciel à l'horizon : celle vers laquelle tout le lointain fond. */
export function horizonColor(steps: number): Rgb {
  // Un ciel s'éclaircit près du sol, mais pas jusqu'au blanc : une bordure trop
  // pâle traçait une bande blafarde à l'horizon, plus claire à la fois que le
  // ciel au-dessus et que le sol en dessous.
  return mixToward([24, 30, 54], [141, 177, 209], daylight(steps));
}

export interface FirstPersonScene {
  stores: Stores;
  chunks: ChunkCache;
  eye: Eye;
  lens: Lens;
  steps: number;
  /** L'entité du joueur local : on ne se dessine pas soi-même. */
  self: Entity | null;
  offsetOf?: ((entity: Entity) => { x: number; y: number } | undefined) | undefined;
}

/** Rassemble tout ce qui est devant l'œil, du plus lointain au plus proche. */
function collect(scene: FirstPersonScene): Billboard[] {
  const { eye, lens, chunks, stores, self } = scene;
  const found: Billboard[] = [];

  const add = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: Rgb,
    shape: Billboard['shape'],
  ): void => {
    const { forward, right } = toEyeSpace(eye, x, y);
    if (forward < NEAR || forward > VIEW_DISTANCE) return;
    // Une marge d'une demi-largeur : sans elle, un arbre à demi engagé dans le
    // champ disparaîtrait d'un coup au lieu d'entrer par le bord.
    const column = columnOf(lens, forward, right);
    const onScreen = (width * focalLength(lens)) / forward;
    if (column + onScreen < 0 || column - onScreen > lens.width) return;
    found.push({ x, y, width, height, color, shape, depth: forward, column });
  };

  // Le décor, lu dans les morceaux autour de l'œil.
  const removed = harvestedKeys(stores);
  const span = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE);
  const centreX = chunkCoordOf(eye.x);
  const centreY = chunkCoordOf(eye.y);
  for (let cy = centreY - span; cy <= centreY + span; cy++) {
    for (let cx = centreX - span; cx <= centreX + span; cx++) {
      const chunk = chunks.get(cx, cy);
      for (let index = 0; index < chunk.props.length; index++) {
        if (removed.has(propKey(cx, cy, index))) continue;
        const prop = chunk.props[index]!;
        const look = PROP_LOOK[prop.kind];
        add(prop.x, prop.y, prop.radius * 2, look.height, look.color, look.shape);
      }
    }
  }

  // Puis ce qui est de l'état : constructions, bêtes, autres joueurs.
  for (const [entity, transform] of stores.transform.entries()) {
    if (entity === self) continue;
    const sprite = stores.sprite.get(entity);
    if (!sprite) continue;
    const offset = scene.offsetOf?.(entity);
    const x = transform.x + (offset?.x ?? 0);
    const y = transform.y + (offset?.y ?? 0);

    const structure = stores.structure.get(entity);
    if (structure?.kind === 'torche') {
      add(x, y, 7, 30, [255, 204, 102], 'flamme');
      continue;
    }
    if (structure) {
      add(x, y, 22, 34, hslToRgb(sprite.hue, 0.38, 0.46), 'bloc');
      continue;
    }
    const body = stores.body.get(entity);
    if (!body) continue;
    const creature = stores.creature.get(entity);
    const height = creature ? body.radius * 2.1 : body.radius * 2.6;
    add(x, y, body.radius * 2, height, hslToRgb(sprite.hue, 0.62, 0.52), 'bête');
  }

  return found.sort((a, b) => b.depth - a.depth);
}

function drawBillboard(
  ctx: CanvasRenderingContext2D,
  lens: Lens,
  item: Billboard,
  light: number,
  rim: Rgb,
): void {
  const focal = focalLength(lens);
  const base = rowOf(lens, item.depth, 0);
  const top = rowOf(lens, item.depth, item.height);
  const width = (item.width * focal) / item.depth;
  const left = item.column - width / 2;
  const tall = base - top;
  if (tall < 0.5 || width < 0.5) return;

  const fog = fogOf(item.depth);
  // Une flamme éclaire d'elle-même : elle ne suit ni la lumière du jour ni le
  // fondu du lointain, sinon une torche s'éteindrait à mesure qu'on s'éloigne.
  const flame = item.shape === 'flamme';
  const brightness = flame ? 1.25 : light;
  const haze = flame ? fog * 0.4 : fog;
  const tint = (color: Rgb, factor = 1): string => fade(color, brightness * factor, haze, rim);
  ctx.fillStyle = tint(item.color);

  switch (item.shape) {
    case 'arbre': {
      // Un tronc et une couronne : de loin, la silhouette suffit à distinguer
      // un arbre d'un rocher, et c'est tout ce qu'on lui demande.
      //
      // Le tronc a une largeur propre, en unités du monde, et non une fraction
      // de la couronne : sous un grand arbre tout proche, une fraction donnait
      // une colonne sombre large comme un mur.
      const trunk = Math.max(1, Math.min(width * 0.22, (4.5 * focal) / item.depth));
      ctx.fillStyle = tint(TRUNK);
      ctx.fillRect(item.column - trunk / 2, top + tall * 0.45, trunk, tall * 0.55);
      ctx.fillStyle = tint(item.color);
      ctx.beginPath();
      ctx.ellipse(item.column, top + tall * 0.3, width / 2, tall * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'dome': {
      ctx.beginPath();
      ctx.ellipse(item.column, base, width / 2, tall, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bloc': {
      ctx.fillRect(left, top, width, tall);
      ctx.fillStyle = tint(item.color, 0.72);
      ctx.fillRect(left, top, width, Math.max(1, tall * 0.14));
      break;
    }
    case 'flamme': {
      ctx.fillStyle = tint(TORCH_WOOD, 0.8);
      ctx.fillRect(item.column - width * 0.18, top + tall * 0.35, Math.max(1, width * 0.36), tall * 0.65);
      ctx.fillStyle = '#FFD27A';
      ctx.beginPath();
      ctx.ellipse(item.column, top + tall * 0.22, width / 2, tall * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // Une bête : un corps arrondi posé au sol, sans détail qu'on ne verrait pas.
      ctx.beginPath();
      ctx.ellipse(item.column, top + tall / 2, width / 2, tall / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/**
 * Part du voile appliquée en vue subjective.
 *
 * Ici, le décor est déjà peint à la lumière du moment : un arbre de nuit sort
 * sombre du pinceau. Poser le voile en entier par-dessus assombrissait une
 * seconde fois, et la nuit devenait un écran noir où l'on ne distinguait plus
 * le sol. En vue de dessus le problème ne se pose pas : le terrain y est peint
 * à sa couleur pleine, et le voile est la seule chose qui fasse la nuit.
 */
const VEIL_SHARE = 0.55;

/**
 * La nuit, en vue subjective.
 *
 * Même principe qu'en vue de dessus — un voile percé par les lumières — mais
 * les halos sont ici posés à la place *à l'écran* de chaque source, et leur
 * taille suit la perspective : une torche lointaine n'éclaire qu'un point.
 */
function paintNight(ctx: CanvasRenderingContext2D, scene: FirstPersonScene, veil: HTMLCanvasElement | null): void {
  const tint = skyTint(scene.steps);
  if (tint.alpha <= 0.002 || !veil) return;

  const { lens, eye, stores } = scene;
  const width = Math.max(1, Math.round(lens.width));
  const height = Math.max(1, Math.round(lens.height));
  if (veil.width !== width || veil.height !== height) {
    veil.width = width;
    veil.height = height;
  }
  const layer = veil.getContext('2d');
  if (!layer) return;

  layer.clearRect(0, 0, width, height);
  layer.globalCompositeOperation = 'source-over';
  layer.fillStyle = tint.color;
  layer.fillRect(0, 0, width, height);

  layer.globalCompositeOperation = 'destination-out';
  const focal = focalLength(lens);
  for (const [entity, light] of stores.light.entries()) {
    const transform = stores.transform.get(entity);
    if (!transform) continue;
    const { forward, right } = toEyeSpace(eye, transform.x, transform.y);
    if (forward < NEAR || forward > VIEW_DISTANCE) continue;
    const column = columnOf(lens, forward, right);
    const row = rowOf(lens, forward, EYE_HEIGHT * 0.6);
    const radius = (light.radius * focal) / forward;
    if (radius < 1) continue;

    const halo = layer.createRadialGradient(column, row, 0, column, row, radius);
    halo.addColorStop(0, 'rgba(0,0,0,0.8)');
    halo.addColorStop(0.5, 'rgba(0,0,0,0.36)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    layer.fillStyle = halo;
    layer.beginPath();
    layer.arc(column, row, radius, 0, Math.PI * 2);
    layer.fill();
  }
  layer.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalAlpha = tint.alpha * VEIL_SHARE;
  ctx.drawImage(veil, 0, 0, lens.width, lens.height);
  ctx.restore();
}

/** Tampon du voile, comme en vue de dessus : `destination-out` ronge son support. */
let veilCanvas: HTMLCanvasElement | null = null;

export function renderFirstPerson(ctx: CanvasRenderingContext2D, scene: FirstPersonScene): void {
  const { lens, steps } = scene;
  if (!veilCanvas && typeof document !== 'undefined') veilCanvas = document.createElement('canvas');

  ctx.clearRect(0, 0, lens.width, lens.height);
  paintSky(ctx, lens, steps);
  paintGround(ctx, scene);

  const light = sceneLight(steps);
  const rim = horizonColor(steps);
  for (const item of collect(scene)) drawBillboard(ctx, lens, item, light, rim);

  paintNight(ctx, scene, veilCanvas);
}

/**
 * La direction du monde correspondant à une demande vue de l'œil.
 *
 * C'est ici que le regard s'arrête : `avant` et `côté` sont ce que le joueur
 * demande depuis sa place, la sortie est une direction du monde — et c'est
 * elle, et elle seule, qui entre dans la trame d'entrée. La simulation ne sait
 * pas qu'une vue subjective existe.
 */
export function worldDirection(yaw: number, forward: number, strafe: number): { x: number; y: number } {
  const c = cos(yaw);
  const s = sin(yaw);
  const x = c * forward - s * strafe;
  const y = s * forward + c * strafe;
  const length = vectorLength(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}
