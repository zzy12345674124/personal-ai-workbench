import React from 'react';
import { useCurrentFrame } from 'remotion';
import { scenes } from '../generated/data';
import { DEFAULT_TEMPLATE_CONFIG } from '../template-config';

/** VS Code Dark+ 配色 */
const VS = {
  bg: '#1E1E1E',
  sidebar: '#252526',
  activity: '#333333',
  accent: '#007ACC',
  text: '#D4D4D4',
  string: '#CE9178',
  green: '#4EC9B0',
  muted: '#888888',
};

/** 每镜的 IDE 元信息：文件标签、侧边栏高亮、终端输出、Git 提交 */
interface IdeMeta {
  tab: string;
  fileHighlight: number; // 文件树高亮行索引
  terminal: string[];
  git: { msg: string; branch?: string }[];
}

const FILE_TREE = [
  '▾ automotion/',
  '  ▸ components/',
  '  ▾ data/',
  '    scenes.ts',
  '  MyVideo.tsx',
  '  Root.tsx',
  '  task.json',
  '  subtitles.srt',
  '  final.mp4',
];

const IDE_META: IdeMeta[] = [
  { tab: 'task.json', fileHighlight: 6, terminal: ['$ automotion "什么是RAG？"', '✓ 运行目录已创建'], git: [{ msg: 'init: 第 0 轮预检', branch: 'main' }] },
  { tab: 'draft.tsx', fileHighlight: 3, terminal: ['$ codex exec --output-schema draft.schema.json', '✓ 草稿 11 句 · 6 来源'], git: [{ msg: 'init: 第 0 轮预检' }, { msg: 'feat: Codex 草稿+联网研究' }] },
  { tab: 'cards.tsx', fileHighlight: 1, terminal: ['$ npm run build', '✓ 三张能力卡片组件'], git: [{ msg: 'init: 第 0 轮预检' }, { msg: 'feat: Codex 草稿' }, { msg: 'feat: 组件主题化' }] },
  { tab: 'decision.tsx', fileHighlight: 1, terminal: ['$ git checkout -b decision-tree', '✓ 决策树场景'], git: [{ msg: 'feat: 组件主题化' }, { msg: 'feat: 决策树分支', branch: 'feature/decision' }] },
  { tab: 'contrast.tsx', fileHighlight: 1, terminal: ['$ git checkout main', '✓ 合并 feature/decision'], git: [{ msg: 'feat: 组件主题化' }, { msg: 'feat: 决策树分支', branch: 'feature/decision' }, { msg: 'merge: 决策树 → main' }] },
  { tab: 'checklist.tsx', fileHighlight: 1, terminal: ['$ git commit -m "feat: 四场景判断卡"', '✓ 已存档'], git: [{ msg: 'feat: 组件主题化' }, { msg: 'feat: 决策树分支' }, { msg: 'merge: 决策树' }, { msg: 'feat: 场景判断卡' }] },
  { tab: 'flow.tsx', fileHighlight: 1, terminal: ['$ git commit -m "feat: 按需取片段流程"', '✓ 上下文已清空'], git: [{ msg: 'feat: 组件主题化' }, { msg: 'feat: 决策树分支' }, { msg: 'merge: 决策树' }, { msg: 'feat: 场景判断卡' }, { msg: 'feat: 流程组件' }] },
  { tab: 'warning.tsx', fileHighlight: 1, terminal: ['$ git reset --hard HEAD~1', '→ 回退存档点，优化提示词'], git: [{ msg: 'feat: 流程组件' }, { msg: 'fix: 警示场景重做' }] },
  { tab: 'warning.tsx', fileHighlight: 1, terminal: ['$ git commit -m "fix: 检索出错演示"', '✓ BOSS 战通关'], git: [{ msg: 'feat: 流程组件' }, { msg: 'fix: 警示场景重做' }, { msg: 'fix: 检索出错演示' }] },
  { tab: 'metrics.tsx', fileHighlight: 1, terminal: ['$ npx remotion still --frame=2189', '✓ 评测面板 8-10 分'], git: [{ msg: 'fix: 检索出错演示' }, { msg: 'feat: 评测三仪表' }] },
  { tab: 'conclusion.tsx', fileHighlight: 4, terminal: ['$ npx remotion render rag-video final.mp4', '✓ Encoded 2666/2666 · 9.3 MB'], git: [{ msg: 'feat: 评测三仪表' }, { msg: 'feat: 结论阶梯' }, { msg: 'v1.0.0: 首条视频' }] },
];

export interface IdeFrameProps {
  children: React.ReactNode;
  workspaceTitle?: string;
  accentColor?: string;
  workspaceTitleSize?: number;
}

/** 整片 VS Code 框架：场景内容渲染在编辑区，文件/Git/终端随场景推进。
 *  三个外壳参数默认值必须来自 DEFAULT_TEMPLATE_CONFIG（任务书 §3）；正式视频不传时保持原样。 */
export const IdeFrame: React.FC<IdeFrameProps> = ({
  children,
  workspaceTitle = DEFAULT_TEMPLATE_CONFIG.workspaceTitle,
  accentColor = DEFAULT_TEMPLATE_CONFIG.accentColor,
  workspaceTitleSize = DEFAULT_TEMPLATE_CONFIG.workspaceTitleSize,
}) => {
  const frame = useCurrentFrame();
  const idx = Math.max(0, [...scenes].reverse().findIndex((s) => frame >= s.fromFrame));
  const sceneIdx = scenes.length - 1 - idx;
  const meta = IDE_META[Math.min(sceneIdx, IDE_META.length - 1)] ?? IDE_META[0]!;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: VS.bg, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, "Microsoft YaHei", sans-serif' }}>
      {/* 顶部标题栏 */}
      <div style={{ height: 62, background: VS.activity, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{ width: 18, height: 18, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div style={{ color: VS.muted, fontSize: workspaceTitleSize, fontWeight: 700 }}>{workspaceTitle}</div>
        {/* 文件标签 */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 40 }}>
          <div style={{ background: VS.bg, color: '#fff', fontSize: 25, padding: '8px 22px', borderRadius: '8px 8px 0 0', borderTop: `3px solid ${accentColor}` }}>{meta.tab}</div>
        </div>
      </div>
      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 活动栏 */}
        <div style={{ width: 72, background: VS.activity, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 18, gap: 20 }}>
          {['📁', '🔍', '🔀', '🏃', '🧩'].map((ic, i) => (
            <div key={i} style={{ fontSize: 36, opacity: i === 2 ? 1 : 0.5, borderLeft: i === 2 ? `4px solid ${accentColor}` : '4px solid transparent', paddingLeft: 8 }}>{ic}</div>
          ))}
        </div>
        {/* 侧边栏：文件树 + Git（2026-08-07 视觉迭代：260→235 微降密度，缓解重心左偏） */}
        <div style={{ width: 235, background: VS.sidebar, padding: '20px 14px', overflow: 'hidden' }}>
          <div style={{ color: '#bbb', fontSize: 24, fontWeight: 700, marginBottom: 10 }}>EXPLORER</div>
          {FILE_TREE.map((f, i) => (
            <div key={i} style={{ color: i === meta.fileHighlight ? '#fff' : '#a8a8a8', fontSize: 25, padding: '6px 0 6px 10px', fontFamily: 'Consolas, monospace', background: i === meta.fileHighlight ? `${accentColor}33` : 'transparent' }}>{f}</div>
          ))}
          <div style={{ color: '#bbb', fontSize: 24, fontWeight: 700, margin: '22px 0 10px' }}>GIT GRAPH</div>
          {meta.git.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 23 }}>
              <span style={{ color: c.branch ? VS.green : VS.string }}>{c.branch ? '◈' : '●'}</span>
              <span style={{ color: c.branch ? VS.green : '#ccc' }}>{c.msg}</span>
            </div>
          ))}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 23, color: '#fff' }}>
            <span style={{ color: VS.string }}>◉</span> 当前提交
          </div>
        </div>
        {/* 编辑区：场景内容缩放入内（2026-08-07 视觉迭代：scale 0.69→0.72、144.9%→138.9%，
            内容更大更满，缓解「大面积空白/重心偏左」） */}
        <div style={{ flex: 1, background: VS.bg, position: 'relative', overflow: 'hidden' }}>
          <div style={{ transform: 'scale(0.72)', transformOrigin: 'top left', width: '138.9%', height: '138.9%' }}>{children}</div>
        </div>
      </div>
      {/* 底部终端 */}
      <div style={{ height: 150, background: '#181818', borderTop: '1px solid #333', padding: '12px 22px', overflow: 'hidden' }}>
        <div style={{ color: VS.muted, fontSize: 22, marginBottom: 6 }}>TERMINAL</div>
        {meta.terminal.map((l, i) => (
          <div key={i} style={{ fontFamily: 'Consolas, monospace', fontSize: 25, color: i === 0 ? '#c8c8c8' : '#fff' }}>{l}</div>
        ))}
        <div style={{ fontFamily: 'Consolas, monospace', fontSize: 25, color: '#fff' }}>▌</div>
      </div>
    </div>
  );
};
