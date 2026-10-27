import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

/** Zarządzanie repozytorium. Agent nigdy nie pracuje na main — zawsze na gałęzi. */

function git(args: string[], allowFail = false): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} → ${r.status}\n${r.stderr ?? ''}`);
  }
  return `${r.stdout ?? ''}`.trim();
}

export function isClean(): boolean {
  return git(['status', '--porcelain']) === '';
}

export function currentBranch(): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function slugify(title: string): string {
  const map: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return title
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'zmiana';
}

export function startBranch(title: string): string {
  const base = `agent/${slugify(title)}`;
  let name = base;
  let n = 2;
  const existing = git(['branch', '--list', `${base}*`], true);
  while (existing.includes(name)) name = `${base}-${n++}`;
  git(['checkout', '-q', '-b', name]);
  return name;
}

/** Cofnij wszystkie niezacommitowane zmiany w drzewie roboczym. */
export function revertWorktree(): void {
  git(['checkout', '-q', '--', '.'], true);
  git(['clean', '-qfd'], true);
}

export function abandonBranch(branch: string, backTo = 'main'): void {
  git(['checkout', '-q', '--', '.'], true);
  git(['clean', '-qfd'], true);
  git(['checkout', '-q', backTo]);
  git(['branch', '-qD', branch], true);
}

export interface CommitInput {
  kind: 'dane' | 'kod';
  title: string;
  summary: string;
  changes: string[];
  resolvedBy: string;
  metrics?: unknown;
}

export function appendChangelog(input: CommitInput, stamp: string): void {
  const path = resolve(ROOT, 'CHANGELOG.md');
  const header = existsSync(path) ? '' : '# Dziennik zmian\n\nKażdy wpis to jedna zmiana przepuszczona przez bramkę jakości.\n';
  const entry = [
    `\n## ${input.title}`,
    `*${stamp} · ${input.kind} · wykonawca: ${input.resolvedBy}*`,
    '',
    input.summary,
    '',
    ...input.changes.map((c) => `- ${c}`),
    '',
  ].join('\n');
  if (header) writeFileSync(path, header, 'utf8');
  appendFileSync(path, entry, 'utf8');
}

export function commitAll(input: CommitInput, stamp: string): string {
  appendChangelog(input, stamp);
  git(['add', '-A']);
  const type = input.kind === 'dane' ? 'feat(tresc)' : 'feat(rdzen)';
  const body = [input.summary, '', ...input.changes.map((c) => `- ${c}`), '', `Wykonawca: ${input.resolvedBy}`].join('\n');
  git(['commit', '-q', '-m', `${type}: ${input.title}`, '-m', body]);
  return git(['rev-parse', '--short', 'HEAD']);
}

export function checkout(branch: string): void {
  git(['checkout', '-q', branch]);
}

export function mergeToMain(branch: string, title: string): void {
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', branch, '-m', `merge: ${title}`]);
}

export function hasRemote(): boolean {
  return git(['remote'], true).split('\n').filter(Boolean).length > 0;
}

export function pushBranch(branch: string): boolean {
  const r = spawnSync('git', ['push', '-q', '-u', 'origin', branch], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0;
}

export function openPr(title: string, body: string): string | null {
  const r = spawnSync('gh', ['pr', 'create', '--title', title, '--body', body], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return `${r.stdout ?? ''}`.trim();
}

export function readChangedFiles(): string[] {
  return git(['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
}
