import type { Stores } from '../core/components.ts';
import type { Bounds } from './movement.ts';
import { wrap } from './movement.ts';

export interface Palette {
  surface: string;
  grid: string;
  ink: string;
  outline: string;
}

/** Zone d'affichage du monde dans le canevas, après mise à l'échelle et centrage. */
interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function fit(canvasWidth: number, canvasHeight: number, bounds: Bounds): Viewport {
  const scale = Math.min(canvasWidth / bounds.width, canvasHeight / bounds.height);
  return {
    scale,
    offsetX: (canvasWidth - bounds.width * scale) / 2,
    offsetY: (canvasHeight - bounds.height * scale) / 2,
  };
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Dessine l'état interpolé.
 *
 * `alpha` situe le rendu entre le dernier pas de simulation et le suivant : à
 * 60 pas par seconde sur un écran à 144 Hz, c'est ce qui évite le saccadement.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  stores: Stores,
  alpha: number,
  bounds: Bounds,
  palette: Palette,
  size: { width: number; height: number },
): void {
  const view = fit(size.width, size.height, bounds);

  ctx.save();
  ctx.clearRect(0, 0, size.width, size.height);

  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);

  // Aire de jeu et grille de repère.
  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let x = 0; x <= bounds.width; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, bounds.height);
  }
  for (let y = 0; y <= bounds.height; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(bounds.width, y);
  }
  ctx.stroke();

  for (const [entity, transform] of stores.transform.entries()) {
    const sprite = stores.sprite.get(entity);
    const body = stores.body.get(entity);
    // Le rayon vient du corps, la teinte de l'apparence : un corps sans Sprite
    // existe pour la physique sans rien dessiner.
    if (!sprite || !body) continue;

    const x = wrap(lerp(transform.previousX, transform.x, alpha), bounds.width);
    const y = wrap(lerp(transform.previousY, transform.y, alpha), bounds.height);

    ctx.beginPath();
    ctx.arc(x, y, body.radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${sprite.hue} 70% 55%)`;
    ctx.fill();

    // L'entité pilotée porte un liseré, pour la retrouver d'un coup d'œil.
    if (stores.controlled.has(entity)) {
      ctx.lineWidth = 2 / view.scale;
      ctx.strokeStyle = palette.ink;
      ctx.stroke();
    }
  }

  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeRect(0, 0, bounds.width, bounds.height);
  ctx.restore();
}
