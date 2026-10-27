---
id: koszt-akcji
name: Koszt czynności gracza
when: Zmiana dotyczy tego, ile sił kosztuje jakaś czynność, albo tego, że koszt ma zależeć od warunków — pory doby, stanu gracza, miejsca, użytego narzędzia.
files: game/src/core/tick.ts, game/src/core/types.ts
---
Every player action that consumes energy goes through the `spend()` helper in `tick.ts`.
It currently charges a flat `config.energyPerAction` and refuses the action when the
player cannot pay.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- Change `spend()` so the charged amount is computed, not constant. Keep its contract:
  it returns `false` and logs a message when the player cannot pay, and it must not
  charge anything in that case.
- Conditions that depend on the clock must read the helpers exported from `tick.ts`,
  never a wall clock. For day/night use `isNight(state, reg)` — do NOT invent your own
  threshold on `timeOfDay`, the game already decided where night begins.
- Multipliers belong at the TOP OF THE FILE as module-level `const` declarations,
  next to ENERGY_REGEN_EVERY. Not inside the function, not as literals at the use site.

INVARIANTS YOU MUST NOT BREAK
- Energy never goes below zero and never exceeds `config.energyMax`.
- The cost must stay at least 1 whenever `energyPerAction` is at least 1, otherwise
  actions become free and the progression bot loops forever.
- `tick()` stays a pure function of (state, input, registry).

The player should notice: {{EFEKT_PL}}
