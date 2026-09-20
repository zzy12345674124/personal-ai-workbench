# 007 工作台素材库（2026-08-06 验收）

> 来源：GreenSock CodePen 教学 demo；本地化后浏览器目测验收通过（用户），备用作未来「工作台」项目素材。

## 素材清单

| 组件 | CodePen 原链接 | 用途 | 本地化状态 |
| --- | --- | --- | --- |
| `radial-menu/` | [gbwvbgQ](https://codepen.io/GreenSock/pen/gbwvbgQ) | FAB 放射菜单：点击后菜单项弹性扇形展开（`elastic.out(1,0.5)`），easeReverse/ease 类型/速度可调 | ✅ 无外链，可直接复用；**参数化已标准化**（2026-08-08）；**demo.mp4 演示视频**（录制器产物） |
| `menu-navigation-pattern/` | [JoRMPLg](https://codepen.io/GreenSock/pen/JoRMPLg) | 浮岛式全屏导航：per-tween 独立进出曲线（岛 `back.out(2)` 展开 / `power2.out` 收回），链接错峰浮现 | ⚠️ logo 为本地占位 SVG，正式使用需替换；**参数化已标准化**（2026-08-08）；**demo.mp4 演示视频**（录制器产物） |
| `scrambletext-demo/` | CodePen 教学 demo（2026-08-08 归位入库） | 乱码文字效果（**ScrambleTextPlugin 原版 demo**，点击「Next」切换英文文案）：008 工作台欢迎界面的乱码能力由此演化。根 `index.html` 为预览入口（引用 dist/ 本体；gsap/插件本地化，原 CodePen 主题外链不可达已用 `local-patch.css` 补齐） | ✅ 自包含（src/ 源 + dist/ 构建产物 + 根入口本地化） |
| `scramble-text/` | 008 工作台开发（2026-08-08） | **参数化乱码文字**（素材库「支持 URL 参数」标准首个素材）：读 `text/speed/repeat/size/color/bg` 六个 URL 参数；工作台素材预览器「参数调节」面板可直接调参。自播放 + 循环 | ✅ 自包含（gsap 本地化） |

## 参数化标准（2026-08-08 全素材落地）

> 素材预览器「参数调节」面板 = 把 key=value 拼进 iframe URL，素材 HTML 用 `URLSearchParams` 读取生效。全部素材已标准化（不传参时行为与原版一致）。
> **2026-08-08 第三档：面板按 schema 渲染表单**——素材目录可放 `params.json` 声明参数（`{params:[{key,label,type,default,desc,min,max,step}]}`，type 支持 text/number/bool/color），面板自动渲染中文标签表单，无需手填变量名；未声明 schema 的素材回退自由 key=value 模式。**新素材标准：读 URL 参数 + 附 params.json**。

**通用三件套**（每个素材都支持）：

| 参数 | 作用 |
|---|---|
| `speed` | 动画时长倍率：1=原速，0.5=快一倍，2=慢一倍（0.1~5） |
| `accent` | 主题强调色（hex，如 `#ff6b6b`），覆盖 `--color-shockingly-green` |
| `auto` | 加载后自动演示一轮开合动画（`true`/`1`；`false`/`0` 关闭）——预览器调参立即可见 |

**各素材特有参数**：

| 素材 | 特有参数 |
|---|---|
| `radial-menu/` | `radius`=展开半径px（60~400，默认120）、`title`=标题文字 |
| `menu-navigation-pattern/` | `width`=展开宽度px（200~800，默认 min(90vw,400)）、`links`=菜单项文字（逗号分隔，按顺序覆盖，保留序号） |
| `scramble-text/` | `text`=内容、`speed`、`repeat`=循环、`size`=字号、`color`=文字色、`bg`=背景色 |

## 素材录制器（2026-08-08，渲染链路 B 方案）

- 素材目录的 `demo.mp4` 由 `project_008_个人工作台/scripts/record-asset.mjs` 录制（headless Chrome + CDP 截帧 + ffmpeg 合成，零依赖）。
- 用法：`node scripts/record-asset.mjs <素材名> [--duration 7] [--fps 10] [--speed 0.25] [--size 640x360]`——`--speed` 把素材动画调慢覆盖录制窗口（headless 截帧慢，动画会一闪而过），产物 `demo.mp4` 落到素材目录（素材自包含）。
- 工作台素材预览器卡片「▶ 演示」按钮播放 demo.mp4；视频作为素材「视频化形态」供渲染链路引用（006 侧集成待做）。

## 素材库规则（2026-08-08 用户决策：单一事实源）

- **素材本体只在素材库**——项目引用一律直读本目录（如 008 素材预览器 `VIBE_ASSETS_DIR`），或按需打包进运行目录（如 006 渲染时复制 + 补丁）；**任何地方不长期保存素材副本**（008 `web/vendor/` 的 menu-nav/radial-menu 死副本已于 2026-08-08 清理）。
- **素材自包含**：每个素材目录自带依赖（如 `gsap.min.js`），保证 iframe 预览/拖拽/渲染时单目录即完整；不抽公共依赖到库根（72KB 重复是解耦保险）。
- **修改素材本体 = 存版本补丁**：008 素材编辑器只读不改源文件，改动存 `project_008_个人工作台/asset-versions/<素材名>/`（JSON 补丁，非副本）。
- **效果进 006 视频**：翻译为 Remotion 组件（重写，非复制）——见「用途提示」。

## 本地化处理记录

- **GSAP 3.13**：`gsap.min.js` 已下载到各组件目录（原为 CodePen 设置面板注入）。
- **字体**：PPMori / Fraktion Mono 原为 codepen 图床外链（不可达），本地预览回退系统字体（Segoe UI / Consolas）；正式使用可重新引入。
- **noise 纹理**（radial-menu 背景）：外链 404 静默降级。
- **CSS 变量**：两个 `style.css` 末尾追加「本地预览补丁」，补齐 CodePen 设置面板注入的 `--color-*` 变量（值按原主题推断）。
- **logo**：`assets/flair-logo.svg` 为占位（绿色圆角星标），替换真图后删除占位。

## 用途提示

- 这两个是**事件驱动交互组件**（点击/Esc/焦点），适合工作台 UI（快捷操作入口、导航），**不适合直接进 006 视频管线**（006 为帧驱动渲染，未登记进 `portable-manifest.json`）。
- 若需效果进 006 视频：把动画翻译为 Remotion `spring()` 帧驱动组件（重写，非复制）。
