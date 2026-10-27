import { readConfig, readList, writeConfig, writeList, type ListCollection } from '../contentIo.js';
import { COLLECTIONS, type Collection } from '../spec.js';

/**
 * Deterministyczny applier operacji na treści.
 *
 * Model nigdy nie pisze plików danych. Tu, w zwykłym kodzie, operacje są stosowane
 * i opisywane po polsku do changeloga. Jeśli operacja jest bezsensowna (patch na
 * nieistniejące id, duplikat), applier odrzuca ją natychmiast — zanim ruszy bramka.
 */

export interface ApplyResult {
  ok: boolean;
  changes: string[];
  errors: string[];
}

const LISTS = COLLECTIONS.filter((c): c is ListCollection => c !== 'config');

export function applyOps(ops: Record<string, unknown>): ApplyResult {
  const changes: string[] = [];
  const errors: string[] = [];
  const loaded = new Map<ListCollection, Array<Record<string, unknown>>>();

  const load = (name: ListCollection) => {
    if (!loaded.has(name)) loaded.set(name, readList(name));
    return loaded.get(name)!;
  };

  // --- dodawanie -----------------------------------------------------------
  for (const name of LISTS) {
    const add = ops[`add_${name}`];
    if (!Array.isArray(add) || !add.length) continue;
    const list = load(name);
    for (const entry of add as Array<Record<string, unknown>>) {
      const id = String(entry.id);
      if (list.some((x) => x.id === id)) {
        errors.push(`${name}: wpis "${id}" już istnieje — użyj patch_${name}, nie add_${name}`);
        continue;
      }
      list.push(entry);
      changes.push(`+ ${name}: ${id}${entry.name ? ` ("${entry.name}")` : ''}`);
    }
  }

  // --- łatanie -------------------------------------------------------------
  for (const name of LISTS) {
    const patches = ops[`patch_${name}`];
    if (!Array.isArray(patches) || !patches.length) continue;
    const list = load(name);
    for (const p of patches as Array<{ id: string; patch: Record<string, unknown> }>) {
      const target = list.find((x) => x.id === p.id);
      if (!target) {
        errors.push(`${name}: nie ma wpisu "${p.id}" do zmiany`);
        continue;
      }
      const touched = Object.keys(p.patch);
      if (!touched.length) continue;
      Object.assign(target, p.patch);
      changes.push(`~ ${name}: ${p.id} (${touched.join(', ')})`);
    }
  }

  // --- usuwanie ------------------------------------------------------------
  const removals = ops.remove;
  if (Array.isArray(removals)) {
    for (const r of removals as Array<{ collection: Collection; id: string }>) {
      if (r.collection === 'config') {
        errors.push('nie można usunąć konfiguracji świata');
        continue;
      }
      const list = load(r.collection as ListCollection);
      const i = list.findIndex((x) => x.id === r.id);
      if (i === -1) {
        errors.push(`${r.collection}: nie ma wpisu "${r.id}" do usunięcia`);
        continue;
      }
      list.splice(i, 1);
      changes.push(`- ${r.collection}: ${r.id}`);
    }
  }

  // --- konfiguracja --------------------------------------------------------
  const cfgPatch = ops.patch_config as Record<string, unknown> | undefined;
  let cfg: Record<string, unknown> | null = null;
  if (cfgPatch && Object.keys(cfgPatch).length) {
    cfg = { ...readConfig(), ...cfgPatch };
    changes.push(`~ config: ${Object.keys(cfgPatch).join(', ')}`);
  }

  if (errors.length) return { ok: false, changes, errors };
  if (!changes.length) return { ok: false, changes, errors: ['specyfikacja nie zawiera żadnej zmiany'] };

  // Zapis dopiero po przejściu wszystkich operacji — brak stanu półzapisanego.
  for (const [name, list] of loaded) writeList(name, list);
  if (cfg) writeConfig(cfg);

  return { ok: true, changes, errors };
}
