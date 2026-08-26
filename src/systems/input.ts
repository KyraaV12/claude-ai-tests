export interface Axis {
  x: number;
  y: number;
}

const BINDINGS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], KeyQ: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], KeyZ: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};

/**
 * État du clavier, lu par code physique de touche.
 *
 * `event.code` plutôt que `event.key` : la touche sous l'index reste la même
 * en AZERTY et en QWERTY, ce qui évite d'avoir à choisir une disposition.
 */
export class Keyboard {
  private readonly pressed = new Set<string>();
  private readonly target: EventTarget;

  constructor(target: EventTarget = window) {
    this.target = target;
  }

  attach(): void {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  /** Direction demandée, normalisée : une diagonale ne va pas plus vite qu'une ligne droite. */
  axis(): Axis {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      const binding = BINDINGS[code];
      if (!binding) continue;
      x += binding[0];
      y += binding[1];
    }
    const length = Math.hypot(x, y);
    return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  }

  isPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  private onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (!(key.code in BINDINGS)) return;
    // Empêche les flèches de faire défiler la page pendant qu'on joue.
    key.preventDefault();
    this.pressed.add(key.code);
  };

  private onKeyUp = (event: Event): void => {
    this.pressed.delete((event as KeyboardEvent).code);
  };

  // Sans ça, une touche enfoncée au moment où l'onglet perd le focus reste
  // « enfoncée » pour toujours : l'entité part en ligne droite sans revenir.
  private onBlur = (): void => {
    this.pressed.clear();
  };
}
