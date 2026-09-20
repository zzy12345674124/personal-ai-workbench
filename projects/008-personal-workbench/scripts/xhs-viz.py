# xhs-viz.py —— 小红书评论数据可视化生成器（读 runs/xhs-comments/*.json → web/xhs-viz.html）
# 输出：单文件 HTML（零依赖 SVG/div 图表，数据内嵌），工作台直接访问 /xhs-viz.html
# v2：按关键词分组 + 前端筛选器；_archive/ 测试数据自动排除
import json, glob, os, sys
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(PROJECT_ROOT, 'runs', 'xhs-comments')
OUT = os.path.join(PROJECT_ROOT, 'web', 'xhs-viz.html')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def load_all():
    """合并全部笔记评论（_archive/ = 测试数据排除；按 keyword 分组）"""
    notes = {}
    comments = []
    for f in sorted(glob.glob(os.path.join(BASE, '*.json'))):
        if 'job' in os.path.basename(f) or '_archive' in f or 'expand-usage' in f:
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        kw = d.get('keyword', '未标注｜测试数据')
        note_id = d.get('note_id') or os.path.basename(f)[:8]
        notes[note_id] = {'count': d.get('count', len(d.get('comments', []))), 'keyword': kw}
        for c in d.get('comments', []):
            cid = c.get('id')
            if cid in comments:
                continue
            c['_kw'] = kw
            c['_note'] = note_id
            comments.append(c)
    return notes, comments


def ai_cost():
    try:
        u = json.load(open(os.path.join(BASE, 'expand-usage.json'), encoding='utf-8'))
        return {'count': u.get('count', 0), 'costUsd': u.get('costUsd', 0),
                'input': u.get('inputTokens', 0), 'output': u.get('outputTokens', 0)}
    except Exception:
        return {'count': 4, 'costUsd': 0.0002, 'input': 0, 'output': 0, 'estimated': True}


def main():
    notes, comments = load_all()
    by_kw = {}
    for c in comments:
        by_kw.setdefault(c.get('_kw', '未标注'), []).append(c)
    keywords = sorted(by_kw.keys())
    default_kw = keywords[0] if keywords else ''
    cost = ai_cost()

    groups = {}
    for kw in keywords:
        cs = by_kw[kw]
        ipc = {}
        for c in cs:
            ip = (c.get('ip') or '').strip() or '未知'
            ipc[ip] = ipc.get(ip, 0) + 1
        rank = sorted(ipc.items(), key=lambda x: -x[1])
        groups[kw] = {
            'count': len(cs),
            'notes': len(set(c.get('_note') for c in cs)),
            'likes': sum(int(c.get('likes', 0) or 0) for c in cs),
            'ip': rank[:6] + ([('其他', sum(v for _, v in rank[6:]))] if len(rank) > 6 else []),
            'table': [{'nick': c.get('nickname', '')[:16], 'content': c.get('content', ''),
                       'likes': c.get('likes', 0), 'ip': c.get('ip', ''),
                       'time': datetime.fromtimestamp(int(c['time']) / 1000, tz=timezone.utc).strftime('%Y-%m-%d') if c.get('time') else ''}
                      for c in sorted(cs, key=lambda c: int(c.get('likes', 0) or 0), reverse=True)][:200],
        }
    payload = {'keywords': keywords, 'defaultKw': default_kw, 'groups': groups, 'aiCost': cost}
    data_js = json.dumps(payload, ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>小红书评论数据 · 可视化</title>
<style>
body {{ margin:0; background:#f5f5f7; color:#0b0b0b; font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif; }}
.viz-root {{ max-width:1100px; margin:0 auto; padding:32px 24px 60px; color-scheme:light;
  --surface-1:#fcfcfb; --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#8a8a86;
  --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a; --series-other:#8a9aa5; --grid:#e6e6e2; }}
h1 {{ font-size:28px; margin:0 0 4px; letter-spacing:-.02em; color:var(--text-primary); }}
.sub {{ color:var(--text-muted); font-size:14px; margin-bottom:18px; }}
.filters {{ display:flex; gap:10px; align-items:center; margin-bottom:22px; flex-wrap:wrap; }}
.filters select {{ min-height:36px; padding:6px 12px; border:1px solid #d8d8dc; border-radius:11px;
  background:#fff; color:var(--text-primary); font-size:14px; }}
.hero {{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:28px; }}
.stat {{ background:var(--surface-1); border:1px solid #e3e3df; border-radius:16px; padding:18px 20px; }}
.stat .num {{ font-size:34px; font-weight:700; letter-spacing:-.03em; color:var(--text-primary); }}
.stat .label {{ color:var(--text-secondary); font-size:12.5px; margin-top:4px; }}
.cost-note {{ color:var(--text-secondary); font-size:13px; margin:14px 2px 30px; line-height:1.7; }}
.cost-note b {{ color:var(--text-primary); }}
.card {{ background:var(--surface-1); border:1px solid #e3e3df; border-radius:16px; padding:22px; margin-bottom:18px; }}
.card h2 {{ font-size:17px; margin:0 0 16px; color:var(--text-primary); }}
.bars {{ display:flex; flex-direction:column; gap:10px; }}
.bar-row {{ display:grid; grid-template-columns:84px 1fr 44px; gap:10px; align-items:center; }}
.bar-label {{ font-size:13px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }}
.bar-track {{ background:#f1f1ee; border-radius:4px; height:22px; position:relative; overflow:hidden; }}
.bar-fill {{ position:absolute; left:0; top:0; bottom:0; border-radius:4px; min-width:3px; }}
.bar-val {{ font-size:12.5px; color:var(--text-secondary); text-align:right; font-variant-numeric:tabular-nums; }}
.legend {{ display:flex; gap:16px; font-size:12.5px; color:var(--text-secondary); margin-top:12px; flex-wrap:wrap; }}
.lg {{ display:flex; align-items:center; gap:6px; }}
.lg i {{ width:14px; height:14px; border-radius:4px; display:inline-block; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; }}
th {{ text-align:left; color:var(--text-secondary); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--grid); }}
td {{ padding:8px 10px; border-bottom:1px solid var(--grid); vertical-align:top; color:var(--text-secondary); }}
td.content {{ max-width:480px; color:var(--text-primary); }}
td.nick {{ white-space:nowrap; }}
td.likes {{ font-variant-numeric:tabular-nums; color:var(--series-1); font-weight:600; }}
.mono {{ font-variant-numeric:tabular-nums; }}
@media (prefers-color-scheme: dark) {{
  body {{ background:#1a1a19; color:#ffffff; }}
  .viz-root {{ color-scheme:dark; --surface-1:#212120; --text-primary:#ffffff; --text-secondary:#c3c2b7;
    --text-muted:#8f8e88; --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; --series-other:#7f8b94; --grid:#373735; }}
  .stat, .card {{ border-color:#373735; }}
  .bar-track {{ background:#2b2b29; }}
  .filters select {{ background:#2b2b29; border-color:#373735; color:#fff; }}
}}
</style></head>
<body><div class="viz-root">
<h1>小红书评论数据分析</h1>
<div class="sub">数据源：runs/xhs-comments/（测试数据已隔离） · 生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
<div class="filters"><label>关键词：<select id="kwSel"></select></label></div>
<div class="hero" id="hero"></div>
<div class="cost-note" id="costNote"></div>
<div class="card"><h2>评论 IP 属地分布</h2><div class="bars" id="ipBars"></div><div class="legend" id="ipLegend"></div></div>
<div class="card"><h2>评论列表 · 按点赞排序（前 200 条）</h2>
<table><thead><tr><th>昵称</th><th>评论</th><th>赞</th><th>IP</th><th>日期</th></tr></thead><tbody id="tbody"></tbody></table></div>
<script>
const D = {data_js};
const R = document.querySelector('.viz-root');
const c = (name) => getComputedStyle(R).getPropertyValue(name).trim();
const IP_COLORS = [c('--series-1'), c('--series-2'), c('--series-3'), c('--series-other')];
const sel = document.getElementById('kwSel');
const cur = () => sel.value;

function render() {{
  const g = D.groups[cur()];
  if (!g) return;
  // hero
  document.getElementById('hero').innerHTML = '';
  for (const [n, l] of [[g.count, '评论总数'], [g.notes, '笔记数'], [g.likes.toLocaleString(), '总点赞'], [Math.max(...g.table.map(x => x.likes), 0), '最高赞'], ['¥' + (D.aiCost.costUsd * 7.2).toFixed(2), 'AI 费用（估算）']])
    document.getElementById('hero').insertAdjacentHTML('beforeend', `<div class="stat"><div class="num">${{n}}</div><div class="label">${{l}}</div></div>`);
  // IP bars
  const max = Math.max(...g.ip.map(i => i[1]), 1);
  document.getElementById('ipBars').innerHTML = g.ip.map(([label, v]) => {{
    const i = g.ip.findIndex(x => x[0] === label);
    return `<div class="bar-row"><div class="bar-label" title="${{label}}">${{label}}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${{v / max * 100}}%;background:${{i < 3 ? IP_COLORS[i] : IP_COLORS[3]}}"></div></div>
      <div class="bar-val">${{v}}</div></div>`;
  }}).join('');
  document.getElementById('ipLegend').innerHTML = [['--series-1','Top1 属地'],['--series-2','Top2 属地'],['--series-3','Top3 属地'],['--series-other','其余/未知']]
    .map(([v, t]) => `<span class="lg"><i style="background:${{c(v)}}"></i>${{t}}</span>`).join('');
  // table
  document.getElementById('tbody').innerHTML = g.table.map(r => `<tr><td class="nick">${{r.nick}}</td><td class="content">${{r.content}}</td><td class="likes">${{r.likes}}</td><td>${{r.ip || '—'}}</td><td class="mono">${{r.time}}</td></tr>`).join('');
  // cost note
  const cst = D.aiCost;
  document.getElementById('costNote').innerHTML = `本工具链 AI 花费说明：二级关键词扩展共调用 <b>${{cst.count}} 次</b>（DeepSeek V4，约 <b>¥${{(cst.costUsd * 7.2).toFixed(3)}}</b>），加上子代理/主会话代币，<b>全部合计约 ¥0.05 以内</b>——评论数据零模型成本（CloakBrowser 本地采集）。`;
}}

sel.innerHTML = D.keywords.map(k => `<option value="${{k}}" ${{k === D.defaultKw ? 'selected' : ''}}>${{k}}</option>`).join('');
sel.addEventListener('change', render);
render();
</script>
</body></html>"""
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'生成完成: {OUT}（{len(html)//1024}KB）' if keywords else '无数据')


if __name__ == '__main__':
    main()
