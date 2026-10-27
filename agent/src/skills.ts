import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

/**
 * Skille briefowania kodera.
 *
 * Wiedza o tym, JAK zabrifować model kodujący dla danego rodzaju zmiany, nie musi
 * siedzieć w wagach Bielika — może leżeć w plikach pisanych ręcznie. Bielikowi zostaje
 * wtedy klasyfikacja ("który to rodzaj zmiany") i wypełnienie dwóch slotów, czyli
 * dokładnie to, co robi bezbłędnie.
 *
 * Każdy skill wie trzy rzeczy, których model wiedzieć nie może: których plików rdzenia
 * zmiana dotyczy, jakich inwariantów nie wolno złamać, i gdzie w kodzie leży punkt
 * zaczepienia. Dopisanie nowego skilla jest tańsze niż jakiekolwiek dostrajanie modelu —
 * i to jest główna droga rozwoju tego systemu.
 */

export interface Skill {
  id: string;
  name: string;
  /** Opis, po którym Bielik rozpoznaje, że to ten rodzaj zmiany. */
  when: string;
  /** Pliki rdzenia wysyłane koderowi jako kontekst — mniej znaczy celniej i szybciej. */
  files: string[];
  /** Szablon briefu po angielsku ze slotami {{MECHANIZM_EN}} i {{EFEKT_PL}}. */
  template: string;
}

const DIR = resolve(ROOT, 'agent/skills');
const FRONT = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parse(raw: string, file: string): Skill {
  const m = raw.match(FRONT);
  if (!m) throw new Error(`skill ${file}: brak nagłówka między ---`);
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const key of ['id', 'name', 'when', 'files']) {
    if (!meta[key]) throw new Error(`skill ${file}: brakuje pola "${key}"`);
  }
  return {
    id: meta.id!,
    name: meta.name!,
    when: meta.when!,
    files: meta.files!.split(',').map((f) => f.trim()).filter(Boolean),
    template: m[2]!.trim(),
  };
}

let cache: Skill[] | null = null;

export function loadSkills(): Skill[] {
  if (cache) return cache;
  cache = readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parse(readFileSync(resolve(DIR, f), 'utf8'), f));
  return cache;
}

/** Lista do promptu routingu — Bielik wybiera po opisie "kiedy". */
export function skillMenu(skills = loadSkills()): string {
  return skills.map((s) => `- ${s.id}: ${s.when}`).join('\n');
}

export function findSkill(id: string, skills = loadSkills()): Skill | null {
  return skills.find((s) => s.id === id) ?? null;
}

export interface BriefSlots {
  mechanizmEn: string;
  efektPl: string;
}

export function renderBrief(skill: Skill, slots: BriefSlots): string {
  return skill.template
    .replaceAll('{{MECHANIZM_EN}}', slots.mechanizmEn.trim())
    .replaceAll('{{EFEKT_PL}}', slots.efektPl.trim());
}

/** Brief awaryjny, gdy żaden skill nie pasuje — i jednocześnie sygnał, że trzeba dopisać nowy. */
export function genericBrief(slots: BriefSlots): string {
  return [
    `TASK: ${slots.mechanizmEn.trim()}`,
    '',
    'INVARIANTS YOU MUST NOT BREAK',
    '- `tick()` stays a pure function of (state, input, registry).',
    '- Randomness comes only from the Rng instance seeded from `state.rng`.',
    '- Energy stays within [0, config.energyMax]; inventory counts stay positive.',
    '- Content schemas, tests and the quality gate are not writable.',
    '',
    `The player should notice: ${slots.efektPl.trim()}`,
  ].join('\n');
}

export const FALLBACK_FILES = [
  'game/src/core/types.ts',
  'game/src/core/tick.ts',
  'game/src/core/world.ts',
  'game/src/core/game.ts',
  'game/src/core/rng.ts',
];
