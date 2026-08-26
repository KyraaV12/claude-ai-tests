import type { Entity, World } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import type { Engine } from '../core/engine.ts';
import { componentsOf, describeEntity, listEntities, parseFieldInput, setField } from './inspect.ts';

export interface InspectorDeps {
  container: HTMLElement;
  getWorld(): World;
  getStores(): Stores;
  engine: Engine;
}

export interface Inspector {
  refresh(): void;
  select(entity: Entity | null): void;
  selected(): Entity | null;
}

/** Trois décimales à l'affichage, la valeur exacte en infobulle. */
function short(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function createInspector(deps: InspectorDeps): Inspector {
  const { container, engine } = deps;
  container.replaceChildren();

  const toolbar = element('div', 'inspector-toolbar');
  const playButton = button('Pause');
  const stepButton = button('+1 pas');
  const stepTenButton = button('+10 pas');
  const clock = element('span', 'inspector-clock');
  toolbar.append(playButton, stepButton, stepTenButton, clock);

  const listTitle = element('p', 'inspector-title', 'Entités');
  const list = element('div', 'inspector-list');
  const detailTitle = element('p', 'inspector-title', 'Aucune entité sélectionnée');
  const detail = element('div', 'inspector-detail');

  container.append(toolbar, listTitle, list, detailTitle, detail);

  let selected: Entity | null = null;
  let renderedEntities = '';
  const buttons = new Map<Entity, HTMLButtonElement>();

  playButton.addEventListener('click', () => {
    if (engine.isPaused) engine.resume();
    else engine.pause();
    refresh();
  });
  stepButton.addEventListener('click', () => {
    if (!engine.isPaused) engine.pause();
    engine.stepOnce(1);
    refresh();
  });
  stepTenButton.addEventListener('click', () => {
    if (!engine.isPaused) engine.pause();
    engine.stepOnce(10);
    refresh();
  });

  function rebuildList(entities: Entity[]): void {
    list.replaceChildren();
    buttons.clear();
    const stores = deps.getStores();
    for (const entity of entities) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'inspector-row';
      row.append(
        element('span', 'inspector-id', `#${entity}`),
        element('span', 'inspector-tags', componentsOf(stores, entity).join(' ')),
      );
      row.addEventListener('click', () => select(entity));
      list.append(row);
      buttons.set(entity, row);
    }
  }

  function rebuildDetail(): void {
    detail.replaceChildren();
    if (selected === null) {
      detailTitle.textContent = 'Aucune entité sélectionnée';
      return;
    }
    detailTitle.textContent = `Entité #${selected}`;

    for (const component of describeEntity(deps.getStores(), selected)) {
      const group = element('div', 'inspector-group');
      group.append(element('p', 'inspector-component', component.name));

      for (const field of component.fields) {
        const label = document.createElement('label');
        label.className = 'inspector-field';
        label.append(element('span', 'inspector-field-name', field.name));

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = short(field.value);
        input.title = String(field.value);
        input.dataset['component'] = component.name;
        input.dataset['field'] = field.name;

        input.addEventListener('input', () => {
          const entity = selected;
          if (entity === null) return;

          const parsed = parseFieldInput(input.value);
          if (parsed.kind === 'empty') {
            // Champ vidé pour être retapé : on n'écrit rien et on ne crie pas.
            // La valeur réelle réapparaîtra au prochain rafraîchissement.
            input.classList.remove('is-rejected');
            return;
          }
          // Une valeur refusée reste affichée telle que tapée : l'effacer sous les
          // doigts de qui édite est plus déroutant qu'un champ momentanément faux.
          const ok =
            parsed.kind === 'value' &&
            setField(deps.getStores(), entity, component.name, field.name, parsed.value);
          input.classList.toggle('is-rejected', !ok);
        });

        label.append(input);
        group.append(label);
      }
      detail.append(group);
    }
  }

  function refreshValues(): void {
    if (selected === null) return;

    // Une seule lecture de l'état par rafraîchissement, pas une par champ.
    const current = new Map<string, number>();
    for (const component of describeEntity(deps.getStores(), selected)) {
      for (const field of component.fields) current.set(`${component.name}.${field.name}`, field.value);
    }

    for (const input of detail.querySelectorAll('input')) {
      // Ne jamais écraser ce que quelqu'un est en train de taper.
      if (input === document.activeElement) continue;

      const value = current.get(`${input.dataset['component']}.${input.dataset['field']}`);
      if (value === undefined) continue;

      input.value = short(value);
      input.title = String(value);
      input.classList.remove('is-rejected');
    }
  }

  function select(entity: Entity | null): void {
    selected = entity;
    for (const [id, row] of buttons) row.classList.toggle('is-selected', id === entity);
    rebuildDetail();
  }

  function refresh(): void {
    const world = deps.getWorld();
    const entities = listEntities(world);

    // La liste ne se reconstruit que si l'ensemble a changé : la rebâtir à
    // chaque rafraîchissement perdrait le focus et la sélection.
    const signature = entities.join(',');
    if (signature !== renderedEntities) {
      renderedEntities = signature;
      rebuildList(entities);
      if (selected !== null && !world.isAlive(selected)) selected = null;
      select(selected);
    }

    playButton.textContent = engine.isPaused ? 'Reprendre' : 'Pause';
    playButton.dataset['state'] = engine.isPaused ? 'arrêté' : 'en cours';
    clock.textContent = `${engine.getStats().totalSteps} pas`;

    if (selected !== null && !detail.hasChildNodes()) rebuildDetail();
    refreshValues();
  }

  refresh();
  return { refresh, select, selected: () => selected };
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'inspector-button';
  node.textContent = label;
  return node;
}
