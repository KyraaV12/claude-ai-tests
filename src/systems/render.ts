import type { Entity } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import type { Camera, Viewport } from '../world/camera.ts';
import { visibleChunks, worldToScreen } from '../world/camera.ts';
import { CHUNK_SIZE } from '../world/chunk.ts';
import type { ChunkCache } from '../world/chunk.ts';
import type { TerrainPainter } from './terrain-painter.ts';
import { harvestedKeys, propKey } from './harvest.ts';
import { skyTint } from '../world/daynight.ts';
import type { PropKind } from '../world/chunk.ts';

const PROP_COLORS: Record<PropKind, string> = {
  arbre: '#274C31',
  rocher: '#6E7275',
  buisson: '#4E7A3A',
  roseau: '#8A9B4E',
};

export interface Palette {
  ink: string;
  accent: string;
}

export interface Scene {
  stores: Stores;
  chunks: ChunkCache;
  painter: TerrainPainter;
  camera: Camera;
  viewport: Viewport;
  palette: Palette;
  /** Avancement du rendu entre le dernier pas de simulation et le suivant. */
  alpha: number;
  /**
   * Le pas courant de la simulation.
   *
   * Sert à lire l'heure. Le rendu ne la reçoit pas et ne la stocke pas : il la
   * déduit du même compteur que tout le monde, ce qui suffit à ce que deux
   * pairs voient le même ciel sans se l'être envoyé.
   */
  steps: number;
  highlight: Entity | null;
  /**
   * Décalage d'affichage d'une entité, s'il y en a un.
   *
   * Sert à absorber les corrections du réseau sans toucher à la simulation :
   * l'état reste exact, seule l'image temporise. Absent hors réseau.
   */
  offsetOf?: (entity: Entity) => { x: number; y: number } | undefined;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function render(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { camera, viewport, chunks, stores, palette, alpha } = scene;

  ctx.clearRect(0, 0, viewport.width, viewport.height);
  drawTerrain(ctx, scene);

  // Le décor d'abord, les entités ensuite : ce qui bouge passe devant.
  // Ce qui a été récolté est retranché ici, à la lecture — le générateur, lui,
  // continue de le produire.
  const removed = harvestedKeys(stores);
  const range = visibleChunks(camera, viewport, CHUNK_SIZE);
  for (let cy = range.minY; cy <= range.maxY; cy++) {
    for (let cx = range.minX; cx <= range.maxX; cx++) {
      const props = chunks.get(cx, cy).props;
      for (let index = 0; index < props.length; index++) {
        if (removed.has(propKey(cx, cy, index))) continue;
        const prop = props[index]!;
        const point = worldToScreen(camera, viewport, prop.x, prop.y);
        ctx.beginPath();
        ctx.arc(point.x, point.y, prop.radius / camera.scale, 0, Math.PI * 2);
        ctx.fillStyle = PROP_COLORS[prop.kind];
        ctx.fill();
      }
    }
  }

  for (const [entity, transform] of stores.transform.entries()) {
    const sprite = stores.sprite.get(entity);
    if (!sprite) continue;
    const body = stores.body.get(entity);
    const structure = stores.structure.get(entity);
    // Une torche n'a pas de corps — on passe à côté sans buter — mais elle se
    // dessine quand même. Lier le dessin au corps la rendait invisible.
    if (!body && !structure) continue;

    const point = screenPointOf(scene, entity, transform);
    const radius = (body?.radius ?? 6) / camera.scale;

    ctx.beginPath();
    if (structure?.kind === 'torche') {
      ctx.arc(point.x, point.y, Math.max(radius * 0.5, 3), 0, Math.PI * 2);
      ctx.fillStyle = '#FFCC66';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#8A5A1E';
      ctx.stroke();
      continue;
    }
    if (structure) {
      // Un carré, pas un disque : bâti et vivant ne doivent pas se confondre.
      const side = radius * 2;
      ctx.rect(point.x - radius, point.y - radius, side, side);
      ctx.fillStyle = `hsl(${sprite.hue} 38% 46%)`;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `hsl(${sprite.hue} 30% 28%)`;
      ctx.stroke();
      continue;
    }
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${sprite.hue} 72% 58%)`;
    ctx.fill();

    if (stores.controlled.has(entity)) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.ink;
      ctx.stroke();
    }
  }

  // La nuit vient par-dessus le monde, mais sous les repères d'interface :
  // un anneau de sélection qu'on ne verrait plus après le coucher du soleil
  // serait un outil qui s'éteint quand on en a le plus besoin.
  drawNight(ctx, scene);

  if (scene.highlight !== null) {
    const transform = stores.transform.get(scene.highlight);
    const body = stores.body.get(scene.highlight);
    if (transform) {
      const point = screenPointOf(scene, scene.highlight, transform);
      ctx.beginPath();
      ctx.arc(point.x, point.y, (body?.radius ?? 6) / camera.scale + 7, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.accent;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Où une entité se dessine : position interpolée, plus son décalage réseau. */
function screenPointOf(
  scene: Scene,
  entity: Entity,
  transform: { x: number; y: number; previousX: number; previousY: number },
): { x: number; y: number } {
  const offset = scene.offsetOf?.(entity);
  return worldToScreen(
    scene.camera,
    scene.viewport,
    lerp(transform.previousX, transform.x, scene.alpha) + (offset?.x ?? 0),
    lerp(transform.previousY, transform.y, scene.alpha) + (offset?.y ?? 0),
  );
}

/**
 * Un canevas de brouillon pour le voile de nuit.
 *
 * Il faut le composer à part : `destination-out` efface **tout** ce qui est
 * sous lui, terrain compris. Appliqué directement sur la scène, il ne perçait
 * pas l'obscurité — il découpait des trous dans l'image, et l'on voyait le
 * fond de la page à travers. Sur son propre canevas, il ne peut ronger que
 * lui-même.
 *
 * Gardé au niveau du module, et créé au premier usage : c'est un tampon sans
 * contenu propre, redimensionné avec la fenêtre. Le passer par la scène
 * l'aurait fait voyager de fichier en fichier sans rien dire de plus.
 */
let veil: HTMLCanvasElement | null = null;

function veilContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (!veil) {
    if (typeof document === 'undefined') return null;
    veil = document.createElement('canvas');
  }
  if (veil.width !== width || veil.height !== height) {
    veil.width = width;
    veil.height = height;
  }
  const ctx = veil.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, width, height);
  return ctx;
}

/**
 * Le voile de la nuit, troué par les lumières.
 *
 * On peint le voile plein sur un canevas à part, puis on l'efface en dégradé
 * autour de chaque source : `destination-out` retire de l'opacité au lieu
 * d'ajouter du clair. Peindre des halos par-dessus donnerait des taches
 * lumineuses posées sur le noir ; ici c'est bien l'obscurité qu'on perce.
 *
 * Le cœur ne perce jamais tout : une torche éclaire, elle ne ramène pas le
 * plein jour. Sans ce plafond, le halo révélait le terrain à sa clarté de midi
 * et se lisait comme un projecteur blanc.
 */
function drawNight(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const tint = skyTint(scene.steps);
  if (tint.alpha <= 0.002) return;

  const { camera, viewport, stores } = scene;
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));

  const layer = veilContext(width, height);
  if (!layer) return;

  layer.globalAlpha = 1;
  layer.fillStyle = tint.color;
  layer.fillRect(0, 0, width, height);

  layer.globalCompositeOperation = 'destination-out';
  for (const [entity, light] of stores.light.entries()) {
    const transform = stores.transform.get(entity);
    if (!transform) continue;
    const point = screenPointOf(scene, entity, transform);
    const radius = light.radius / camera.scale;
    if (point.x + radius < 0 || point.x - radius > width) continue;
    if (point.y + radius < 0 || point.y - radius > height) continue;

    const halo = layer.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    halo.addColorStop(0, 'rgba(0,0,0,0.78)');
    halo.addColorStop(0.5, 'rgba(0,0,0,0.34)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    layer.fillStyle = halo;
    layer.beginPath();
    layer.arc(point.x, point.y, radius, 0, Math.PI * 2);
    layer.fill();
  }
  layer.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalAlpha = tint.alpha;
  ctx.drawImage(veil!, 0, 0, viewport.width, viewport.height);
  ctx.restore();
}

/**
 * Recopie l'image de chaque morceau visible, à l'échelle de la caméra.
 *
 * Le lissage du navigateur adoucit les frontières entre biomes : à cette
 * résolution, des carrés nets se liraient comme un défaut plutôt que comme un
 * parti pris. Un demi-pixel de recouvrement évite les fentes entre morceaux.
 */
function drawTerrain(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { camera, viewport, chunks, painter } = scene;
  const range = visibleChunks(camera, viewport, CHUNK_SIZE);
  const chunkOnScreen = CHUNK_SIZE / camera.scale;

  // Lissage à la qualité par défaut : « high » multiplie le coût de chaque
  // agrandissement, et à plus de cent morceaux par image la différence se paie
  // en fluidité sans se voir à l'écran.
  ctx.imageSmoothingEnabled = true;

  for (let cy = range.minY; cy <= range.maxY; cy++) {
    for (let cx = range.minX; cx <= range.maxX; cx++) {
      const chunk = chunks.get(cx, cy);
      const corner = worldToScreen(camera, viewport, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      ctx.drawImage(painter.imageFor(chunk), corner.x, corner.y, chunkOnScreen + 0.5, chunkOnScreen + 0.5);
    }
  }
}
