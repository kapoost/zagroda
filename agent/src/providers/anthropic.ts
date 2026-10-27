import Anthropic from '@anthropic-ai/sdk';
import { CFG } from '../config.js';

/**
 * Eskalacja do API. Świadomie BEZ structured outputs: strict JSON Schema wymaga, by każde
 * pole było wymagane, a nasze schematy treści mają mnóstwo pól opcjonalnych. Prompt + walidacja
 * Zodem po stronie klienta daje ten sam efekt bez przerabiania schematów pod dwa dialekty.
 *
 * Strumieniowanie jest zawsze włączone — przy dużym max_tokens zapytanie bez streamu
 * wpada w timeout HTTP.
 */

let client: Anthropic | null = null;

export function apiReady(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function get(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function apiComplete(system: string, user: string, maxTokens = 32_000): Promise<string> {
  const stream = get().messages.stream({
    model: CFG.models.api,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error('API odmówiło odpowiedzi na to zapytanie');
  }
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error('API zwróciło pustą odpowiedź');
  return text;
}
