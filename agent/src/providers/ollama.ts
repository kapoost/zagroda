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
  /** Który budżet kontekstu zastosować — polski czy koderski. */
  ctx?: 'pl' | 'code';
}

/** Ile sekund zajęło ostatnie wywołanie — do logów, bo przy modelu 11B to jedyna metryka, która boli. */
export let lastCallSeconds = 0;
/** Długość ostatniej odpowiedzi w znakach — do oceny, czy model gadał, czy pracował. */
export let lastTokens = 0;

export async function ollamaChat(req: ChatRequest): Promise<string> {
  try {
    return await chatOnce(req);
  } catch (e) {
    // Przejściowy błąd połączenia zdarza się, gdy Ollama akurat przeładowuje model.
    if (!String(e).includes('fetch failed')) throw e;
    await new Promise((r) => setTimeout(r, 4000));
    return chatOnce(req);
  }
}

/**
 * Strumieniowanie jest tu wymogiem, nie optymalizacją.
 *
 * Node ma w undici sztywny limit 300 s na nagłówki odpowiedzi. Przy stream:false Ollama
 * nie odsyła nic, dopóki nie skończy generować, więc każda odpowiedź dłuższa niż pięć
 * minut ginie z "fetch failed" — a własny AbortController nigdy nie dostaje szansy.
 * Przy strumieniu nagłówki przychodzą natychmiast i limit czasu znów jest nasz.
 */
async function chatOnce(req: ChatRequest): Promise<string> {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CFG.timeoutMs[req.ctx ?? 'pl']);
  try {
    const res = await fetch(`${CFG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model: req.model,
        stream: true,
        ...(req.schema ? { format: req.schema } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        options: {
          temperature: req.temperature ?? 0.2,
          num_ctx: CFG.numCtx[req.ctx ?? 'pl'],
          ...(req.numPredict ? { num_predict: req.numPredict } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (!res.body) throw new Error('Ollama nie zwróciła strumienia');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
        text += chunk.message?.content ?? '';
      }
    }
    if (!text.trim()) throw new Error('Ollama zwróciła pustą odpowiedź');
    lastTokens = text.length;
    return text;
  } finally {
    clearTimeout(t);
    lastCallSeconds = Math.round((Date.now() - started) / 1000);
  }
}

/**
 * Zwolnienie modelu z pamięci.
 *
 * Na maszynie z 24 GB Bielik zajmuje 10 GB, a Qwen 11 GB. Przy przejściu z fazy
 * polskiej do koderskiej Ollama próbuje załadować drugi, zanim pierwszy opuści pamięć,
 * i połączenie pada z "fetch failed". Jawne zwolnienie przed przełączeniem jest tańsze
 * niż zgadywanie, czy tym razem się zmieści.
 */
export async function unloadModel(model: string): Promise<void> {
  try {
    await fetch(`${CFG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch {
    /* zwolnienie jest optymalizacją, nie warunkiem powodzenia */
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
