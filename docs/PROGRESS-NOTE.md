# 会话交接笔记（PROGRESS NOTE）

> 用途：跨会话继续开发时的起点快照。更新于最近一次会话结束，之后的新进展以 git log 为准。

## 已完成里程碑（按时间序）

1. **发布前合规检查与上线**：仓库只含原创代码（上游 drawio 源码运行时经
   `scripts/setup-upstream.mjs` 拉取不入库），全历史无密钥，Apache-2.0 +
   NOTICE.md；清理了含上游代码的本地备份引用。仓库
   `github.com/Bogucheese/MindmapAI`（Private，等用户验证后手动转 Public）。
2. **首跑可靠性 + 一键启动**：上游改为浅获取固定提交（失败回退全量克隆，
   报错附镜像参数示例）；`scripts/start.mjs` + `start.sh`/`start.cmd`
   一键启动（首次自动 setup）。
3. **Agent 侧边栏面板**：右侧停靠面板（drawio 配色、可拖宽、Format 区
   「AI Agent」tab 常驻入口），实时展示提炼要点原文/引文、骨架、评审四维
   分数与评语、回炉原因、逐图进度；底部命令输入框。
4. **真 Agent 模式**（默认关闭，勾选启用）：工具循环（chatWithTools），
   模型自主装配——导图 7 工具逐节点放置；思考图 read_notes/fetch_url/
   submit_chart + 校验反馈自修；自检闭环（确定性去重 + 结构报告修正轮）。
5. **画布比例**：16:9/4:3/1:1/自动，tree/tree-vertical 布局间距两轮自适应。
6. **grounding 放宽**：要点是素材不是枷锁——允许重组/泛化/常识性补充，
   评审只惩罚与来源矛盾的事实性错误。
7. **逐个放置动画**：DFS 序渐显（纯视觉层，Ctrl+Z 仍一步撤销）。

## 最近一轮修复（用户实测反馈）

- Agent 侧边栏 z-index 提到模态遮罩之上（生成期间不再发暗/被拦截/误中断）
- 流程图：节点泳道内居中不越界；顺序连线定向连接点；跨泳道直线虚线；
  multiFlow 汇入点分散 + 蓝/橙双色
- 命令框 dead bug：单例浅拷贝导致 onCommand 绑定丢失（已改为存 handle 本体）
- 命令框支持思考图：editChart 槽位修正 + 重建

## 本轮修复：面板语言切换不刷新 + 图表类型英文名 + 图表统一规模上限

- **① Agent 面板切语言不更新**（用户实测）：面板 DOM 只在构建时取一次
  i18n。新增 `languageChanged` 监听（与主题同机制）：重取框架文案（live/
  Clear/Send/placeholder/空态）并按事件历史重渲染卡片。E2E 模拟
  zh→en 资源切换 + 事件派发，面板即时变英文 ✓。
- **② 图表类型名/说明是中文常量**：catalog 的 meta.name 等是 prompt 专用
  中文常量，界面层误直接展示。新增 `chartTypeName/chartTypeDesc`（i18n），
  对话框下拉、说明行、面板事件名全部改走它们；12 个类型名 + 12 条说明入
  中英资源（en: Circle Map/Flowchart/Org Chart…）。Label language 的「中文」
  选项也 i18n 为 Chinese/中文。E2E 英文界面下拉全英文 ✓。
- **③ 图表统一规模标准**（设计回答）：depth/branches 是树形导图专有概念，
  固定结构的思考图不适用；合理的对应物是**每张图元素上限**
  （`chartMaxItems`，0=按类型默认）——作用于各类型主集合（流程步骤/树分支/
  时间线事件/气泡…，`capSlotsItems` 截断且不低于校验最小值，venn 嵌套
  集合同限），prompt 节点预算同步；单发/Agent/全景三条生成路径全接。
- **测试**：21 文件 162 全绿（新增 cap×5、chartTypeName、面板语言切换）。
- **踩坑**：i18n 资源插入含 `&` 的文本必须用 perl/Node 脚本,不能用 sed
  （上轮已修一处,本轮全部改走 Node 脚本）。

## 本轮新功能：文档转导图 + 导图总结与优化建议（路线图两项）

- **文档转导图**：来源新增「文档文件」（.md/.txt/.docx/.pdf），零依赖提取
  （`agent/doc-extract.ts`：docx=zip 中央目录+DecompressionStream 解 document.xml;
  pdf=逐流 FlateDecode（zlib 封装优先,裸流兜底）+ Tj/TJ 操作符拼文本,过薄
  明确报错建议粘贴）。提取后与粘贴文本同管线（导图/思考图共用）。单测
  手搓 zip/pdf fixtures 覆盖 stored/deflate/flate/坏文件/过薄 8 例。
  已知限制:PDF 无 CMap 解码,复杂编码(部分中文 PDF)/扫描件提取不了,会明确
  提示改用粘贴。
- **总结与优化建议**：AI 菜单新增「总结与优化建议…」（`ui/summarize.ts` +
  `agent/summarize.ts`）：对最近一次生成结果(面板上下文,导图序列化缩进文本/
  图表槽位 JSON)单发评审,三段输出(总结/要点/优化建议)以 assistant 卡片入
  Agent 面板,只读不改画布。
- **踩坑记录**：i18n 批量插入用 sed 时替换文本含 `&` 被展开成匹配行,污染了
  en 资源的 aiSummarize 行——perl 修复;资源文件今后改动用 perl/编辑器,别用
  sed。PDF FlateDecode 是 zlib 封装(RFC 1950)不是裸 deflate,'deflate' 先试。
- **E2E**：mock 服务器新增 summarize 阶段;浏览器注入 DataTransfer 文件走通
  文件来源全管线(根节点取文件名);总结 action 面板三段卡片 ✓。20 文件 155 全绿。

## 本轮修复：Agent 面板跟随暗色主题 + i18n 补漏 + 路线图盘点

- **暗色主题**（用户要求）：agent-panel 全部颜色收敛为调色板
  （`panelPalette(dark)`，暗色对齐 drawio 画布 #2A2A2E/工具区 #202124/描边
  #3C4043）；主题判定 `isDarkTheme` 按新版 drawio 的 `Editor.darkMode` 布尔
  优先，旧版 `Editor.currentTheme==='dark'` 与 `ui.theme` 兜底；监听
  `darkModeChanged` + `currentThemeChanged`，切换时按事件历史重渲染卡片
  （新增 history 缓存,不丢会话）。
- **顺手修复**：面板初始 display:flex 导致菜单「Agent panel」首次点击反而
  隐藏——改为初始隐藏。
- **英文版检查结论**：Agent 面板 i18n 覆盖完整（en/zh 双补丁 + EN_STRINGS
  兜底,英文 UI 实测全英文）；修补 3 处硬编码中文错误文案
  （agent-chart 未提交槽位/槽位校验失败/内容过少 + tools 抓取过薄详情，
  新增 4 个键入 patches 与已生成 dia*.txt）；keys.ts 两条 fetch 提示同步。
  已知遗留:charts/validate 的槽位校验错误文案仍为中文（影响面=提交失败
  提示），需要时再统一。
- **README 路线图盘点**：对话式侧边栏、零配置链接抓取、流程图分支连线标
  [x]；新增「导图总结与优化建议」待办；文档转导图/XMind 导入/macOS+Linux
  打包仍 [ ]。
- **测试**：happy-dom 主题用例×3（调色板完备/判定优先级/事件重渲染不丢
  历史）；19 文件 147 全绿；真实浏览器 ?ui=dark 实测面板配色逐值命中
  暗色调色板、首次点击正常展开。

- **问题**（用户反馈）：流程图"做的太烂、连线一点也不规范"；问图表有没有
  Agent 模式。测试链接 runoob ai-terminology。
- **根因**：① flow 槽位协议只能表达线性链（步骤 i→i+1），decision 分支/回退
  无法表达，示例的 arrow 语义还是错的；② 跨泳道连线用斜直线
  （edgeStyle=none 虚线）；③ title 校验必需但布局压根不画；④ **图表类型下
  Agent 复选框被 UI 隐藏**（runAgentChart 早就存在且已接线，用户根本看不到）。
- **修复**：
  - 槽位协议加步骤 `id` + 显式 `edges`（from/to/label/dashed），给出时连线
    完全由模型决定；省略时退化为顺序链（向后兼容）。校验：id 唯一、edges
    必须引用已渲染步骤（Agent 3 次提交预算内可自修）。
  - `layoutFlow` 全部正交路由（orthogonalEdgeStyle），按两端几何关系选连接
    点：顺流沿流向、回退侧面绕行、跨泳道侧向一跃；虚线仅表达语义。title
    渲染为左上角文本。
  - 对话框：图表类型（gallery 除外）显示 Agent 复选框（标签去掉"仅导图"）。
  - mock 服务器支持 chart（流程图→带分支的流程槽位）与 agent-chart
    （tool_calls submit_chart 一次成环）阶段；修正 stage 正则匹配连字符。
- **测试**：tsc 零错误；vitest 18 文件 144 全绿（新增显式 edges 布局×4、
  校验×3，更新跨泳道断言为全正交实线）。
- **E2E**（IAB + dev-mock-server + 真实 relay 抓取 runoob 链接）：
  - 单发流程图 ✓：14 单元格（3 泳道+5 步骤+1 标题+5 边），5 边全正交，
    连接点方向正确（跨泳道侧向、回退右侧绕行、分支 是/否 标注、否 虚线）；
  - **Agent 模式（图表）✓**：勾选入口现在可见；面板事件
    distill 4 要点 → "Agent is designing the chart..." →
    submit_chart {"accepted":true,"nodes":7} → ✓ Done 流程图 · 7 nodes。
  - 注：本会话模型无图像输入，截图无法目检，验收基于画布结构断言
    （样式串/连接点/坐标），正交样式下 drawio 不可能渲染出斜线。

## 本轮修复：浏览器模式链接抓取内置中继

- **问题**（用户 F12 日志）：`runoob` 直连被 CORS 拦截 → `r.jina.ai` 兜底超时
  → 页面抓取失败。此前解法（手动起 8788 本地代理 + 设置里填前缀）需手动配置。
- **修复**：`scripts/start.mjs` 内置同源抓取中继 `GET /mm-fetch-proxy?url=<目标>`
  （服务端 fetch 无 CORS，原样透传响应体与状态码，30s 超时/3MB 上限，与前端
  MAX_HTML_BYTES 一致）；前端抓取链改为 直连 → 同源中继（浏览器模式自动,
  `tools.ts` `defaultRelayBase`）→ 公共代理（r.jina.ai，设置里可替换/禁用）。
  Agent 循环的 `fetch_url` 工具同样接入（`fetchWithRelay`）。B 站 view API
  元数据抓取也改为 直连→中继→代理 链。
- **单测**：tools-fetch.test.ts 新增 5 个用例（中继兜底/直连命中不触发中继/
  中继 404 落到公共代理/fetchWithRelay 成与败）。tsc 零错误，18 文件 136 全绿。
- **E2E 验证**：真实浏览器打开 start.mjs 服务，页面上下文直连 runoob 复现
  `Failed to fetch`（与用户日志一致），中继 200 返回 120KB 正文、标题正确
  解析为「Java 方法 | 菜鸟教程」。
- **注意**：改动 ai/src 后需 `npm run build` 重出 bundle（webapp/ 为生成物不入库）；
  i18n 提示（aiFetchHint/aiFetchBrowserHint/aiProxyHint）已同步 patches/ 与
  已生成的 dia.txt/dia_zh.txt。

## 自检记录（最近一次全量测试）

- **静态**：tsc 零错误；vitest 131+2=133 全绿（新增泳道越界/连线样式回归测试）；
  esbuild 构建通过（v44）。
- **死代码清扫**：删除 3 个无引用导出（isChartTypeId/chartTypePrompt/
  dashedEdgeStyle）；ASPECT_RATIO 收敛到 settings.ts（原 dialogs 与
  agent-commands 各有一份）；i18n 123 个键逐一核对无死键（7 个疑似均为
  动态引用误报）。
- **浏览器端到端（IAB + dev-mock-server:8787）**：
  - 应用加载零控制台错误；Format 区「AI Agent」tab、右下双徽标、停靠面板 ✓
  - 示例导图上画布（13 节点）✓
  - 命令框发送链路 ✓（用户气泡 + Agent 警告/答复）
  - 粘贴模式完整管线 ✓：PREPARING → DISTILLING（要点原文卡片）→
    STRUCTURING → REVIEWING（92/88/85/90 PASS + 评语）→ DRAWING →
    ✓ Done 9 节点；画布出现 mock 树
  - 流程图（mock 无 chart 阶段脚本）：校验捕获「缺少必需字段 title」，
    画布保持原状 —— 错误路径优雅 ✓
  - 图表 Agent 模式（mock 无 tool_calls）：notes 事件 + AGENT IS DESIGNING
    阶段 + 「Agent 未提交图表槽位」优雅报错 ✓；导图 Agent 循环由单测覆盖
- **测试中发现并当场修复的 bug**：
  1. 兜底菜单工厂缺少「Agent panel」项（只在主工厂加了）——已补；
  2. 命令框 dead bug（上轮 spread 拷贝）——已修；
  3. 为可调试性新增 `window.__mmUI` 调试句柄（F12 可直接访问 EditorUi 实例）。
- **未能在本环境验证**：桌面版 CDP 回归（需安装应用）；真实模型行为
  （需用户 Key）。

## 真实模型全流程测试（DeepSeek + 本地抓取代理，runoob 链接）

- **链接模式导图管线** ✓：runoob 经本地代理(8788)抓取 → 30 条要点(带原文
  引文) → 评审 NEEDS REVISION 并给出具体意见(下沉 Dify/LangChain/AutoGen
  等框架名、拆分秒哒/MonkeyCode) → 回炉重构 → ✓ Done 24 节点 + 复合画布
  extras(3 支线图/6 行表格/4 关系)
- **图表 Agent 模式** ✓：DeepSeek function calling 真实调用
  read_notes×3(含空查询自纠) → submit_chart(校验通过,10 节点流程图：
  用户→输入任务目标→Agent 大脑(LLM)→工具与环境…)
- **命令框** ✓：自然语言指令 → 真实 update_node+add_node+finish_changes
  → 画布同步重建(根改名+新增子节点)
- **全程零控制台错误**

### F12 报错结论（用户提供）

- `unload Permissions policy violation` / `apis.google.com`、
  `dropbox.com dropins.js` 超时：drawio 自带资源,国内不可达,仅噪音
- **CORS 拦截 runoob + r.jina.ai 超时**：已修复——start.mjs 内置同源中继
  `/mm-fetch-proxy`，浏览器模式自动兜底，无需手动起代理（见上方
  「本轮修复」）；手动方案（`ai/tools/local-fetch-proxy.mjs` + 设置填
  `http://127.0.0.1:8788/`）保留给其它托管方式
- 待办候选：默认公共代理 fallback 超时缩短/更早提示；index.html 移除
  Google/Dropbox 脚本加速国内首屏

## 今日收尾（2026-09-12）

- **已推送**：`d1f539f`（流程图分支连线+全正交路由+图表 Agent 模式开放+
  内置抓取中继）、`2a2675c`（文档转导图+总结建议+暗色面板+语言切换+
  图表规模上限）。测试基线 21 文件 162 全绿。
- **博客发布**：技术文章《把 drawio 二开成 AI 思维导图工具：架构设计与
  踩坑实录》已上线 <https://lzhcodeblog.site/2026/09/12/drawio-mindmap-ai-secondary-development/>
  （Hexo,~/projects/blog,deploy → Bogucheese.github.io main;3 张截图取自
  docs/）。

## 待用户反馈 / 待办

- **用户侧**：真实模型实测（DeepSeek key）——流程图分支 edges、文档导入
  （真实 docx/pdf）、总结建议、暗色面板、语言切换的实际观感
- **功能待办**：
  - Markdown 双向编辑（路线图遗留）
  - XMind / Freeplane / OPML 导入
  - macOS / Linux 打包、安装包代码签名
  - charts/validate 校验错误文案 i18n（英文界面提交失败提示仍是中文）
  - PDF 提取升级:CMap/ToUnicode 解码（复杂编码中文 PDF 目前提取不了,
    报错引导粘贴）
  - 跨会话记忆（Agent 记住风格偏好/纠正过的术语）
  - 命令框对话多轮历史持久化（v1 每条指令独立,靠当前树携带上下文）
  - Agent 命令实时上画布（现在是树修改完成后单事务重建+渐显）
- **环境**：gh CLI 在 `~/.local/bin/gh`（未登录）；SSH 已绑定 Bogucheese；
  npm 走 npmmirror；GitHub 直连不稳，clone 用 ghproxy 镜像参数

## 转 Public 前检查单

- [ ] 用户实测通过后：Settings → Danger Zone → Change visibility
- [ ] 提交作者邮箱为 `3329850656@qq.com`，转公开后会可见（用户已知悉，
      未要求改写；如需隐藏须在推送前改写这 4+ 个提交）
- [ ] Releases 挂安装包时确认包内含 Apache-2.0 LICENSE 文本
