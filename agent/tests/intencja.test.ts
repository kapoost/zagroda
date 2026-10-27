import { describe, expect, it } from 'vitest';
import { feedbackAsercji, sprawdzAsercje } from '../src/stages/intencja.js';

const jeden = (a: string) => sprawdzAsercje([a])[0]!;

/**
 * Wyrocznia intencji pilnuje czegoś, czego bramka nie dotyka: czy zmiana jest TA,
 * o którą proszono. Te testy sprawdzają wyrocznię, nie treść — a najważniejszy
 * z nich jest ten o fail-closed, bo asercja, której nie da się sprawdzić, jest
 * gorsza niż jej brak: udaje dowód.
 */
describe('warunki intencji', () => {
  it('porównuje dwie ścieżki w treści', () => {
    const w = jeden('items.mlot_kamienny.tool.durability > items.kilof_kamienny.tool.durability');
    expect(w.ok).toBe(true);
  });

  it('łapie liczbę ustawioną wbrew prośbie', () => {
    const w = jeden('items.mlot_kamienny.tool.durability < items.kilof_kamienny.tool.durability');
    expect(w.ok).toBe(false);
    expect(w.powod).toMatch(/fałsz/);
  });

  it('porównuje ścieżkę z liczbą', () => {
    expect(jeden('config.energyMax >= 100').ok).toBe(true);
    expect(jeden('config.worldSize == 256').ok).toBe(true);
  });

  it('liczy długość listy', () => {
    expect(jeden('recipes.r_mlot_kamienny.inputs.length == 3').ok).toBe(true);
  });

  it('nieistniejący wpis to błąd, nie prawda', () => {
    const w = jeden('items.nie_ma_takiego.value > 1');
    expect(w.ok).toBe(false);
    expect(w.powod).toMatch(/nie ma wpisu/);
  });

  it('nieistniejące pole to błąd, nie prawda', () => {
    expect(jeden('items.kamien.obrazenia > 1').ok).toBe(false);
  });

  it('pole nieliczbowe to błąd, nie prawda', () => {
    expect(jeden('items.kamien.name > 1').ok).toBe(false);
  });

  it('odrzuca zdanie bez operatora', () => {
    expect(jeden('młot jest wytrzymalszy').ok).toBe(false);
  });

  it('zwraca komunikaty tylko dla niespełnionych', () => {
    const wyniki = sprawdzAsercje(['config.energyMax >= 100', 'config.energyMax > 10000']);
    expect(feedbackAsercji(wyniki)).toHaveLength(1);
  });
});
