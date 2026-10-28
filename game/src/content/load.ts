import config from '../../content/config.json';
import items from '../../content/items.json';
import structures from '../../content/structures.json';
import resources from '../../content/resources.json';
import recipes from '../../content/recipes.json';
import biomes from '../../content/biomes.json';
import facades from '../../content/facades.json';
import npcs from '../../content/npcs.json';
import zadania from '../../content/zadania.json';
import { formatIssues, validateContent, type Registry } from './registry.js';

/** Surowa treść przed walidacją — używana przez testy i bramkę agenta. */
export const rawContent = { config, items, structures, resources, recipes, biomes, facades, npcs, zadania };

let cached: Registry | null = null;

/** Rejestr dla kodu gry. Rzuca wyjątkiem, jeśli treść jest niespójna — gra nie wystartuje na zepsutych danych. */
export function registry(): Registry {
  if (cached) return cached;
  const res = validateContent(rawContent);
  if (!res.ok) {
    throw new Error('Treść gry jest niespójna:\n' + formatIssues(res.issues));
  }
  cached = res.registry;
  return cached;
}
