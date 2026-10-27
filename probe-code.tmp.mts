import { readFileSync, existsSync } from 'node:fs';
import { ollamaChat, unloadModel } from './agent/src/providers/ollama.ts';
import { CFG, WRITE_ALLOW } from './agent/src/config.ts';

const files = ['game/src/core/types.ts','game/src/core/tick.ts','game/src/core/world.ts','game/src/core/game.ts','game/src/core/rng.ts','game/src/content/schema.ts']
  .filter(existsSync).map((p) => `--- ${p} ---\n${readFileSync(p,'utf8')}`).join('\n\n');

const SYSTEM = readFileSync('agent/src/stages/applyCode.ts','utf8')
  .split('const CODE_SYSTEM = `')[1].split('`;')[0]
  .replace('${WRITE_ALLOW.join(\'\\n\')}', WRITE_ALLOW.join('\n'));

const t0 = Date.now();
await unloadModel(CFG.models.pl);
const raw = await ollamaChat({
  model: CFG.models.code,
  system: SYSTEM,
  user: `CURRENT CODE:\n\n${files}\n\nTASK:\nGathering resources at night must cost twice as much energy as during the day.`,
  temperature: 0.1,
  numPredict: 4000,
  ctx: 'code',
});
console.log(`=== ${Math.round((Date.now()-t0)/1000)}s, ${raw.length} znaków ===`);
console.log(raw.slice(0, 2500));
