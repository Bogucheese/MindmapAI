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

## 本轮修复：流程图大改 + 图表 Agent 模式开放

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

## 待用户反馈 / 待办

- **用户侧**：F12 控制台报错文本（上轮被截断未收到）；Agent 模式、画布比例、
  grounding 放宽后的真实模型实测效果
- **功能待办**：
  - 跨会话记忆（Agent 记住风格偏好/纠正过的术语）
  - 命令框对话多轮历史持久化（v1 每条指令独立，靠当前树携带上下文）
  - Agent 命令实时上画布（现在是树修改完成后单事务重建+渐显）
  - macOS / Linux 打包、安装包代码签名
  - XMind / Freeplane / OPML 导入、文档转导图（Markdown/Word/PDF）
- **环境**：gh CLI 在 `~/.local/bin/gh`（未登录）；SSH 已绑定 Bogucheese；
  npm 走 npmmirror；GitHub 直连不稳，clone 用 ghproxy 镜像参数

## 转 Public 前检查单

- [ ] 用户实测通过后：Settings → Danger Zone → Change visibility
- [ ] 提交作者邮箱为 `3329850656@qq.com`，转公开后会可见（用户已知悉，
      未要求改写；如需隐藏须在推送前改写这 4+ 个提交）
- [ ] Releases 挂安装包时确认包内含 Apache-2.0 LICENSE 文本
