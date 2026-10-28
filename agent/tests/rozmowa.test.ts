import { describe, expect, it } from 'vitest';
import { czyWreczono } from '../src/rozmowa.js';

/**
 * Filtr czasownika dawania stoi PRZED modelem, bo gramatyka zawężona do listy darów
 * kusi wybraniem czegokolwiek z listy. Te testy pilnują, żeby filtr nie odwracał
 * znaczenia zdania — a raz już odwrócił.
 */
describe('rozpoznanie wręczenia', () => {
  it('łapie faktyczne wręczenie', () => {
    expect(czyWreczono('Tak, daję ci jeden sznurek.')).toBe(true);
    expect(czyWreczono('Masz tu rybę, zjedz zanim wyschnie.')).toBe(true);
    expect(czyWreczono('Weź, przyda ci się.')).toBe(true);
    expect(czyWreczono('Trzymaj, ostatni mi został.')).toBe(true);
  });

  it('nie bierze propozycji wymiany za wręczenie', () => {
    // "wezme" zawiera "wez" — pierwsza wersja filtru uznawała żądanie zapłaty za dar.
    expect(czyWreczono('Mam jedną, suchą i tłustą. Wezmę w zamian kawałek drewna.')).toBe(false);
    expect(czyWreczono('Wezmę od ciebie trzy jagody, wtedy pogadamy.')).toBe(false);
  });

  it('nie bierze odmowy ani wzmianki za wręczenie', () => {
    expect(czyWreczono('Nie mam sznurka. Zrób go sam z dwóch włókien.')).toBe(false);
    expect(czyWreczono('Węgiel drzewny wypala się w mielerzu, nie u mnie.')).toBe(false);
    expect(czyWreczono('Jagody rosną na krzakach za wałami.')).toBe(false);
  });
});
