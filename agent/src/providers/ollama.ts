import { CFG } from '../config.js';

/** Klient Ollamy. Strukturalne wyjście idzie przez pole `format` — to ono wymusza gramatykę JSON. */

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  /** JSON Schema; Ollama ogranicza dekodowanie do pasujących tokenów. */
  schema?: Record<string, unknown>;
  temperature?: number;
  numPredict?: number;
}

export async function ollamaChat(req: ChatRequest): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(`${CFG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: req.model,
        stream: false,
        ...(req.schema ? { format: req.schema } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        options: {
          temperature: req.temperature ?? 0.2,
          num_ctx: CFG.numCtx,
          ...(req.numPredict ? { num_predict: req.numPredict } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content ?? '';
    if (!text.trim()) throw new Error('Ollama zwróciła pustą odpowiedź');
    return text;
  } finally {
    clearTimeout(t);
  }
}

export async function ollamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${CFG.ollamaUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function requireModel(name: string): Promise<void> {
  const have = await ollamaModels();
  if (!have.length) throw new Error(`Ollama nie odpowiada pod ${CFG.ollamaUrl}`);
  const base = (s: string) => s.replace(/:latest$/, '');
  if (!have.some((m) => base(m) === base(name))) {
    throw new Error(`Brak modelu "${name}" w Ollamie. Pobierz: ollama pull ${name}`);
  }
}
