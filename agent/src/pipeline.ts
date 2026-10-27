import { CFG } from './config.js';
import { record, type JournalEntry } from './journal.js';
import { apiReady } from './providers/anthropic.js';
import { requireModel } from './providers/ollama.js';
import { applyOps } from './stages/applyData.js';
import { patchWithApi, patchWithCoder, type CodeTask } from './stages/applyCode.js';
import { gateFeedback, gateSummary, runGate, type GateResult } from './stages/gate.js';
import { feedbackAsercji, sprawdzAsercje } from './stages/intencja.js';
import * as git from './stages/git.js';
import { proposeOps, routeRequest, widenCollections, type StageAttempt } from './stages/intent.js';
import { FALLBACK_FILES, findSkill, genericBrief, renderBrief } from './skills.js';

/**
 * Pętla: opis → spec → zmiana → bramka → repozytorium.
 *
 * Drabina eskalacji jest celowo płaska i deterministyczna. Nie prosimy modelu, by
 * "był agentem" — orkiestracja jest tutaj, w kodzie, a model dostaje wąskie, walidowalne
 * zadania. To jedyny sposób, żeby model ogólny mógł rozwijać grę i jej nie zepsuć.
 */

export interface RunOptions {
  prompt: string;
  dryRun?: boolean;
  noMerge?: boolean;
  forceKind?: 'dane' | 'kod';
  log?: (msg: string) => void;
}

export interface RunResult {
  outcome: JournalEntry['outcome'];
  title?: string;
  branch?: string;
  commit?: string;
  changes: string[];
  gate?: GateResult;
  resolvedBy?: JournalEntry['resolvedBy'];
  note?: string;
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 16);

export async function run(opts: RunOptions): Promise<RunResult> {
  const say = opts.log ?? (() => {});
  const attempts: StageAttempt[] = [];
  let resolvedBy: JournalEntry['resolvedBy'] = null;
  const journal = (outcome: JournalEntry['outcome'], extra: Partial<JournalEntry> = {}) =>
    record({ at: new Date().toISOString(), prompt: opts.prompt, attempts, resolvedBy, outcome, ...extra });

  // --- przygotowanie -------------------------------------------------------
  await requireModel(CFG.models.pl);
  if (!git.isClean()) {
    throw new Error('drzewo robocze nie jest czyste — zacommituj lub odrzuć zmiany przed uruchomieniem agenta');
  }
  const startedOn = git.currentBranch();
  if (startedOn !== 'main') say(`uwaga: start z gałęzi "${startedOn}", nie z main`);

  // --- faza 1: klasyfikacja ------------------------------------------------
  say('klasyfikuję zmianę (Bielik)…');
  const routed = await routeRequest(opts.prompt);
  attempts.push(...routed.attempts);
  const route = routed.route;
  if (opts.forceKind) route.kind = opts.forceKind;
  say(`→ ${route.kind.toUpperCase()}: ${route.title}`);
  say(`   ${route.summary_pl}`);
  if (route.kind === 'dane') say(`   kolekcje: ${route.collections.join(', ') || '(brak — przyjmuję items)'}`);
  if (route.checks.length) say(`   warunki: ${route.checks.join(' · ')}`);
  else if (route.kind === 'dane') say('   warunki: brak — ta zmiana nie trafi na main bez Twojego spojrzenia');

  if (opts.dryRun) {
    const cols = widenCollections(route.collections);
    if (route.kind === 'dane') say(`   po dopełnieniu zależności: ${cols.join(', ')}`);
    journal('dry', { kind: route.kind, title: route.title });
    return { outcome: 'dry', title: route.title, changes: [], note: 'dry-run: nic nie zapisano' };
  }

  if (route.kind === 'kod' && !(await coderAvailable())) {
    throw new Error(
      `Zmiana wymaga patcha kodu, a modelu "${CFG.models.code}" nie ma w Ollamie.\nPobierz: ollama pull ${CFG.models.code}`,
    );
  }

  // --- faza 2: gałąź -------------------------------------------------------
  const branch = git.startBranch(route.title);
  say(`gałąź: ${branch}`);

  try {
    const result =
      route.kind === 'dane'
        ? await runDataChange(route, opts, attempts, say)
        : await runCodeChange(route, opts, attempts, say);
    resolvedBy = result.resolvedBy;

    if (!result.gate.ok) {
      say(`bramka czerwona po wszystkich próbach (etap: ${result.gate.failed}) — porzucam gałąź`);
      git.abandonBranch(branch, startedOn);
      
      journal('abandoned', {
        kind: route.kind,
        title: route.title,
        branch,
        gate: { ok: false, failed: result.gate.failed },
      });
      return {
        outcome: 'abandoned',
        title: route.title,
        branch,
        changes: result.changes,
        gate: result.gate,
        resolvedBy,
        note: `bramka nie przeszła etapu "${result.gate.failed}"`,
      };
    }

    // --- faza 3: commit --------------------------------------------------
    const commit = git.commitAll(
      {
        kind: route.kind,
        title: route.title,
        summary: route.summary_pl,
        changes: result.changes,
        resolvedBy: resolvedBy ?? 'nieznany',
        metrics: result.gate.metrics,
      },
      now(),
    );
    say(`commit ${commit} · ${gateSummary(result.gate)}`);

    // --- faza 4: hybrydowa autonomia -------------------------------------
    //
    // Auto-merge nie jest prawem zmiany danych, tylko nagrodą za sprawdzalną obietnicę.
    // Zmiana bez ani jednego warunku intencji przeszła wyłącznie kontrolę spójności —
    // a to za mało, żeby wejść na main bez czyjegokolwiek spojrzenia. Tak właśnie wszedł
    // młot słabszy od kilofa: bramka zielona, obietnica żadna.
    const obiecana = result.asercji > 0;
    const autoMerge = route.kind === 'dane' && CFG.autoMergeData && !opts.noMerge && obiecana;
    if (route.kind === 'dane' && !obiecana) {
      say('brak warunków intencji — zmiana idzie na gałąź, nie na main');
    }
    if (autoMerge) {
      git.mergeToMain(branch, route.title);
      say(`scalone do main (${result.asercji} warunków intencji spełnionych, bramka zielona)`);
      journal('merged', { kind: route.kind, title: route.title, branch, gate: { ok: true, failed: null } });
      return { outcome: 'merged', title: route.title, branch, commit, changes: result.changes, gate: result.gate, resolvedBy };
    }

    let note = `gałąź ${branch} czeka na Twoją akceptację: git diff ${startedOn}..${branch}`;
    if (git.hasRemote() && git.pushBranch(branch)) {
      // PR musi powstać PRZED powrotem na gałąź startową: `gh pr create` bierze gałąź
      // źródłową z HEAD, a z main do main nie da się otworzyć pull requesta.
      const url = git.openPr(route.title, [route.summary_pl, '', ...result.changes.map((c) => `- ${c}`)].join('\n'));
      if (url) note = `PR otwarty: ${url}`;
      else note = `gałąź wypchnięta; PR otwórz ręcznie: gh pr create`;
    }
    // Dopiero teraz wracamy: inaczej kolejny przebieg zaczyna na gałęzi poprzedniego
    // i buduje na zmianie, której nikt jeszcze nie zaakceptował.
    git.checkout(startedOn);
    say(note);
    journal('branch', { kind: route.kind, title: route.title, branch, gate: { ok: true, failed: null } });
    return { outcome: 'branch', title: route.title, branch, commit, changes: result.changes, gate: result.gate, resolvedBy, note };
  } catch (e) {
    const { deleted } = git.abandonBranch(branch, startedOn);
    if (!deleted) say(`gałąź ${branch} ma już commit i zostaje — obejrzyj ją zanim skasujesz`);
    journal('error', { kind: route.kind, title: route.title, branch, error: String(e).slice(0, 500) });
    throw e;
  }
}

async function coderAvailable(): Promise<boolean> {
  try {
    await requireModel(CFG.models.code);
    return true;
  } catch {
    return false;
  }
}

interface StepResult {
  gate: GateResult;
  changes: string[];
  resolvedBy: JournalEntry['resolvedBy'];
  /** Ile warunków intencji udało się sprawdzić. Zero znaczy: nikt tej zmiany nie obiecał. */
  asercji: number;
}

/** Ścieżka danych: spec → deterministyczny applier → bramka → feedback. */
async function runDataChange(
  route: Awaited<ReturnType<typeof routeRequest>>['route'],
  opts: RunOptions,
  attempts: StageAttempt[],
  say: (m: string) => void,
): Promise<StepResult> {
  let feedback: string[] = [];
  let last: GateResult | null = null;
  let changes: string[] = [];
  let resolvedBy: JournalEntry['resolvedBy'] = null;
  const rounds = 3;

  for (let round = 1; round <= rounds; round++) {
    const preferApi = round === rounds && apiReady() && round > 1;
    say(`runda ${round}/${rounds}: proponuję zmiany treści${preferApi ? ' (eskalacja do API)' : ''}…`);
    const proposal = await proposeOps(route, opts.prompt, feedback, preferApi);
    attempts.push(...proposal.attempts);
    resolvedBy = proposal.resolvedBy === 'api' ? 'api' : 'bielik';

    const applied = applyOps(proposal.ops);
    if (!applied.ok) {
      say(`applier odrzucił spec: ${applied.errors.join('; ')}`);
      attempts.push({ stage: 'applier', model: '-', ok: false, note: applied.errors.join('; ').slice(0, 200) });
      feedback = applied.errors;
      git.revertWorktree();
      continue;
    }
    changes = applied.changes;
    say(`zastosowano: ${applied.changes.join(' | ')}`);

    say('uruchamiam bramkę…');
    last = runGate();
    attempts.push({ stage: 'bramka', model: '-', ok: last.ok, note: last.failed ?? undefined });

    if (last.ok) {
      // Bramka dowiodła spójności. Teraz pytanie, czy to jest TA zmiana, o którą proszono.
      const wyniki = sprawdzAsercje(route.checks);
      const zle = feedbackAsercji(wyniki);
      attempts.push({
        stage: 'intencja',
        model: '-',
        ok: zle.length === 0,
        note: wyniki.length ? wyniki.map((w) => `${w.ok ? '✓' : '✗'} ${w.asercja}`).join(' | ') : 'brak warunków',
      });
      if (!zle.length) {
        for (const w of wyniki) say(`   ✓ ${w.asercja}`);
        return { gate: last, changes, resolvedBy, asercji: wyniki.length };
      }
      say(`warunki intencji niespełnione: ${zle.join('; ')}`);
      feedback = zle;
      if (round < rounds) git.revertWorktree();
      continue;
    }

    say(`bramka czerwona na etapie "${last.failed}"`);
    feedback = gateFeedback(last);
    if (round < rounds) git.revertWorktree();
  }
  return { gate: last ?? { ok: false, failed: 'brak-propozycji', stages: [] }, changes, resolvedBy, asercji: 0 };
}

/** Ścieżka kodu: Qwen-Coder → bramka → feedback → eskalacja do API. */
async function runCodeChange(
  route: Awaited<ReturnType<typeof routeRequest>>['route'],
  _opts: RunOptions,
  attempts: StageAttempt[],
  say: (m: string) => void,
): Promise<StepResult> {
  const slots = { mechanizmEn: route.code_request_en || route.summary_pl, efektPl: route.observable_pl || route.summary_pl };
  const skill = route.skill_id === 'brak' ? null : findSkill(route.skill_id);
  const task: CodeTask = skill
    ? { brief: renderBrief(skill, slots), files: skill.files }
    : { brief: genericBrief(slots), files: FALLBACK_FILES };
  say(
    skill
      ? `skill: ${skill.name} (${skill.files.length} plików kontekstu)`
      : 'brak pasującego skilla — brief ogólny, pełny kontekst rdzenia',
  );
  let feedback: string[] = [];
  let last: GateResult | null = null;
  let changes: string[] = [];
  let resolvedBy: JournalEntry['resolvedBy'] = null;

  const ladder: Array<{ label: string; run: () => Promise<{ written: string[]; model: string }>; who: 'coder' | 'api' }> = [
    ...Array.from({ length: CFG.attempts.code }, (_, i) => ({
      label: `coder ${i + 1}/${CFG.attempts.code}`,
      run: () => patchWithCoder(task, feedback),
      who: 'coder' as const,
    })),
    ...(apiReady()
      ? Array.from({ length: CFG.attempts.api }, (_, i) => ({
          label: `API ${i + 1}/${CFG.attempts.api}`,
          run: () => patchWithApi(task, feedback),
          who: 'api' as const,
        }))
      : []),
  ];

  for (const step of ladder) {
    say(`${step.label}: generuję patch…`);
    try {
      const patch = await step.run();
      attempts.push({ stage: 'patch-kodu', model: patch.model, ok: true, note: patch.written.join(', ') });
      changes = patch.written.map((p) => `~ kod: ${p}`);
      resolvedBy = step.who;
      say(`zapisano: ${patch.written.join(', ')}`);
    } catch (e) {
      attempts.push({ stage: 'patch-kodu', model: step.label, ok: false, note: String(e).slice(0, 200) });
      say(`nieudane: ${String(e).slice(0, 160)}`);
      git.revertWorktree();
      continue;
    }

    say('uruchamiam bramkę…');
    last = runGate();
    attempts.push({ stage: 'bramka', model: '-', ok: last.ok, note: last.failed ?? undefined });
    // Zmiana kodu i tak idzie przez PR, więc warunków intencji tu nie liczymy.
    if (last.ok) return { gate: last, changes, resolvedBy, asercji: 0 };

    say(`bramka czerwona na etapie "${last.failed}"`);
    feedback = gateFeedback(last);
    git.revertWorktree();
  }
  return { gate: last ?? { ok: false, failed: 'brak-patcha', stages: [] }, changes, resolvedBy, asercji: 0 };
}
