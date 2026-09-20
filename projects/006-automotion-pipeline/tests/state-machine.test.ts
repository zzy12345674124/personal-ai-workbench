import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canTransition, PIPELINE_STAGES, StateMachine } from '../src/state/state-machine.js';

const dirs: string[] = [];

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'automotion-state-'));
  dirs.push(dir);
  return join(dir, 'state.json');
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('canTransition', () => {
  it('allows forward transitions along the pipeline', () => {
    expect(canTransition('init', 'research')).toBe(true);
    expect(canTransition('research', 'codex_draft')).toBe(true);
    expect(canTransition('codex_draft', 'flash_challenge')).toBe(true);
    expect(canTransition('flash_challenge', 'codex_verdict')).toBe(true);
    expect(canTransition('codex_verdict', 'user_confirmation')).toBe(true);
    expect(canTransition('user_confirmation', 'production')).toBe(true);
    expect(canTransition('production', 'visual_review')).toBe(true);
    expect(canTransition('visual_review', 'done')).toBe(true);
  });

  it('rejects skipped forward jumps', () => {
    expect(canTransition('init', 'codex_draft')).toBe(false);
    expect(canTransition('research', 'flash_challenge')).toBe(false);
    expect(canTransition('codex_verdict', 'production')).toBe(false);
  });

  it('rejects transitions out of done', () => {
    expect(canTransition('done', 'research')).toBe(false);
  });

  it('allows rollback to any earlier stage (resume / retry)', () => {
    expect(canTransition('visual_review', 'flash_challenge')).toBe(true);
    expect(canTransition('user_confirmation', 'codex_draft')).toBe(true);
  });

  it('covers every stage in the transition map', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(canTransition(stage, stage)).toBe(false);
    }
  });
});

describe('StateMachine', () => {
  it('starts at init when no state file exists', () => {
    const sm = new StateMachine(tempStatePath());
    expect(sm.readStage()).toBe('init');
  });

  it('persists transitions across instances', () => {
    const path = tempStatePath();
    const sm = new StateMachine(path);
    expect(sm.transition('research')).toBe(true);
    expect(new StateMachine(path).readStage()).toBe('research');
  });

  it('rejects illegal forward jumps without writing state', () => {
    const path = tempStatePath();
    const sm = new StateMachine(path);
    expect(sm.transition('codex_draft')).toBe(false);
    expect(sm.readStage()).toBe('init');
  });

  it('rolls back to an earlier stage', () => {
    const path = tempStatePath();
    const sm = new StateMachine(path);
    sm.transition('research');
    sm.transition('codex_draft');
    expect(sm.transition('init')).toBe(true);
    expect(sm.readStage()).toBe('init');
  });

  it('falls back to init on a corrupted state file', () => {
    const path = tempStatePath();
    writeFileSync(path, 'corrupted!!!', 'utf8');
    expect(new StateMachine(path).readStage()).toBe('init');
  });
});
