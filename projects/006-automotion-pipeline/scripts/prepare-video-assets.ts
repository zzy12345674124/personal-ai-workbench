/**
 * 视频资产准备：tsx scripts/prepare-video-assets.ts <runDir>
 * 1) 用字幕时间轴编译场景（帧区间）→ 生成 video/src/generated/data.ts
 * 2) 复制逐句音频到 video/public/audio/
 * 之后用 npx remotion render 渲染。
 *
 * 任务书 §6：runDir 是 006 内层 canonical 运行目录；模板配置按固定优先级读取
 * （内层 template-config.json → 外层 008 快照 → 默认值），任一候选文件损坏/不合规必须失败并指出路径。
 * 导出纯函数供 tests/template-config.test.ts 测试；导入本模块不执行主流程。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSceneSpecsFromStoryboard, compileScenes, SCENE_SPECS, type SceneSpec } from '../video/src/data/scenes.js';
import { DEFAULT_TEMPLATE_CONFIG, normalizeTemplateConfig, type TemplateConfigV3 } from '../video/src/template-config.js';

/** 模板配置读取优先级（任务书 §6）：内层 → 外层（008 快照）→ 默认值。
 *  任一候选文件存在但 JSON 损坏或合同无效 → 抛错并指出文件路径，禁止静默回退。 */
export function resolveTemplateConfig(runDir: string): TemplateConfigV3 {
  const candidates = [join(runDir, 'template-config.json'), join(dirname(runDir), 'template-config.json')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`TEMPLATE_CONFIG_INVALID: ${file}（JSON 解析失败：${(error as Error).message}）`);
    }
    try {
      return normalizeTemplateConfig(parsed);
    } catch {
      throw new Error(`TEMPLATE_CONFIG_INVALID: ${file}（合同校验失败）`);
    }
  }
  return DEFAULT_TEMPLATE_CONFIG;
}

/** 生成 data.ts 末尾的模板配置导出；JSON.stringify 生成安全字面量（标题含引号不破坏 TypeScript） */
export function templateConfigLiteral(config: TemplateConfigV3): string {
  return `export const templateConfig = ${JSON.stringify(config, null, 2)} as const;`;
}

export function main(): void {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('usage: tsx scripts/prepare-video-assets.ts <runDir>');
    process.exit(1);
  }

  const projectRoot = process.cwd();
  const subtitles = JSON.parse(
    readFileSync(join(runDir, 'subtitles.json'), 'utf8'),
  ) as { timeline: { index: number; startSeconds: number; endSeconds: number; text: string }[]; totalSeconds: number };

  const fps = 30;
  // 2026-08-06 修复：场景内容优先来自裁决分镜的结构化字段（此前静态 SCENE_SPECS 导致所有视频画面雷同）
  let sceneSpecs: SceneSpec[] = SCENE_SPECS;
  const finalScriptFile = join(runDir, 'final_script.json');
  if (existsSync(finalScriptFile)) {
    try {
      const verdict = JSON.parse(readFileSync(finalScriptFile, 'utf8')) as { storyboard?: unknown };
      const built = buildSceneSpecsFromStoryboard(verdict.storyboard as Array<Record<string, unknown>> | undefined);
      if (built) {
        sceneSpecs = built;
        console.log(`[scenes] 使用裁决分镜结构化内容（${built.length} 镜）`);
      } else {
        console.warn('[scenes] 裁决分镜缺少结构化 type 字段，回退静态 SCENE_SPECS（画面内容将不随主题变化）');
      }
    } catch (e) {
      console.warn(`[scenes] final_script.json 读取失败，回退静态 SCENE_SPECS：${(e as Error).message}`);
    }
  }
  // 2026-08-08 多模态第二阶段：从 008 场景草稿（scene-draft.json）按分镜 index 确定性注入 media。
  // 不依赖 LLM 在 storyboard 里自觉复述 media 字段：sceneDraft[i] 对应分镜 index=i+1（008 场景槽顺序）；
  // 镜数少于槽数时多余 media 丢弃；仅透传 kind=video 的条目（demo.mp4 随后复制到 staticFile 目录）。
  // 兼容内外层：008 bridge 提交时 scene-draft.json 落在外层 runs/<runId>/（此时内层尚不存在），
  // 但 confirm 的规范目录是内层 run-<006id>/（resolveRunDir）——本目录读不到时回退父目录。
  let sceneDraftFile = join(runDir, 'scene-draft.json');
  if (!existsSync(sceneDraftFile)) {
    const outer = join(dirname(runDir), 'scene-draft.json');
    if (existsSync(outer)) sceneDraftFile = outer;
  }
  if (existsSync(sceneDraftFile)) {
    try {
      const draft = JSON.parse(readFileSync(sceneDraftFile, 'utf8')) as Array<{ media?: Array<{ kind: string; src?: string }> }>;
      if (Array.isArray(draft)) {
        let injected = 0;
        for (const spec of sceneSpecs) {
          const slot = draft[spec.index - 1];
          const videos = slot?.media?.filter((m) => m.kind === 'video' && typeof m.src === 'string' && m.src) ?? [];
          if (videos.length) {
            (spec as SceneSpec & { media?: unknown[] }).media = videos.map((m) => ({ kind: 'video', src: m.src }));
            injected++;
          }
        }
        if (injected) console.log(`[scenes] 场景草稿 media 注入：${injected} 镜带素材视频`);
      }
    } catch (e) {
      console.warn(`[scenes] scene-draft.json 读取失败，跳过 media 注入：${(e as Error).message}`);
    }
  }
  const scenes = compileScenes(sceneSpecs, subtitles.timeline, fps);

  // 任务书 §6：读取模板配置快照（内层 → 外层 → 默认）；损坏/不合规直接失败（含文件路径）
  let templateConfig: TemplateConfigV3;
  try {
    templateConfig = resolveTemplateConfig(runDir);
    console.log(`[template-config] 使用 ${templateConfig === DEFAULT_TEMPLATE_CONFIG ? '正式默认值' : '运行快照'}：${templateConfig.workspaceTitle}`);
  } catch (e) {
    console.error(`[template-config] ${(e as Error).message}`);
    process.exit(1);
  }

  const audioDir = join(runDir, 'audio');
  const wavFiles = readdirSync(audioDir)
    .filter((f) => f.endsWith('.wav'))
    .sort();
  // 音频按场景序号一一对应；播放位置由场景 Sequence 承载（相对帧对齐）
  const audio = wavFiles.map((f) => ({ src: f }));

  const totalFrames = Math.round(subtitles.totalSeconds * fps);

  // 生成 video/src/generated/data.ts（构建时数据，不入 Git）
  const generatedDir = resolve(projectRoot, 'video', 'src', 'generated');
  mkdirSync(generatedDir, { recursive: true });
  const dataTs = [
    '// AUTO-GENERATED by scripts/prepare-video-assets.ts — do not edit',
    `export const totalFrames = ${totalFrames};`,
    `export const scenes = ${JSON.stringify(scenes, null, 2)} as const;`,
    `export const subtitles = ${JSON.stringify(subtitles.timeline, null, 2)} as const;`,
    `export const audio = ${JSON.stringify(audio, null, 2)} as const;`,
    templateConfigLiteral(templateConfig),
    '',
  ].join('\n');
  writeFileSync(join(generatedDir, 'data.ts'), dataTs, 'utf8');

  // 复制音频到项目根 public/audio/（Remotion staticFile 默认目录）
  const publicAudioDir = resolve(projectRoot, 'public', 'audio');
  mkdirSync(publicAudioDir, { recursive: true });
  for (const f of wavFiles) {
    copyFileSync(join(audioDir, f), join(publicAudioDir, f));
  }

  // 2026-08-08 多模态第二阶段：复制素材演示视频（素材库 <素材名>/demo.mp4）到 Remotion staticFile 目录。
  // 注意：Remotion 项目根 = 006 根（remotion.config.ts 在此），staticFile 目录 = 006根/public/
  // （音频复制同此目录）；video/public/ 是另一套（录屏用），复制错位置渲染时 404。
  const materialsDir = resolve(projectRoot, 'public', 'materials');
  mkdirSync(materialsDir, { recursive: true });
  const vibeAssetsDir = resolve(projectRoot, '..', 'project_007_VibeMotion联动', '工作台素材');
  for (const spec of sceneSpecs) {
    for (const m of spec.media ?? []) {
      if (m.kind !== 'video' || !m.src) continue;
      const srcFile = join(vibeAssetsDir, m.src, 'demo.mp4');
      if (!existsSync(srcFile)) { console.warn(`[materials] 素材「${m.src}」无 demo.mp4，跳过`); continue; }
      copyFileSync(srcFile, join(materialsDir, `${m.src}.mp4`));
      console.log(`[materials] ${m.src}.mp4 已复制（渲染引用 staticFile materials/${m.src}.mp4）`);
    }
  }

  console.log(
    JSON.stringify(
      { scenes: scenes.length, audio: audio.length, totalFrames, generated: 'video/src/generated/data.ts' },
      null,
      2,
    ),
  );
}

// 仅作为脚本直接运行时执行主流程；测试导入本模块（resolveTemplateConfig/templateConfigLiteral）时不执行。
// resolve 规范化 argv[1]（生产调用传相对路径 scripts/…，cwd=006 根），与 import.meta.url 对齐比较
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
