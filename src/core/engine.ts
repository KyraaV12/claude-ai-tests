import { FixedStep } from './time.ts';

export interface EngineHooks {
  /** Un pas de simulation. Ne doit dépendre que de `dt`, jamais du temps réel. */
  fixedUpdate(dt: number): void;
  /** Dessine l'état, interpolé de `alpha` entre le dernier pas et le suivant. */
  render(alpha: number): void;
}

/**
 * Source des images et du temps.
 *
 * Injectable pour que la boucle soit vérifiable hors navigateur : sans ça,
 * pause et pas-à-pas ne pourraient être testés qu'à l'œil.
 */
export interface Scheduler {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

export const browserScheduler: Scheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};

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
 * Les deux sont volontairement découplés. Un écran à 144 Hz et un autre à
 * 60 Hz exécutent exactement la même simulation ; seul le nombre d'images
 * diffère.
 */
export class Engine {
  private readonly hooks: EngineHooks;
  private readonly clock: FixedStep;
  private readonly scheduler: Scheduler;
  private frameHandle = 0;
  private lastFrameMs = 0;
  private running = false;
  private paused = false;
  private pendingSingleSteps = 0;
  private smoothedFps = 0;
  private stats: EngineStats = { fps: 0, stepsLastFrame: 0, totalSteps: 0 };

  constructor(hooks: EngineHooks, stepsPerSecond = 60, scheduler: Scheduler = browserScheduler) {
    this.hooks = hooks;
    this.clock = new FixedStep(1 / stepsPerSecond);
    this.scheduler = scheduler;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  getStats(): EngineStats {
    return { ...this.stats };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = this.scheduler.now();
    this.clock.reset();
    this.frameHandle = this.scheduler.request(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.scheduler.cancel(this.frameHandle);
  }

  /**
   * Suspend la simulation sans arrêter le rendu.
   *
   * Continuer à dessiner permet d'observer et de modifier l'état pendant
   * l'arrêt — un inspecteur devant un écran figé ne servirait à rien.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pendingSingleSteps = 0;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Des pas demandés puis abandonnés au profit de la reprise n'ont plus lieu
    // d'être : sans ça, ils partiraient en rafale à la pause suivante.
    this.pendingSingleSteps = 0;
    // Le temps écoulé pendant la pause n'appartient pas à la simulation.
    this.clock.reset();
    this.lastFrameMs = this.scheduler.now();
  }

  /** Demande l'exécution d'exactement `count` pas au prochain rendu. */
  stepOnce(count = 1): void {
    if (!this.paused) return;
    this.pendingSingleSteps += Math.max(0, Math.trunc(count));
  }

  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.frameHandle = this.scheduler.request(this.frame);

    const elapsedSeconds = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    let steps = 0;
    let alpha = 0;

    if (this.paused) {
      // À l'arrêt, on ne montre aucune interpolation : ce qui est affiché est
      // exactement l'état qu'on inspecte, pas un intermédiaire.
      steps = this.pendingSingleSteps;
      this.pendingSingleSteps = 0;
      for (let i = 0; i < steps; i++) this.hooks.fixedUpdate(this.clock.dt);
    } else {
      const tick = this.clock.advance(elapsedSeconds);
      steps = tick.steps;
      alpha = tick.alpha;
      for (let i = 0; i < steps; i++) this.hooks.fixedUpdate(this.clock.dt);
    }

    this.hooks.render(alpha);

    // Une demi-milliseconde entre deux images, c'est une horloge qui vient
    // d'être remise à zéro — au retour d'une pause — et non un affichage à
    // deux mille images par seconde. Sans cette garde, la barre annonçait
    // dix-neuf milliards d'images par seconde au premier tour après reprise.
    if (elapsedSeconds >= 0.0005) {
      const instant = 1 / elapsedSeconds;
      // Lissage exponentiel : le compteur reste lisible sans mentir sur les à-coups.
      this.smoothedFps = this.smoothedFps === 0 ? instant : this.smoothedFps * 0.9 + instant * 0.1;
    }
    this.stats = {
      fps: this.smoothedFps,
      stepsLastFrame: steps,
      totalSteps: this.stats.totalSteps + steps,
    };
  };
}
