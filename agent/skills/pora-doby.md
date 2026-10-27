---
id: pora-doby
name: Wpływ pory doby i upływu czasu
when: Zmiana dotyczy dnia i nocy, upływu czasu, długości doby, regeneracji sił w czasie albo czegokolwiek, co dzieje się „co jakiś czas".
files: game/src/core/tick.ts, game/src/core/types.ts
---
Time is derived from `state.tick`. `timeOfDay(state, reg)` returns 0 at midnight and
0.5 at noon; `dayOf(state, reg)` returns the day number. Periodic effects are applied
at the end of `tick()` using modulo arithmetic on `state.tick` — energy regeneration
is the existing example.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- Derive everything from `state.tick`. Never read a wall clock and never add a separate
  timer field when modulo on the tick counter will do.
- Periodic effects go at the end of `tick()`, after the respawn pass, so one tick never
  applies the same effect twice.
- Thresholds and periods belong at the top of the file as named constants.

INVARIANTS YOU MUST NOT BREAK
- The same seed and the same input sequence must still produce the same state hash.
- Energy stays within [0, config.energyMax].
- `tick()` stays a pure function of (state, input, registry).

The player should notice: {{EFEKT_PL}}
