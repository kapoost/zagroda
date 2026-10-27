---
id: ruch-gracza
name: Ruch gracza i przechodniość terenu
when: Zmiana dotyczy poruszania się — co blokuje przejście, jak szybko gracz idzie, czy teren albo struktury wpływają na ruch.
files: game/src/core/tick.ts, game/src/core/types.ts, game/src/core/world.ts
---
Movement is one tile per tick. `tick()` reads `input.move`, sets the facing, and moves
the player when `walkable()` allows it. `walkable()` combines two things: the biome's
`walkable` flag and whether an entity on that tile blocks passage.

TASK: {{MECHANIZM_EN}}

HOW TO DO IT
- Anything that slows movement needs a counter in `state`, because a tick is the
  smallest unit of time there is. Add a field to the `Player` interface in `types.ts`
  and include it in the state hash only if it is part of the simulation, not of rendering.
- Biome and structure properties come from content JSON validated by a schema you
  cannot change. Read them through the registry, never hardcode an id.
- Facing must keep working independently of movement: `input.face` turns without moving,
  and that is what tools act on.

INVARIANTS YOU MUST NOT BREAK
- The player can never stand on a non-walkable tile, under any input sequence.
- The player's position stays within [0, size) on both axes.
- `tick()` stays a pure function of (state, input, registry).

The player should notice: {{EFEKT_PL}}
