---
id: zachowanie-surowca
name: Zachowanie surowców przy zbieraniu
when: Zmiana dotyczy tego, jak zachowują się surowce — ile wypada, jak szybko odrastają, ile uderzeń trzeba, jak wpływa na to narzędzie albo warunki.
files: game/src/core/tick.ts, game/src/core/types.ts
---
Gathering lives in `harvest()` in `tick.ts`. It checks the held tool against the
resource's required tool, charges energy through `spend()`, subtracts tool power from
the node's hp, and on depletion rolls the drops and schedules regrowth.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- Drop rolls and any other randomness must use the `rng` instance passed into
  `harvest()`. Introducing a new random source breaks determinism and the state-hash test.
- Regrowth is driven by `e.respawnAt`: 0 means alive, a positive tick means scheduled,
  -1 means gone for good. Keep that convention.
- Resource properties (hp, drops, regrow, required tool) live in content JSON and are
  validated by a schema you cannot change. If the feature needs a new per-resource
  field, say so in a comment instead of inventing one.

INVARIANTS YOU MUST NOT BREAK
- Drop quantities stay positive integers; the inventory never holds a zero or negative count.
- A depleted node is removed from the tile index (`entAt`) before regrowth is scheduled.
- `tick()` stays a pure function of (state, input, registry).

The player should notice: {{EFEKT_PL}}
