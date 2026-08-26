import { FixedStep } from './time.ts';

export interface EngineHooks {
  /** Un pas de simulation. Ne doit dépendre que de `dt`, jamais du temps réel. */
  fixedUpdate(dt: number): void;
  /** Dessine l'état, interpolé de `alpha` entre le dernier pas et le suivant. */
  render(alpha: number): void;
}

export interface EngineStats {
  /** Images par seconde, lissées. */
  fps: number;
  /** Pas de simulation exécutés à la dernière image. */
  stepsLastFrame: number;
  /** Total de pas depuis le démarrage — l'horloge logique du jeu. */
  totalSteps: number;
}

/**
 * Boucle de jeu : simulation à pas fixe, rendu à la fréquence de l'écran.
 *
 * Les deux sont volontairement découplés. Un écran à 144 Hz et un autre à 60 Hz
 * exécutent exactement la même simulation ; seul le nombre d'images diffère.
 */
export class Engine {
  private readonly hooks: EngineHooks;
  private readonly clock: FixedStep;
  private frameHandle = 0;
  private lastFrameMs = 0;
  private running = false;
  private smoothedFps = 0;
  private stats: EngineStats = { fps: 0, stepsLastFrame: 0, totalSteps: 0 };

  constructor(hooks: EngineHooks, stepsPerSecond = 60) {
    this.hooks = hooks;
    this.clock = new FixedStep(1 / stepsPerSecond);
  }

  get isRunning(): boolean {
    return this.running;
  }

  getStats(): EngineStats {
    return { ...this.stats };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();
    this.clock.reset();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const elapsedSeconds = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    const tick = this.clock.advance(elapsedSeconds);
    for (let i = 0; i < tick.steps; i++) this.hooks.fixedUpdate(this.clock.dt);
    this.hooks.render(tick.alpha);

    if (elapsedSeconds > 0) {
      const instant = 1 / elapsedSeconds;
      // Lissage exponentiel : le compteur reste lisible sans mentir sur les à-coups.
      this.smoothedFps = this.smoothedFps === 0 ? instant : this.smoothedFps * 0.9 + instant * 0.1;
    }
    this.stats = {
      fps: this.smoothedFps,
      stepsLastFrame: tick.steps,
      totalSteps: this.stats.totalSteps + tick.steps,
    };
  };
}
