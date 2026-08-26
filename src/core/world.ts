/**
 * Registre d'entités et stockage des composants.
 *
 * Une entité n'est qu'un identifiant ; tout ce qu'elle « est » vit dans les
 * composants qui lui sont associés. Le stockage est ici une Map par type de
 * composant : lisible, suffisant à cette échelle. Le passage à un stockage par
 * archétype (tableaux contigus) se fera quand un profilage le réclamera, pas
 * avant — l'interface publique ci-dessous ne changera pas pour autant.
 */
export type Entity = number;

export class ComponentStore<T> {
  readonly name: string;
  private readonly data = new Map<Entity, T>();

  constructor(name: string) {
    this.name = name;
  }

  set(entity: Entity, value: T): T {
    this.data.set(entity, value);
    return value;
  }

  get(entity: Entity): T | undefined {
    return this.data.get(entity);
  }

  has(entity: Entity): boolean {
    return this.data.has(entity);
  }

  remove(entity: Entity): void {
    this.data.delete(entity);
  }

  get size(): number {
    return this.data.size;
  }

  /** Itère les couples (entité, composant) dans l'ordre d'insertion. */
  entries(): IterableIterator<[Entity, T]> {
    return this.data.entries();
  }

  clear(): void {
    this.data.clear();
  }
}

/** État complet du monde, en JSON pur : sauvegarde, comparaison, transport réseau. */
export interface Snapshot {
  nextId: Entity;
  entities: Entity[];
  components: Record<string, Array<[Entity, unknown]>>;
}

export class World {
  private nextId: Entity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<string, ComponentStore<unknown>>();

  /** Déclare un stockage auprès du monde pour qu'il entre dans les instantanés. */
  register<T>(store: ComponentStore<T>): ComponentStore<T> {
    if (this.stores.has(store.name)) {
      throw new Error(`Un stockage nommé « ${store.name} » est déjà enregistré`);
    }
    this.stores.set(store.name, store as ComponentStore<unknown>);
    return store;
  }

  create(): Entity {
    const entity = this.nextId++;
    this.alive.add(entity);
    return entity;
  }

  destroy(entity: Entity): void {
    this.alive.delete(entity);
    for (const store of this.stores.values()) store.remove(entity);
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  /**
   * Copie profonde de l'état, sérialisable telle quelle.
   *
   * L'ordre d'itération est conservé, de sorte que deux instantanés d'un même
   * état produisent exactement le même JSON — c'est ce qui permettra de
   * comparer deux sauvegardes octet à octet.
   */
  snapshot(): Snapshot {
    const components: Record<string, Array<[Entity, unknown]>> = {};
    for (const [name, store] of this.stores) {
      components[name] = [...store.entries()].map(([e, c]) => [e, structuredClone(c)]);
    }
    return { nextId: this.nextId, entities: [...this.alive], components };
  }

  /** Remplace l'état courant par celui d'un instantané. */
  restore(snapshot: Snapshot): void {
    this.nextId = snapshot.nextId;
    this.alive.clear();
    for (const entity of snapshot.entities) this.alive.add(entity);
    for (const store of this.stores.values()) store.clear();
    for (const [name, pairs] of Object.entries(snapshot.components)) {
      const store = this.stores.get(name);
      if (!store) throw new Error(`Instantané inconnu du monde : aucun stockage « ${name} »`);
      for (const [entity, value] of pairs) store.set(entity, structuredClone(value));
    }
  }
}
