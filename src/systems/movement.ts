import type { Axis } from './input.ts';
import type { Stores } from '../core/components.ts';

/**
 * Dimensions logiques du monde, en unités de simulation.
 *
 * Elles ne dépendent pas de la taille de la fenêtre : le rendu s'y adapte, la
 * simulation non. Deux joueurs aux écrans différents simulent le même monde.
 */
export interface Bounds {
  width: number;
  height: number;
}

/** Ramène une coordonnée dans [0, size), y compris pour les valeurs négatives. */
export function wrap(value: number, size: number): number {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}

/** Traduit la direction demandée en accélération, puis borne la vitesse. */
export function applyControl(stores: Stores, axis: Axis, dt: number): void {
  for (const [entity, control] of stores.controlled.entries()) {
    const velocity = stores.velocity.get(entity);
    if (!velocity) continue;

    if (axis.x !== 0 || axis.y !== 0) {
      velocity.x += axis.x * control.acceleration * dt;
      velocity.y += axis.y * control.acceleration * dt;
    } else {
      const decay = Math.max(0, 1 - control.damping * dt);
      velocity.x *= decay;
      velocity.y *= decay;
    }

    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed > control.maxSpeed) {
      const scale = control.maxSpeed / speed;
      velocity.x *= scale;
      velocity.y *= scale;
    }
  }
}

/**
 * Intègre les vitesses et replie le monde sur lui-même aux bords.
 *
 * La position précédente est décalée du même montant que le repli : sans cela,
 * une entité qui franchit un bord serait interpolée en sens inverse et
 * traverserait tout l'écran sur une image.
 */
export function integrate(stores: Stores, dt: number, bounds: Bounds): void {
  for (const [entity, transform] of stores.transform.entries()) {
    transform.previousX = transform.x;
    transform.previousY = transform.y;

    const velocity = stores.velocity.get(entity);
    if (!velocity) continue;

    const nextX = transform.x + velocity.x * dt;
    const nextY = transform.y + velocity.y * dt;
    const wrappedX = wrap(nextX, bounds.width);
    const wrappedY = wrap(nextY, bounds.height);

    transform.previousX += wrappedX - nextX;
    transform.previousY += wrappedY - nextY;
    transform.x = wrappedX;
    transform.y = wrappedY;
  }
}
