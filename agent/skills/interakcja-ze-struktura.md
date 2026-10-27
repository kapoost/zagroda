---
id: interakcja-ze-struktura
name: Interakcja z postawioną strukturą
when: Zmiana dotyczy tego, co się dzieje, gdy gracz użyje czegoś, co sam postawił — schowka, stanowiska, posłania, ogniska.
files: game/src/core/tick.ts, game/src/core/types.ts
---
Acting on a tile is handled in `tick()` under `input.act`. It looks up the entity in
front of the player and branches on its kind: a resource is harvested, an NPC is talked
to, and a placed structure currently only logs its name. That last branch is where
structure interactions belong.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- Branch on properties read from the registry (`station`, `storage`, `blocks`), never on
  a hardcoded structure id. An id in the core is a bug waiting for the next content change.
- Placed structures carry an optional `storage` record on the entity. Use it rather than
  adding a parallel structure.
- If the feature needs a property the structure schema does not have, say so in a
  comment. You cannot change the schema.

INVARIANTS YOU MUST NOT BREAK
- Items never appear or disappear: anything taken out of storage must leave storage.
- The inventory never holds a zero or negative count.
- `tick()` stays a pure function of (state, input, registry).

The player should notice: {{EFEKT_PL}}
