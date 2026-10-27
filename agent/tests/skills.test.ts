import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config.js';
import { findSkill, genericBrief, loadSkills, renderBrief, skillMenu } from '../src/skills.js';

/**
 * Skille są wiedzą pisaną ręcznie — jeśli któryś się rozjedzie, Bielik dostanie
 * do wyboru pozycję, której nie da się wyrenderować, i zmiana padnie bez powodu.
 */
describe('skille briefowania kodera', () => {
  const skills = loadSkills();

  it('wczytuje wszystkie pliki skilli', () => {
    expect(skills.length).toBeGreaterThanOrEqual(5);
  });

  it.each(skills.map((s) => [s.id, s] as const))('%s ma komplet pól', (_id, skill) => {
    expect(skill.name.length).toBeGreaterThan(3);
    expect(skill.when.length).toBeGreaterThan(20);
    expect(skill.files.length).toBeGreaterThan(0);
    expect(skill.template.length).toBeGreaterThan(100);
  });

  it.each(skills.map((s) => [s.id, s] as const))('%s wskazuje istniejące pliki', (_id, skill) => {
    for (const f of skill.files) {
      expect(existsSync(resolve(ROOT, f)), `${skill.id}: nie ma pliku ${f}`).toBe(true);
    }
  });

  it.each(skills.map((s) => [s.id, s] as const))('%s ma oba sloty i wypisuje inwarianty', (_id, skill) => {
    expect(skill.template).toContain('{{MECHANIZM_EN}}');
    expect(skill.template).toContain('{{EFEKT_PL}}');
    expect(skill.template).toContain('INVARIANTS YOU MUST NOT BREAK');
  });

  it('identyfikatory są unikalne', () => {
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
  });

  it('renderuje brief bez pozostawionych slotów', () => {
    const out = renderBrief(findSkill('koszt-akcji')!, {
      mechanizmEn: 'Night gathering costs twice as much energy.',
      efektPl: 'Nocą zbieranie szybciej wyczerpuje siły.',
    });
    expect(out).not.toContain('{{');
    expect(out).toContain('Night gathering costs twice as much energy.');
    expect(out).toContain('Nocą zbieranie szybciej wyczerpuje siły.');
  });

  it('brief awaryjny też niesie inwarianty', () => {
    const out = genericBrief({ mechanizmEn: 'Do a thing.', efektPl: 'Coś się dzieje.' });
    expect(out).toContain('INVARIANTS YOU MUST NOT BREAK');
    expect(out).toContain('pure function');
  });

  it('menu wymienia każdy skill z opisem', () => {
    const menu = skillMenu(skills);
    for (const s of skills) expect(menu).toContain(s.id);
  });

  it('nieznany identyfikator nie wysadza systemu', () => {
    expect(findSkill('nie-ma-takiego')).toBeNull();
  });
});
