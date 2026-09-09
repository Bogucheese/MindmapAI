# MindmapAI 开发日志（M0–M8 与 MVP 后迭代）

> 历史文档：本文是项目逐里程碑的开发记录（2026-09-06 至 2026-09-08），保留当时
> 的行文与细节，供了解设计取舍与踩坑经验。当前的功能介绍与上手方式见根目录
> [README](../README.md)，开发环境与常用命令见 [DEVELOPING](DEVELOPING.md)。
> 源码核对结论见 `docs/VERIFIED.md`。

## 目录结构

- `webapp/` — jgraph/drawio 克隆，开发分支 `ai-mindmap`（基于 v31.4.2）
- `desktop/` — jgraph/drawio-desktop 克隆（Electron 壳，M7 启用）
- `ai/` — 新增 TypeScript 模块（esbuild 打包为 IIFE 插件）

## 开发环境

```bash
# 启动 webapp dev 服务器（8000 端口）
python3 -m http.server 8000 -d webapp/src/main/webapp

# 浏览器访问
#   prod 模式:  http://localhost:8000/
#   dev 模式:   http://localhost:8000/index.html?dev=1
#   指定中文:   http://localhost:8000/?lang=zh

# 构建插件 bundle（ai/ 目录下）
cd ai && npm install && npm run build       # 产物 → webapp/src/main/webapp/js/ai/mindmap-ai.js
npm run typecheck && npm run watch          # 类型检查 / 监听模式
```

注意：修改 `ai/src` 后需重新 `npm run build`；若 bundle 内容有变化，记得同步调高
`bootstrap.js` 两处 `mindmap-ai.js?v=N` 版本号以绕过浏览器启发式缓存。

## 当前进度（M0–M8 全部完成，MVP 达成并产出 Windows 安装包）

- M0 ✅ 源码核对 15 项 → `docs/VERIFIED.md`
- M1 ✅ dev 服务器跑通
- M2 ✅ TS 工具链 + aiHello 插件，浏览器端已验收：
  - 顶部 AI 菜单（Extras 与 Help 之间），prod / dev 两种模式、首次加载与
    语言切换后均位置一致
  - 关键教训：`ui.menus.put` 必须传 `Menu` 实例（裸函数会让菜单栏重建时
    抛 TypeError、排在后面的 Help 消失）；菜单 id 必须有同名资源 key
    （drawio 对缺失 key 的回退是显示 key 本身）；首建菜单栏早于插件注册，
    兜底 `menubar.addMenu` 返回的元素 class 是 `geMenubar`（块级、会溢出
    屏幕），必须改回 `geItem` 并用 `before` 参数插到 Help 前
- M3 ✅ 设置对话框 + 持久化 + i18n + 测试连接：
  - AI → 设置…（中英文）：Base URL / API Key（密码框）/ Model / Temperature
  - 非敏感配置存 `mindmapAI.settings.v1`，key 存 `mindmapAI.secrets.v1`
    （浏览器明文，界面明示未加密；Electron 下拒绝写入，M7 换 safeStorage）
  - 测试连接：浏览器直连 api.deepseek.com（CORS 已实测放行），带 15s 超时
    与 HTTP/网络/超时分类错误显示；dev=1 的 CSP 白名单已加 DeepSeek
  - 资源 key 追加进 `resources/dia.txt` / `dia_zh.txt`；插件侧 EN 兜底改为
    "只补缺失 key"，避免覆盖中文
- M4 ✅ AI 生成链路（纯库 + 测试，UI 在 M6 接入）：
  - `prompts.ts`：system prompt 内嵌 JSON schema 与硬约束（depth/maxChildren/
    maxNodes/输出语言），`npm test` 38 用例覆盖
  - `schema.ts`：修复阶梯（去围栏 → 截取大括号 → JSON.parse → 尾逗号容错 →
    根级数组容错 → 递归清洗 → maxChildren/maxNodes/depth 截断），丢弃计数
  - `client.ts`：共享 chatRequest（超时/错误分类）+ `generateMindmapTree`
    （response_format json_object 被拒时去字段重试；schema 失败带原文重答
    一次；mock server 测试覆盖重试/超时/401/402，真实 key 联调在 M6）
- M5 ✅ 导图构建器 + 放射布局（AI → 示例导图 可直接体验，验收截图
  `docs/m5-demo-mindmap.png`）：
  - `tree-model.ts`：JSON 树 → mxCell，单事务构建（Ctrl+Z 一步全撤）、
    旧图按样式 marker 替换不碰手绘内容、fit 取景、自动选中根节点
  - `node-size.ts`：CJK 感知估宽（根 16/一级 14/更深 12，超宽折行）
  - `styles.ts`：drawio 原生 6 色板循环（一级定色、后代继承），放射布局
    用无箭头曲线边
  - `radial-layout.ts`：LayoutEngine 接口 + mxRadialTreeLayout 包装
    （levelDistance 300 / nodeDistance 120，实测该参数下 31 节点零重叠；
    该布局对节点宽度不敏感、小半径环会被宽标签挤重叠——自定义布局
    算法按接口后续接入）
  - 调试句柄：控制台 `MindmapAI.ui.editor.graph` 可直接检查模型
- M6 ✅ 浏览器端端到端（AI → 生成思维导图…，或空白画布右键）：
  - 生成对话框：主题 / 层级 1-6 / 每层分支 1-10 / 节点上限 5-200 /
    标签语言（自动跟随主题|中文|English）/ 布局（径向|树状）/ 替换开关；
    选项记住上次取值（`mindmapAI.generation.v1`）
  - 错误处理：空主题、参数越界、无 key（附"打开设置"入口）、HTTP 错误
    带服务端原文、超时、网络错误、schema 失败展开原始回复
  - 非替换模式生成在现有图形右侧（tree-model 新增 origin 选项）
  - 右键空白画布追加"生成思维导图"（createPopupMenu 实例级链式覆盖；
    顶点右键不显示——节点扩展属二期）
  - 自测走通本地 mock LLM 全链路：`node ai/dev-mock-server.mjs` 后把
    设置里 Base URL 指向 `http://127.0.0.1:8787` 即可不消耗真实配额联调
- M7 ⬜ Electron 集成（desktop fork 加载我们的 webapp、密钥 safeStorage、
  主进程 fetch 通道）
- M7 ✅ Electron 集成（desktop fork，dev 分支）：
  - `MM_WEBAPP_DIR` 环境变量覆盖加载目录，指向我们的 webapp（未用空的
    drawio submodule）：`MM_WEBAPP_DIR=$PWD/webapp/src/main/webapp npm start`
  - 主进程新增 4 个 IPC case（rendererReq switch，无需改 preload）：
    `mmAiGetSecret` / `mmAiSetSecret` / `mmAiDeleteSecret`（safeStorage 加密，
    落盘 userData/mm-ai-secrets.json；无 keyring 的环境如 WSL 自动降级明文
    并带 encrypted:false 标记）、`mmAiFetch`（主进程 fetch 转发，绕开渲染层
    connect-src 'self'，超时在主进程侧执行）
  - 渲染层：secure-store / client 按 `window.electron` 桥自动切换通道；
    CDP（`--remote-debugging-port=9222`）实测密钥 round-trip 与完整生成流
    （菜单 → 对话框 → mock LLM → 画布 13 顶点）
- M8 ✅ Windows 打包 + MVP 收尾（2026-09-07，tag `mindmap-ai-mvp-0.1`）：  - 新增 `desktop/electron-builder-mindmapai-win.json`（不动上游 win 配置）：
    appId `com.mindmapai.desktop`、productName **MindmapAI**、版本 0.1.0；
    webapp 经 `extraResources` 从 `../webapp/src/main/webapp` 直装
    `resources/webapp`（submodule 未初始化也无妨）；`signExecutable: false`
    跳过签名；desktop/package.json 加 productName（userData 独立为
    `AppData/Roaming/MindmapAI`，不与官方 draw.io 混用）
  - 主进程打包态回退：`codeDir` 在 `app.isPackaged` 时优先用
    `resources/webapp`；`disableUpdate.js` 桩改 true（fork 版本号 0.x 若查
    jgraph 官方源会提示"更新到官方 drawio"，必须禁）
  - 安装包在 **Windows 侧原生构建**（WSL 内 NSIS 卸载器与 MSI/WiX 都依赖
    wine，本机无 sudo 装不了）：`C:\mindmapai-build\` 放便携 node + 仓库
    副本，`build.cmd` 跑 `npm ci && npm run release-mindmapai-win`（npm 与
    Electron 均走 npmmirror）。产物：`MindmapAI-0.1.0-windows-installer.exe`
    (161MB) + `MindmapAI-0.1.0.msi` (164MB)，副本存 `desktop/dist/`
  - 打包版回归（`desktop/scripts/cdp-regression.mjs`，用 Windows 侧 node
    驱动 CDP）：加载 resources/webapp prod 路径（URL 带 disableUpdate=1）、
    AI 菜单在位（Extras 与 Help 之间）、mmAiSet/GetSecret IPC round-trip
    **encrypted:true**、生成对话框 → mock LLM → 画布 13 顶点、优雅重启后
    settings 与 key 均保留；磁盘上 `mm-ai-secrets.json` 为 DPAPI 密文
    （`{"encrypted":true,"apiKey":"djEw…"}`）
  - 遗留（二期/人工）：真实 DeepSeek key 联调、开/存/导出 PNG/PDF/打印的
    人工清单、安装包未签名（SmartScreen 会告警）、应用图标仍为 drawio
    原版（产品名/图标替换留二期）

## 当前进度补充：来源模式 P0+P1+节点扩展+自动参数（2026-09-07）

- ✅ **来源模式管线**（设计见 `docs/design-source-grounded-mindmap.md`）：
  - 新增 `ai/src/agent/`：`types.ts`（SourceDoc/DistilledNote/CritiqueReport）、
    `tools.ts`（粘贴文本 → 按标题/段落分块，预算 12 块）、`skills.ts`
    （distill/architect/critique 三阶段 prompt，system 首行带 `[MM-STAGE:*]`
    供 mock 识别）、`pipeline.ts`（INGEST→DISTILL→ARCHITECT→CRITIQUE→
    RENDER 状态机；评审 rubric 四维度 <70 回炉重构一次；阶段间可取消）
  - `schema.ts`：MindmapTree 节点新增可选 `source.noteIds`（清洗去重）
  - `client.ts`：chatRequest 支持阶段温度覆盖；导出 chatWithJsonFallback
  - 生成对话框：**内容来源**（仅主题 | 粘贴文本）+ 分阶段进度行 +
    生成中禁用/取消（Esc 与取消按钮都会通知管线停止）
  - 溯源展示：引文经 graph 实例级 getTooltipForCell 包装挂到节点悬停
    （不写入模型、不影响布局；保存后失效属 P0 已知限制）
  - dev-mock-server 按阶段脚本化返回（`MM_MOCK_CRITIQUE=revise` 强制回炉）
  - 测试 67 通过（新增 agent.test.ts：分块/管线/回炉/取消/HTTP 集成）；
    bundle v15，浏览器端到端验收通过（粘贴模式 11 节点 + 引文 tooltip、
    主题模式回归 13 节点），截图 `docs/test-ai-mindmap-source-mode.png`
- ✅ **P1 链接取数**（2026-09-07 同日）：
  - `tools.ts`：`githubRawUrl`（blob/raw/仓库根 → raw.githubusercontent.com）、
    `extractReadableText`（DOMParser 轻量正文提取：剪导航/脚本/页头尾、
    标题转 Markdown 标记行喂分块器）、`buildSourceDocFromUrl`（30s 超时，
    http/network/timeout 分类）
  - `client.ts`：传输层泛化 `transportRequest` + 导出 `transportGet`；
    desktop 主进程 `mmAiFetch` 增加 method 透传（默认 POST 不变，GET 供抓取）
  - 对话框来源第三项「链接」：GitHub 链接自动转 raw 直连（CORS 开放，
    浏览器可用）；其余站点浏览器模式受 CORS 限制（失败有明确提示），
    桌面版经主进程通道可抓
  - 测试 75 通过（新增 tools-fetch.test.ts 本地服务器抓取、
    tools-extract.test.ts happy-dom 正文提取）；bundle v17
  - e2e：同源 fixture 页面（`webapp/.../test-article.html`，兼作测试夹具）
    链接模式全链路通过；**GitHub raw 直连在本网络环境连接超时**（错误提示
    正常）——境内网络抓 GitHub 需代理，桌面版同网络同样受限
- ✅ **节点扩展（懒展开，二期"选中节点扩展"首项）**（2026-09-07）：
  - 右键本插件生成的导图顶点 →「扩展节点」：带完整路径/兄弟/已有子节点
    上下文 + 来源要点集（graph.__mmNotesRegistry）生成一层新子节点
  - `agent/expand.ts`：expandNodeChildren（复用 parseMindmapTree 当 depth=2
    小树解析 + 一次重答修复；不做 CRITIQUE，用户可再展开或撤销）
  - `tree-model.ts`：insertChildren（单事务插入 + 按既有边样式识别布局
    种类整图重排；颜色/边样式沿用所在分支；引文 tooltip 从注册表续挂），
    Ctrl+Z 一步撤销整段扩展
  - mock 服务器 [MM-STAGE:expand] 返回固定 3 子项；i18n 四个新 key
  - 测试 81 通过（新增 expand.test.ts）；bundle v18
  - e2e：右键叶子 → 扩展（11→14 节点、3 子项、零重叠、tooltip 续挂）→
    一次撤销回 11 → 重做恢复；截图 `docs/test-ai-mindmap-expand.png`
  - 已知点：右键菜单项文字在浏览器启发式缓存旧资源文件时显示英文兜底，
    新会话即中文
- ✅ **AI 自动结构参数**（2026-09-07）：
  - 生成对话框新增「AI 自动设置最佳层数/分支/上限」勾选（仅来源模式可用，
    勾选后三个手动输入禁用，手动值兜底）；偏好记忆
  - pipeline 新增 AUTO-TUNE 阶段（distill 之后、architect 之前）：按要点
    数量/密度让 LLM 推荐 depth(1-6)/maxChildren(1-10)/maxNodes(8-200)，
    `parseAutotuneChoice` 钳位并校验，畸形回复静默回退手动值（stats.autotune
    为 null）；推荐值同时作用于 CRITIQUE 回炉的重构 prompt
  - 选定参数写入根节点 tooltip（"AI 选定参数: 层级 4 · 每层分支数 ≤6 ·
    节点上限 ≤48 (理由)"），BuildMindmapOptions.rootNote 透传
  - mock 服务器 [MM-STAGE:autotune] 返回固定推荐；测试 85 通过
    （新增 autotune 钳位/兜底/集成用例）；bundle v20
  - e2e：勾选后手动输入禁用 ✓，生成成功且根 tooltip 显示 mock 推荐值
    （层级 4 · ≤6 · ≤48 + 理由）✓，mock 日志确认 distill×4 → autotune →
    architect → critique 完整序列
- ✅ **真实 DeepSeek key 联调**（2026-09-08）：
  - 测试连接通过：请求 deepseek-chat，API 回显实际模型 **deepseek-v4-flash**，
    延迟 746ms
  - 来源模式全流程（4 块 + 自动参数 + 评审）约 60-90s 完成：8 节点结构
    忠实对应来源章节（零编造），AUTO-TUNE 真实推理出「层级 3 · 分支 ≤3 ·
    上限 ≤10」并在理由中说明要点分组依据，8/8 节点带原文引文，零重叠；
    截图 `docs/test-deepseek-source-mode.png`
  - 主题模式单发 6s：中文跟随主题、叶子具体（"徽章"/"忽视新手"级别细节）
  - 节点扩展真实调用：Types 节点下生成 5 个准确类型子节点；36 节点
    两张图并存零重叠；截图 `docs/test-deepseek-final.png`
  - 注意：deepseek-chat 已被服务端路由到 deepseek-v4-flash；浏览器模式
    key 明文存 localStorage（界面已有提示）
- ✅ **溯源持久化**（2026-09-08）：
  - 引文与 AI 参数说明写入单元格值的 Object 节点属性（`mm-quotes`，
    drawio Edit Data 同款机制），随 .drawio 文件保存/重开不丢失
  - tooltip 改为常驻实例级覆盖、直接读值属性（不再依赖内存 Map）；
    `cellLabelText` 兼容字符串值与 Object 值（节点扩展路径/兄弟上下文）
  - 真实 API 实测：XML 编码含 mm-quotes，编解码往返后 label 与引文属性
    完整保留，画布标签渲染正常；测试 93 通过（新增 persist.test.ts）；
    截图 `docs/test-persist-quotes.png`
  - 已知点：Object 值单元格的原生 tooltip 会先渲染属性表（drawio 默认
    行为），其后是格式化引文；要点注册表（扩展 grounding 用）仍为会话内
- ✅ **多厂商模型 + 部件示例图 + tooltip 精简 + 修改入口增强**(2026-09-08):
  - 厂商预设(ai/src/providers.ts,端点参考 cc-switch 的
    codingPlanProviders.ts 与各厂商官方文档):DeepSeek/火山方舟 Coding
    Plan(ark.cn-beijing.volces.com/api/coding/v3)/火山方舟按量/智谱
    GLM/OpenAI/Kimi For Coding(api.kimi.com/coding)/Moonshot/通义千问/
    MiniMax/硅基流动/OpenRouter/Ollama 本地,共 12 家;设置对话框新增
    「厂商预设」下拉,选中自动填充接口地址与默认模型(key 手填)
  - tooltip 精简:接管 Object 值的原生属性表(此前 mm-quotes 属性表 +
    格式化引文重复两份),只展示首条引文(60 字截断)+ 条数提示,完整
    内容右键"编辑数据"查看
  - 「AI 修改此图」入口增强:AI 菜单动态项(有图表槽位记忆时)+ 顶点
    右键入口;槽位记忆持久化到根节点 mm-slots 属性(保存/重开不丢)
  - 「部件示例图」:AI 菜单一键为全部形状部件生成实例图(网格布局,
    每格 = 部件形状示例 + 部件名/用途标注),AI 缺漏部件自动内置兜底
  - 测试 99;bundle v39
- ✅ **图表体验修复与增强**(2026-09-08,用户反馈四项):
  - 修复:切回"思维导图"时层级/分支/布局等行不恢复(可见性切换漏挂
    图表下拉的 change)
  - 方向可选:tree/org/flow 支持「方向」下拉(竖向/横向),组织结构图
    默认横向(惯例),不再强加竖向
  - 部件扩充:泳道/容器(swimlane)、三角形、小人形(umlActor)、便签、
    虚线边;流程图槽位协议支持 lanes 泳道分组与步骤 dashed;
    组织结构图成员绘制为人形、部门为卡片
  - 「AI 修改此图」:图表生成后槽位记忆(graph.__mmChartSlots),右键
    空白画布 → 输入修改指令 → editChart 基于当前槽位增量修改 → 校验
    → 单事务替换重绘(会话内有效,持久化属后续)
  - 真实 DeepSeek e2e:行恢复/方向默认 ✓;组织结构图横向 + 11 人形 +
    6 卡片零重叠 ✓;AI 修改(增 QA 小组与内容运营)17→19 节点 ✓;
    截图 `docs/test-chart-edit.png`;bundle v37
- ✅ **图表布局几何修复 + 布局单测**(2026-09-08,鱼骨图实测发现):
  - 新增 tests/charts-layout.test.ts:各图表布局纯函数零重叠断言
    (几何在单测层迭代,不再依赖浏览器盲测)
  - 鱼骨图重写:类别上下交替、原因按类别列纵向堆叠(列宽 130 < 同侧
    类别间距),数学保证零重叠;实测 19 节点零重叠
  - 括号图卡片纵向间距不足(57.5 < 70)→ 大括号高度随数量自适应
  - 部件示例图名称标注补 mindmapAI 标记(此前无标记导致替换后残留堆积)
  - 诊断方法论沉淀:浏览器 bundle 缓存条目按 URL 键控——刷新必须针对
    页面实际引用的 URL(旧 bootstrap 引用 ?v=30),而非最新版本号
  - 测试 99→105(新增 6 个布局几何用例);bundle v45
- ✅ **自建本地抓取代理**(2026-09-08,配合上项):
  - `ai/tools/local-fetch-proxy.mjs`:零依赖 Node 本地代理,用法与
    r.jina.ai 相同(GET /https://目标 → Title + Markdown Content),
    本机直抓(境内站点从本机直接可达,网页版之前的失败只是浏览器 CORS)
  - 带反爬挑战页检测(头条等 JS 挑战页明确报 502,不污染导图)、
    JSON 接口透传(B站 view API)、内联脚本残留行过滤
  - 用法:node ai/tools/local-fetch-proxy.mjs [端口] → 设置「抓取代理」
    填 http://127.0.0.1:8788/
  - 实测:B站 API/页面抓取通;B站视频**字幕不在抓取范围**(需登录
    凭证),仅标题/简介元数据不足以完整提炼——视频内容用「粘贴文本」
    模式粘贴字幕/文稿;头条为 JS 强反爬,本地代理同样无法绕过
  - 测试 99;bundle v41
- ✅ **详细模式 + 复合画布 + 引文节点**(2026-09-08,用户反馈四项):
  - 「详细模式」勾选(默认开):全部要点逐条成叶、**引文成为画布上的
    引用子节点**(「…」样式),不再只存 tooltip;层级随来源骨架自然加深
  - tooltip 恢复完整引文(去截断;原生属性表仍被接管)
  - 复合画布:大来源(≥6 要点)时 AI 额外提出支线小思维导图(泳道容器)/
    要点表格/关键关系图,确定性布局排到主图右侧(失败不影响主图,
    console.warn 诊断)
  - 主题模式 prompt:偏好有意义的深度,叶子必须具体
  - 修复:骨架归一化把单章节来源的唯一标题清空(B站/短文来源骨架为空
    的根因);详细模式跳过 architect/autotune
  - 实测(zh 课程页 + 详细模式):103 节点、48 要点全展示、45 个引文
    引用节点、深度 5、coverage 100;tooltip 完整引文 ✓
  - extras 修复:模型回复围栏 JSON 导致 extras 静默失败(容错解析修复);
    dialogs 的 extras 构建块在多轮编辑中丢失(重新插入)
  - 复测:extras 36 元素绘制成功——2 个泳道支线小图(代理类型/代理组成,
    容器包含子项为设计性包含)+ 表格/关系元素,主图零意外重叠;
    截图 `docs/test-detail-extras.png`;测试 108;bundle v56
- ✅ **抓取链升级 + 要点数量自主**(2026-09-08,用户反馈):
  - 抓取回退链:GitHub raw 直连 → 其余站点直连(桌面版无 CORS)→
    失败/正文过薄时自动走公共抓取代理 r.jina.ai(返回页面 Markdown
    正文,顺带解决反爬);明确的 404/5xx 不触发代理
  - 「抓取代理」可在设置中自定义(默认 r.jina.ai,可换自建;留空禁用)
    ——境内网络 r.jina.ai 不可达(实测),自建代理是网页版抓取
    头条/知乎等站点的可行出路;桌面版经主进程直连亦受源站反爬限制
  - B 站视频页特判:BV 号解析 + view API 元数据(标题/简介/UP主)并入
    来源;视频字幕需登录凭证,不在抓取范围(UI 不虚报)
  - 要点数量改为 AI 按内容密度自主决定(prompt 不再固定"最多 12 条",
    改为"内容值得多少就提炼多少,不凑数不漏点"),单块上限 16、总量
    上限 120;导图节点总量仍由 AI 预算(15-60)约束
  - 测试 99;bundle v41
- ✅ **12 种思考图生成**(2026-09-08,来源:zhihu.com/p/648532879):
  - 新增 ai/src/charts/:catalog(圆圈/气泡/双重气泡/树形/流程/多重流程/
    括号/韦恩/鱼骨/时间线/桥状/组织结构,含定义与优点)、shapes(drawio
    形状部件目录:胶囊/菱形/平行四边形/圆柱/文档/六边形/卡片等 15 种,
    AI 按语义选用——回应"只会用一小部分部件")、layout(12 种确定性
    几何布局→ChartElement[])、assemble(单事务入画布)、pipeline
    (复用 distillNotes 提炼 + 槽位协议 architect + validate 校验)
  - 生成对话框顶部新增「图表类型」下拉(含各类型定义与优点说明),
    选思考图时隐藏导图专属行(层级/分支/评审等);来源三模式全可用
  - 校验策略:字段缺失/内容过少报错,数量超上限静默截断(layout slice)
  - 测试 99 通过;真实 DeepSeek e2e:流程图(10 节点 5 种形状部件、
    判断分支带标注、零重叠)、圆圈图(11 椭圆环形);截图
    `docs/test-chart-circle.png`;bundle v36
- ✅ **树状（竖向）布局**（2026-09-08）：
  - 布局选项第三项：根在顶部、层级自上而下（mxCompactTreeLayout
    horizontal=false，levelDistance 60 / nodeDistance 30）
  - 新增竖向正交边样式（父底出、子顶进）；detectLayoutKind 按边锚点
    （exitX=1 / exitY=1）识别三种布局，节点扩展/替换后重排无缝续用
  - 偏好/对话框/i18n 全链路打通；测试 97 通过
  - e2e：真实 API 竖向生成——根 y=0、深度增大 y 单调递增、10/10 边
    竖向样式、零重叠；截图 `docs/test-layout-tree-vertical.png`
  - 遗留：资源文件（dia*.txt）改动对老访客受启发式缓存影响；tooltip 持久化、
    fetch_url/github_raw（P1）见设计文档分期

## 常用命令速查（恢复开发用）

```bash
# ① 浏览器端开发（M0-M6 全部功能）
python3 -m http.server 8000 -d webapp/src/main/webapp     # 常驻 dev 服务器
# 浏览器打开 http://localhost:8000/（无缓存头，改动后刷新即可，
# bundle 变化时 bootstrap.js 里的 ?v=N 会自动绕缓存）

# ② 桌面端（M7；窗口经 WSLg 显示在 Windows 桌面）
cd desktop
MM_WEBAPP_DIR=$(pwd)/../webapp/src/main/webapp npm start
# 加 --remote-debugging-port=9222 --disable-gpu 可用 CDP 驱动自动化验证

# ③ 本地 mock LLM（不消耗真实配额联调；设置里 Base URL 指 http://127.0.0.1:8787）
node ai/dev-mock-server.mjs

# ④ 插件构建与测试（改 ai/src 后必须重新 build 才会进 webapp/desktop）
cd ai && npm run typecheck && npm test && npm run build

# ⑤ 桌面端 Electron 依赖（已装好；重装时 Electron 二进制需走镜像）
cd desktop && ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install

# ⑥ Windows 安装包（NSIS + MSI，必须在 Windows 侧原生构建：
#    WSL 内 NSIS 卸载器与 MSI/WiX 依赖 wine；构建机 C:\mindmapai-build\
#    需有 portable node、desktop/ 与 webapp/ 副本，详见 build.cmd 与上文 M8）
cmd.exe /c C:\\mindmapai-build\\build.cmd          # 产物 → C:\mindmapai-build\desktop\dist\
# 打包版回归（先起 exe --remote-debugging-port=9222 与 ai/dev-mock-server.mjs）：
# C:\mindmapai-build\node\node-v22.20.0-win-x64\node.exe C:\mindmapai-build\scripts\cdp-regression.mjs --flow | --persist
```

## 下一步（MVP 后）

二期功能（按原定路线图）：对话式侧边栏、选中节点扩展、导图优化/总结；
三期：文档转导图（MD/Word/PDF）、Markdown 双向、XMind/Freeplane/OPML 导入。
工程侧待办：GitHub fork 仓库与 CI（msi 签名分发）、产品名/图标终稿、
真实 DeepSeek key 的打包版人工验收。

## 许可

本项目基于 jgraph/drawio 与 jgraph/drawio-desktop（均为 Apache-2.0）二次开发，
产品名 **MindmapAI**。上游版权声明与 Apache-2.0 许可证在 `webapp/`、`desktop/`
仓库内原样保留；本项目的修改同样以 Apache-2.0 发布。
