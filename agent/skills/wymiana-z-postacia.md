---
id: wymiana-z-postacia
name: Wymiana z postacią
when: Zmiana dotyczy handlu, wymiany, cen albo tego, co postacie dają graczowi i za ile — kto z kim handluje, kiedy wymiana jest możliwa, co wolno przyjąć jako zapłatę.
files: game/src/core/tick.ts, game/src/core/types.ts, game/src/core/wymiana.ts
---
Characters barter with the player. The exchange rate lives in `game/src/core/wymiana.ts`:
`oferty(state, reg, npcId)` returns every trade that character can make right now, with
the quantity computed from item values. `doRozmowa()` in `tick.ts` applies a trade only
if it appears in that list. The input carries `{ npc, daj, za }` and deliberately carries
NO quantity — the engine recomputes it, so a forged rate cannot exist.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- `wymiana.ts` is on the write-deny list. READ it to understand the rate, but make your
  change in `tick.ts` (when a trade happens, what it logs) or in the content JSON
  (`npcs.json` → `gives`, which items a character may hand over).
- If the change really needs a different rate, STOP and say so in your summary instead
  of editing `wymiana.ts`. The rate is an economic boundary, not a gameplay knob; a human
  changes it deliberately.
- Call `oferty()` or `dozwolona()` — never re-derive a price inline. One function must
  stay the single source of the rate, because the same list is also shown to the model
  that speaks for the character.
- Keep `doRozmowa()` validating adjacency and the character's `gives` list. It is reached
  over the network, so it must not trust its input.

INVARIANTS YOU MUST NOT BREAK
- A trade never increases the total value of the player's inventory. `game/tests/` fuzzes
  this with random exchange inputs.
- Tools and placeables are never accepted as payment.
- A free gift happens only when the player has nothing to pay with; otherwise every
  handover costs something.
- `tick()` stays a pure function of (state, input, registry). No clock, no randomness
  outside `Rng`, no network.

The player should notice: {{EFEKT_PL}}
