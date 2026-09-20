import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { SceneBackground, StaggerIn } from './shared';

/** VS Code Dark+ 配色 */
const VS = {
  bg: '#1E1E1E',
  sidebar: '#252526',
  activity: '#333333',
  accent: '#007ACC',
  text: '#D4D4D4',
  keyword: '#569CD6',
  string: '#CE9178',
  comment: '#6A9955',
  fn: '#DCDCAA',
  type: '#4EC9B0',
  number: '#B5CEA8',
};

export interface IdeSceneSpec {
  title: string;
  fileTree: string[];
  code: { text: string; kind?: 'comment' | 'keyword' | 'string' | 'fn' | 'type' | 'number' }[][];
  terminal: string[];
  gitCommits: { msg: string; branch?: string; current?: boolean }[];
  tab?: string;
}

/** 单行代码：简单语法着色 */
const CodeLine: React.FC<{ tokens: IdeSceneSpec['code'][number]; active: boolean }> = ({ tokens, active }) => (
  <div style={{ display: 'flex', gap: 6, fontFamily: 'Consolas, "Courier New", monospace', fontSize: 30, lineHeight: 1.7 }}>
    {tokens.map((t, i) => (
      <span key={i} style={{ color: t.kind ? VS[t.kind] : VS.text }}>
        {t.text}
      </span>
    ))}
    {active ? <span style={{ color: VS.text, animation: 'none', opacity: 1 }}>▍</span> : null}
  </div>
);

export const IdeScene: React.FC<{ spec: IdeSceneSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  // 代码逐行出现（每行错峰 3 帧）
  const visibleLines = Math.min(spec.code.length, Math.floor((frame - 10) / 3) + 1);
  const terminalVisible = Math.min(spec.terminal.length, Math.floor((frame - 40) / 6) + 1);
  const gitVisible = Math.min(spec.gitCommits.length, Math.floor((frame - 25) / 5) + 1);

  return (
    <SceneBackground theme="tech">
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: VS.bg }}>
        {/* 顶部标题栏 */}
        <div style={{ height: 64, background: VS.activity, display: 'flex', alignItems: 'center', padding: '0 30px', gap: 18 }}>
          <span style={{ color: '#fff', fontSize: 30, fontWeight: 700 }}>{spec.title}</span>
          <span style={{ color: '#888', fontSize: 24 }}>— VibeCoding with Git</span>
        </div>
        {/* 中部：活动栏 + 侧边栏 + 编辑区 */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* 活动栏 */}
          <div style={{ width: 76, background: VS.activity, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 20, gap: 22 }}>
            {['📁', '🔍', '🔀', '🏃', '🧩'].map((ic, i) => (
              <div key={i} style={{ fontSize: 38, opacity: i === 0 ? 1 : 0.5, borderLeft: i === 0 ? `4px solid ${VS.accent}` : '4px solid transparent', paddingLeft: 8 }}>{ic}</div>
            ))}
          </div>
          {/* 侧边栏：文件树 */}
          <div style={{ width: 330, background: VS.sidebar, padding: '24px 18px', overflow: 'hidden' }}>
            <div style={{ color: '#bbb', fontSize: 26, fontWeight: 700, marginBottom: 14 }}>EXPLORER</div>
            {spec.fileTree.map((f, i) => (
              <StaggerIn key={i} delay={i * 3}>
                <div style={{ color: i === spec.fileTree.length - 1 ? '#fff' : '#a8a8a8', fontSize: 27, padding: '7px 0 7px 10px', fontFamily: 'Consolas, monospace', background: i === spec.fileTree.length - 1 ? 'rgba(0,122,204,0.25)' : 'transparent' }}>{f}</div>
              </StaggerIn>
            ))}
            {/* Git 提交节点 */}
            <div style={{ marginTop: 30, color: '#bbb', fontSize: 26, fontWeight: 700, marginBottom: 14 }}>GIT GRAPH</div>
            {spec.gitCommits.slice(0, gitVisible).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', fontSize: 25 }}>
                <span style={{ color: c.current ? VS.string : c.branch ? '#4EC9B0' : '#888' }}>{c.current ? '◉' : '●'}</span>
                <span style={{ color: c.current ? '#fff' : '#bbb' }}>{c.msg}</span>
              </div>
            ))}
          </div>
          {/* 编辑区 */}
          <div style={{ flex: 1, background: VS.bg, padding: '26px 24px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <div style={{ background: VS.accent, color: '#fff', fontSize: 25, padding: '8px 20px', borderRadius: '8px 8px 0 0' }}>{spec.tab ?? spec.title}</div>
            </div>
            {spec.code.slice(0, visibleLines).map((line, i) => (
              <div key={i} style={{ display: 'flex', gap: 18 }}>
                <span style={{ color: '#5a5a5a', fontFamily: 'Consolas, monospace', fontSize: 30, width: 40, textAlign: 'right', userSelect: 'none' }}>{i + 1}</span>
                <CodeLine tokens={line} active={i === visibleLines - 1 && frame % 40 < 25} />
              </div>
            ))}
          </div>
        </div>
        {/* 底部终端 */}
        <div style={{ height: 190, background: '#181818', borderTop: '1px solid #333', padding: '18px 26px', overflow: 'hidden' }}>
          <div style={{ color: '#888', fontSize: 24, marginBottom: 8 }}>TERMINAL</div>
          {spec.terminal.slice(0, terminalVisible).map((l, i) => (
            <div key={i} style={{ fontFamily: 'Consolas, monospace', fontSize: 27, color: i === spec.terminal.length - 1 && i === terminalVisible - 1 ? '#fff' : '#c8c8c8' }}>
              {l}
            </div>
          ))}
          <div style={{ fontFamily: 'Consolas, monospace', fontSize: 27, color: '#fff' }}>▌</div>
        </div>
      </div>
    </SceneBackground>
  );
};

/** 演示用的真实项目代码（MyVideo 场景渲染片段） */
export const DEMO_IDE_SPEC: IdeSceneSpec = {
  title: 'AutoMotion — vibe + git',
  tab: 'MyVideo.tsx',
  fileTree: ['▾ video/src', '  ▸ components/', '  ▾ data/', '    scenes.ts', '  MyVideo.tsx', '  Root.tsx'],
  code: [
    [{ text: '// 场景渲染：拆子目标、每步存档（vibe + git）', kind: 'comment' }],
    [{ text: 'export const MyVideo', kind: 'keyword' }, { text: ': ' }, { text: 'React.FC', kind: 'type' }, { text: ' = () => {' }],
    [{ text: '  const scenes = ' }, { text: 'compileScenes', kind: 'fn' }, { text: '(SCENE_SPECS, timeline);' }],
    [{ text: '  return (' }],
    [{ text: '    <div ' }, { text: 'style', kind: 'fn' }, { text: "={{ background: " }, { text: "'#0B0C15'", kind: 'string' }, { text: ' }}>' }],
    [{ text: '      {scenes.map((s) => (' }],
    [{ text: '        <' }, { text: 'Sequence', kind: 'type' }, { text: ' from={s.fromFrame}>' }],
    [{ text: '          <' }, { text: 'SceneView', kind: 'type' }, { text: ' scene={s} />' }],
    [{ text: '        </' }, { text: 'Sequence', kind: 'type' }, { text: '>' }],
    [{ text: '      ))}' }],
    [{ text: '    </div>' }],
    [{ text: '  );' }],
    [{ text: '};' }],
  ],
  terminal: ['$ npm run build', '$ npx remotion render rag-video final.mp4', '✓ Encoded 2666/2666', '✓ final.mp4 9.3 MB'],
  gitCommits: [
    { msg: 'feat: 三段视觉主题换肤', branch: 'main' },
    { msg: 'fix: 音频相对帧对齐', branch: 'main' },
    { msg: 'feat: 文本链路端到端', branch: 'main' },
    { msg: 'init: 第 0 轮预检', branch: 'main', current: false },
    { msg: '当前提交', current: true },
  ],
};
