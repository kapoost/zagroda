import { describe, expect, it } from 'vitest';
import { rawContent } from '../src/content/load.js';
import { validateContent } from '../src/content/registry.js';

const clone = () => JSON.parse(JSON.stringify(rawContent)) as any;
const codes = (raw: unknown) => {
  const r = validateContent(raw);
  return r.ok ? [] : r.issues.map((i) => i.code);
};

describe('treść gry', () => {
  it('jest spójna', () => {
    const r = validateContent(rawContent);
    if (!r.ok) throw new Error(r.issues.map((i) => `[${i.code}] ${i.where}: ${i.msg}`).join('\n'));
    expect(r.registry.obtainable.size).toBe(r.registry.content.items.length);
  });
});

/**
 * Te testy sprawdzają, czy BRAMKA DZIAŁA — nie czy treść jest poprawna.
 * Każdy z nich psuje treść w konkretny sposób i wymaga, by walidator to złapał.
 * Jeśli któryś przestanie przechodzić, agent dostał cichą furtkę do zepsucia gry.
 */
describe('walidator łapie psucie treści', () => {

  it('narzędzie droższe od poprzednika i pod każdym względem gorsze', () => {
    const c = clone();
    const kilof = c.items.find((i: any) => i.id === 'kilof_kamienny');
    c.items.push({
      ...kilof,
      id: 'mlot_atrapa',
      name: 'Młot atrapa',
      value: kilof.value + 10,
      tool: { kind: 'pickaxe', power: kilof.tool.power, durability: 30 },
    });
    expect(codes(c)).toContain('DOMINACJA');
  });

  it('narzędzie mocniejsze, ale kruchsze od poprzednika', () => {
    const c = clone();
    const kosa = c.items.find((i: any) => i.id === 'kosa');
    c.items.push({
      ...kosa,
      id: 'kosa_atrapa',
      name: 'Kosa atrapa',
      value: kosa.value + 10,
      tool: { kind: 'scythe', power: kosa.tool.power + 1, durability: 50 },
    });
    expect(codes(c)).toContain('DOMINACJA');
  });

  it('lepsze narzędzie za tę samą cenę wytworzenia', () => {
    const c = clone();
    const kosa = c.items.find((i: any) => i.id === 'kosa');
    const r = c.recipes.find((x: any) => x.output.item === 'kosa');
    c.items.push({
      ...kosa,
      id: 'kosa_atrapa',
      name: 'Kosa atrapa',
      value: kosa.value + 10,
      tool: { kind: 'scythe', power: kosa.tool.power + 1, durability: kosa.tool.durability },
    });
    c.recipes.push({ ...r, id: 'r_kosa_atrapa', output: { item: 'kosa_atrapa', qty: 1 } });
    expect(codes(c)).toContain('KOSZT_POSTEPU');
  });

  it('tag spoza zamkniętego słownika', () => {
    const c = clone();
    c.items[0].tags = ['narzucie'];
    expect(codes(c)).toContain('SCHEMA');
  });
  it('wiszącą referencję do itemu', () => {
    const c = clone();
    c.recipes[0].inputs[0].item = 'nie_ma_takiego';
    expect(codes(c)).toContain('REF_ITEM');
  });

  it('podpowiada, gdy ktoś poda id surowca zamiast przedmiotu', () => {
    // Najczęstsza pomyłka modelu: "pleciony z trzciny" → wsad "trzcina", podczas gdy
    // trzcina to roślina w świecie, a przedmiotem jest włókno. Komunikat ma to tłumaczyć,
    // bo to on wraca do modelu jako instrukcja poprawki.
    const c = clone();
    c.recipes.find((r: any) => r.id === 'r_sznurek').inputs[0].item = 'trzcina';
    const r = validateContent(c);
    expect(r.ok).toBe(false);
    const msg = r.ok ? '' : r.issues.map((i) => i.msg).join(' ');
    expect(msg).toContain('surowiec');
    expect(msg).toContain('wlokno');
  });

  it('wiszącą referencję do struktury', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'stol_warsztatowy').placeable.structure = 'widmo';
    expect(codes(c)).toContain('REF_STRUCTURE');
  });

  it('zduplikowane id', () => {
    const c = clone();
    c.items.push({ ...c.items[0] });
    expect(codes(c)).toContain('DUP_ID');
  });

  it('cykl w recepturach', () => {
    const c = clone();
    c.recipes.push({
      id: 'r_cykl', name: 'Cofnij deski', station: 'workbench',
      inputs: [{ item: 'deska', qty: 2 }], output: { item: 'drewno', qty: 1 }, ticks: 5,
    });
    expect(codes(c)).toContain('RECIPE_CYCLE');
  });

  it('item, którego nie da się zdobyć', () => {
    const c = clone();
    c.items.push({ id: 'artefakt_widmo', name: 'Artefakt widmo', value: 5 });
    expect(codes(c)).toContain('UNREACHABLE_ITEM');
  });

  it('recepturę bez dostępnej stacji', () => {
    const c = clone();
    // Zabieramy stację, zostawiając samą strukturę — inaczej pierwszy zapala się
    // REF_STRUCTURE (item "piec" wskazuje na nią) i walidator kończy wcześniej.
    delete c.structures.find((s: any) => s.station === 'furnace').station;
    expect(codes(c)).toContain('NO_STATION');
  });

  it('dziurę w przestrzeni biomów', () => {
    const c = clone();
    c.biomes.find((b: any) => b.id === 'trawa').moisture = [0, 0.2];
    expect(codes(c)).toContain('BIOME_HOLE');
  });

  it('pętlę nieskończonego zysku (ekonomia)', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'deska').value = 500;
    expect(codes(c)).toContain('ECON');
  });

  it('narzędzie o niemożliwej sile (poza granicami schematu)', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'siekiera_kamienna').tool.power = 99;
    expect(codes(c)).toContain('SCHEMA');
  });

  it('jedzenie regenerujące absurdalnie dużo energii', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'jagoda').edible.energy = 9999;
    expect(codes(c)).toContain('SCHEMA');
  });

  it('przedmiot, który jest naraz budynkiem i narzędziem', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'skrzynia').tool = { kind: 'axe', power: 1, durability: 100 };
    expect(codes(c)).toContain('ROLA');
  });

  it('przedmiot, który jest naraz budynkiem i jedzeniem', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'skrzynia').edible = { energy: 5 };
    expect(codes(c)).toContain('ROLA');
  });

  it('narzędzie o rodzaju "hand" — czyli brak narzędzia udający narzędzie', () => {
    const c = clone();
    c.items.find((i: any) => i.id === 'siekiera_kamienna').tool.kind = 'hand';
    expect(codes(c)).toContain('SCHEMA');
  });

  it('przedmiot, który do niczego nie służy', () => {
    const c = clone();
    c.items.push({ id: 'bibelot', name: 'Bibelot', value: 3 });
    c.recipes.push({
      id: 'r_bibelot', name: 'Bibelot', station: 'hand',
      inputs: [{ item: 'kamien', qty: 1 }], output: { item: 'bibelot', qty: 1 }, ticks: 2,
    });
    expect(codes(c)).toContain('BEZ_ZASTOSOWANIA');
  });

  it('nieznane pole w definicji itemu', () => {
    const c = clone();
    c.items[0].godmode = true;
    expect(codes(c)).toContain('SCHEMA');
  });

  it('surowiec wymagający narzędzia, którego nie da się zdobyć', () => {
    const c = clone();
    c.resources.find((r: any) => r.id === 'krzak').tool = 'hoe';
    const got = codes(c);
    expect(got.some((x) => x === 'UNREACHABLE_RESOURCE' || x === 'UNREACHABLE_ITEM')).toBe(true);
  });
});
