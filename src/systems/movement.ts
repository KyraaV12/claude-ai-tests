import type { Axis } from './input.ts';
import type { Stores } from '../core/components.ts';

/**
 * Déplacement dans un monde sans bords.
 *
 * Il n'y a plus de repli : le monde est ouvert, une entité peut s'éloigner
 * indéfiniment. Ce qui la retient est le décor et le jeu, pas une bordure.
 */

/** Traduit la direction demandée en accélération, puis borne la vitesse. */
export function applyControl(stores: Stores, axis: Axis, dt: number): void {
  for (const [entity, control] of stores.controlled.entries()) {
    const velocity = stores.velocity.get(entity);
    if (!velocity) continue;

    if (axis.x !== 0 || axis.y !== 0) {
      velocity.x += axis.x * control.acceleration * dt;
      velocity.y += axis.y * control.acceleration * dt;
      // La direction est retenue : à l'arrêt, on doit encore savoir où poser.
      control.facingX = axis.x;
      control.facingY = axis.y;
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
 * Intègre les vitesses.
 *
 * La position précédente est conservée avant d'avancer : c'est elle que le
 * rendu interpole, et sans elle l'affichage saccaderait entre deux pas.
 */
export function integrate(stores: Stores, dt: number): void {
  for (const [entity, transform] of stores.transform.entries()) {
    transform.previousX = transform.x;
    transform.previousY = transform.y;

    const velocity = stores.velocity.get(entity);
    if (!velocity) continue;

    transform.x += velocity.x * dt;
    transform.y += velocity.y * dt;
  }
}
