import { describe, expect, it } from 'vitest';
import { buildSceneSpecsFromStoryboard, compileScenes } from '../video/src/data/scenes.js';

describe('buildSceneSpecsFromStoryboard', () => {
  it('maps structured storyboard items to scene specs', () => {
    const specs = buildSceneSpecsFromStoryboard([
      { index: 1, visual: 'v1', narration_index: 0, type: 'title', theme: 'tech', title: '刃牙全解析', subtitle: '生来就要弑父' },
      { index: 2, visual: 'v2', narration_index: 1, type: 'cards', theme: 'paper', title: '三个关键点', cards: [{ label: 'a', desc: 'b' }] },
    ]);
    expect(specs).toHaveLength(2);
    expect(specs?.[0]).toMatchObject({ index: 1, type: 'title', title: '刃牙全解析' });
    expect(specs?.[1]).toMatchObject({ type: 'cards', cards: [{ label: 'a', desc: 'b' }] });
  });

  it('skips items without structured type; null when none valid; null on empty input', () => {
    expect(buildSceneSpecsFromStoryboard(null)).toBeNull();
    expect(buildSceneSpecsFromStoryboard([{ index: 1, visual: 'v', narration_index: 0 }])).toBeNull();
    expect(
      buildSceneSpecsFromStoryboard([
        { index: 1, visual: 'v', narration_index: 0, type: 'title', title: 't' },
        { index: 2, visual: 'v2', narration_index: 1 },
      ]),
    ).toHaveLength(1);
  });

  it('透传 media（多模态第二阶段）：合法 kind 保留、非法 kind 过滤、缺字段不补', () => {
    const specs = buildSceneSpecsFromStoryboard([
      {
        index: 1, visual: 'v', narration_index: 0, type: 'title', title: 't',
        media: [
          { kind: 'video', src: 'radial-menu', version: 'v1', note: 'FAB 演示' },
          { kind: 'html' },                 // 合法但无 src → 保留（无 src 字段）
          { kind: 'weird', src: 'x' },      // 非法 kind → 过滤
          null,                              // 非对象 → 过滤
        ],
      },
    ]);
    expect(specs?.[0].media).toEqual([
      { kind: 'video', src: 'radial-menu', version: 'v1', note: 'FAB 演示' },
      { kind: 'html' },
    ]);
  });

  it('shotcraft 类型透传 card 字段（2026-08-11 镜头卡场景）', () => {
    const specs = buildSceneSpecsFromStoryboard([
      { index: 1, visual: 'v', narration_index: 0, type: 'shotcraft', card: 'Fracture' },
      { index: 2, visual: 'v2', narration_index: 1, type: 'shotcraft', card: '' }, // 空 card 也透传（渲染层退回黑场）
    ]);
    expect(specs?.[0]).toMatchObject({ type: 'shotcraft', card: 'Fracture' });
    expect(specs?.[1]).toMatchObject({ type: 'shotcraft', card: '' });
  });

  it('无 media 字段的 storyboard 不产生 media（不补空数组）', () => {
    const specs = buildSceneSpecsFromStoryboard([{ index: 1, visual: 'v', narration_index: 0, type: 'title', title: 't' }]);
    expect(specs?.[0].media).toBeUndefined();
  });

  it('compileScenes maps subtitle timeline to frame ranges', () => {
    const specs = buildSceneSpecsFromStoryboard([{ index: 1, visual: 'v', narration_index: 0, type: 'title', title: 't' }]);
    const compiled = compileScenes(specs!, [{ index: 1, startSeconds: 1, endSeconds: 3, text: 'x' }], 30);
    expect(compiled[0]).toMatchObject({ fromFrame: 30, toFrame: 90 });
  });

  it('normalizes zero-based storyboard indexes to 1-based (subtitle timeline contract)', () => {
    // run-1786099922058 实测：LLM 裁决输出 index 0..9（0 起始），字幕时间轴从 1 起
    const specs = buildSceneSpecsFromStoryboard([
      { index: 0, visual: 'v0', narration_index: 0, type: 'title', theme: 'tech', title: 't0' },
      { index: 1, visual: 'v1', narration_index: 1, type: 'cards', theme: 'paper', title: 't1' },
    ]);
    expect(specs?.map((s) => s.index)).toEqual([1, 2]);
    // 归一化后可与字幕时间轴正常编译（0 起始时 compileScenes 会抛 no subtitle interval）
    const compiled = compileScenes(specs!, [
      { index: 1, startSeconds: 0, endSeconds: 1, text: 'a' },
      { index: 2, startSeconds: 1, endSeconds: 2, text: 'b' },
    ], 30);
    expect(compiled.map((c) => c.index)).toEqual([1, 2]);
  });
});
