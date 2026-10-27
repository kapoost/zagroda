# Zagroda — notatki dla Claude Code

Gra przeglądarkowa (TypeScript + canvas) rozwijana przez lokalny model Bielik.
Monorepo npm workspaces: `game/` (gra), `agent/` (pętla modelu), `tools/` (bramka).

## Nienaruszalne zasady

**Rdzeń jest deterministyczny.** `tick(state, input, registry)` to czysta funkcja.
Żadnego `Math.random()`, `Date.now()` ani ambientowego stanu w `game/src/core/`.
Losowość bierze się wyłącznie z klasy `Rng` zasilanej `state.rng`. Test determinizmu
porównuje hash stanu po tysiącach ticków — złamanie tej zasady widać natychmiast.

**Treść to dane, nie kod.** Nowy przedmiot, receptura, surowiec, budynek czy NPC
to wpis w `game/content/*.json`. Jeśli łapiesz się na pisaniu `if (itemId === '...')`
w rdzeniu — prawdopodobnie brakuje pola w schemacie, a nie gałęzi w kodzie.

**Bramka jest poza zasięgiem agenta.** `game/src/content/schema.ts`,
`game/src/content/registry.ts`, `game/tests/` i `tools/` są na liście zakazu zapisu
(`agent/src/config.ts` → `WRITE_DENY`). Zmieniaj je ręcznie i świadomie — to one
odróżniają „zmiana przeszła" od „zmiana udała, że przeszła".

## Mapa

```
game/src/core/      rdzeń: rng, worldgen, tick, hash stanu — deterministyczny
game/src/content/   schematy Zod + walidator spójności (NIEZAPISYWALNE dla agenta)
game/src/render/    canvas + HUD — czysta prezentacja, zero logiki gry
game/src/sim/bot.ts bot progresji: wyrocznia grywalności
game/content/*.json treść gry
game/tests/         testy (NIEZAPISYWALNE dla agenta)
tools/gate.ts       bramka jakości (NIEZAPISYWALNA dla agenta)
agent/src/          pętla: routing → spec → applier/patch → bramka → git
```

## Bramka

`npm run gate` — kolejność etapów jest celowa, od najtańszego do najdroższego:

1. **treść** (~10 ms) — schematy + spójność: referencje, duplikaty, acykliczność
   receptur, osiągalność progresji, pokrycie przestrzeni biomów, granice ekonomii
2. **typy** (~1 s) — `tsc --noEmit` dla obu projektów
3. **testy** (~1,5 s) — determinizm, inwarianty, fuzz, progresja na wielu seedach
4. **symulacja** (~0,1 s) — raport metryk: ile ticków do kamieni milowych

Fail-fast: model dostaje komunikat o wiszącej referencji po 50 ms, a nie po czterech
sekundach testów. To skraca pętlę poprawek.

## Przy zmianie schematu treści

Granice liczbowe w `schema.ts` nie są kosmetyką — uniemożliwiają modelowi
„naprawienie" nieprzechodzącego testu przez wyprodukowanie godmode'owego przedmiotu.
Rozluźniasz je tylko świadomie. Po każdej zmianie schematu sprawdź, czy testy
negatywne w `game/tests/content.test.ts` nadal łapią psucie — one testują bramkę,
nie treść.

## Konwencje

- Komentarze po polsku, tylko tam, gdzie tłumaczą nieoczywiste ograniczenie.
  Nie komentujemy tego, co kod i tak mówi.
- Bez domyślnych eksportów. Typy jawne na granicach modułów.
- Commity: `feat(tresc):` dla zmian danych, `feat(rdzen):` dla kodu gry.
