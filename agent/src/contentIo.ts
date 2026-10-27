import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, ROOT } from './config.js';
import type { Collection } from './spec.js';

export type ListCollection = Exclude<Collection, 'config'>;

const file = (name: string) => resolve(ROOT, DATA_DIR, `${name}.json`);

export function readList(name: ListCollection): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(file(name), 'utf8')) as Array<Record<string, unknown>>;
}

export function writeList(name: ListCollection, data: unknown[]): void {
  writeFileSync(file(name), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(file('config'), 'utf8')) as Record<string, unknown>;
}

export function writeConfig(data: unknown): void {
  writeFileSync(file('config'), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Skrót stanu treści wstrzykiwany do promptu.
 *
 * Bez niego model wymyśla identyfikatory, których nie ma, i każda spec ginie na kontroli
 * referencji. Z nim trafia w istniejące id za pierwszym razem — to najtańszy sposób
 * podniesienia skuteczności modelu 11B, jaki tu działa.
 */
export function digest(): string {
  const items = readList('items');
  const structures = readList('structures');
  const resources = readList('resources');
  const recipes = readList('recipes');
  const biomes = readList('biomes');
  const npcs = readList('npcs');

  const itemLine = (i: any) => {
    const tags: string[] = [];
    if (i.tool) tags.push(`narzędzie:${i.tool.kind}/siła${i.tool.power}`);
    if (i.edible) tags.push(`jedzenie:+${i.edible.energy}`);
    if (i.placeable) tags.push(`stawiane→${i.placeable.structure}`);
    return `${i.id} "${i.name}" wart=${i.value}${tags.length ? ' [' + tags.join(' ') + ']' : ''}`;
  };
  const recipeLine = (r: any) =>
    `${r.id} @${r.station}: ${r.inputs.map((x: any) => `${x.qty}×${x.item}`).join(' + ')} → ${r.output.qty}×${r.output.item}`;
  const resourceLine = (r: any) =>
    `${r.id} "${r.name}" — zbierasz narzędziem ${r.tool} w biomach [${r.biomes.join(',')}], ` +
    `DAJE PRZEDMIOTY: ${r.drops.map((d: any) => d.item).join(', ')}`;

  return [
    'PRZEDMIOTY — tylko te id wolno podawać jako wsad receptury i jako łup surowca:',
    `(${items.length})`,
    ...items.map((i) => '  ' + itemLine(i)),
    `STRUKTURY (${structures.length}):`,
    ...structures.map((s: any) => `  ${s.id} "${s.name}"${s.station ? ' stacja=' + s.station : ''}${s.storage ? ' schowek=' + s.storage : ''}`),
    'SUROWCE — rosną/leżą w świecie i NIE SĄ przedmiotami. Nie wolno ich podawać jako wsadu',
    'receptury. Receptura bierze to, co surowiec DAJE:',
    `(${resources.length})`,
    ...resources.map((r) => '  ' + resourceLine(r)),
    `RECEPTURY (${recipes.length}):`,
    ...recipes.map((r) => '  ' + recipeLine(r)),
    `BIOMY (${biomes.length}): ${biomes.map((b: any) => b.id).join(', ')}`,
    `NPC (${npcs.length}): ${npcs.map((n: any) => n.id).join(', ')}`,
  ].join('\n');
}
