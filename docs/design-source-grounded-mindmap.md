# 设计:从"一句话出图"到"有据可查的思维导图"

针对用户反馈:生成"很快、仿佛没有思考",产物"只有大概念、质量低"。
本文给出 Tools / Skills / Agents 三层能力的设计,目标是支持
**"给一个来源(链接/文本),生成忠实于来源的思维导图"**,
以 AI Agents for Beginners 第一篇
(`01-intro-to-ai-agents`)为贯穿用例。

## 1. 问题诊断(代码级)

现状生成链路(`ai/src/ai/client.ts:generateMindmapTree`)是**单次补全**:

```
buildSystemPrompt(约束)  ─┐
                          ├→ 1 次 chat/completions(非流式, max_tokens=4096)
buildUserPrompt(主题串)  ─┘      → schema.ts 清洗 → tree-model.ts 上画布
```

- `prompts.ts:buildUserPrompt` 只传一行 `Create a mind map for this topic:\n<主题>`。
  **模型能看到的全部输入就是主题字符串**,没有任何来源资料。
- 无中间推理、无分阶段、无自我审查;"快"是必然——单请求 5~10 秒出完
  (测试环境走 mock 服务器则毫秒级返回固定树)。
- "浅"是必然——模型只能调用参数记忆里的常识骨架(定义/分类/用例),
  这正是 prompt 里 "You are a mind map design expert" 能拿到的上限。

### 1.1 现状下要求"做第一篇内容的思维导图"会发生什么

主题框是单行文本。用户把 URL 或课程名粘进去后:

1. 模型**看不见**该页面/README——应用没有任何取数工具;
2. 模型按"AI Agents"的常识编一张泛化图(什么是 Agent / 组成 / 类型 / 用例);
3. 节点对不上第一篇实际内容(真实 README 的章节是:Agent 定义与类型表、
   **何时该用 Agent**、Agentic 方案三要素=开发平台/设计模式/框架、
   代码样例、冒烟测试……),甚至可能幻觉出根本不存在的章节名;
4. 用户无从发现错误——节点没有出处。

## 2. 设计原则

1. **补的不是"更自由的 agent",而是"受控的分工"。**
   MVP 不做模型自主 function-calling / ReAct 循环;工具由管线代码
   确定性调用,LLM 只在固定阶段内做提炼/构造/评审。可控、可测、
   天然可展示进度(直接回应"仿佛没有思考"的观感)。
2. **Grounding(溯源)是一等公民。** 每个节点尽量携带原文引文;
   评审阶段对"溯源率/覆盖率/具体度"打分,不达标回炉一次。
3. **最大化复用现有资产:** schema.ts 的约束与清洗、tree-model.ts
   的单事务替换、M7 的 `mmAiFetch` 主进程通道(桌面端取网页天然无
   CORS)、generation prefs、secure-store。

## 3. 分层模型

```
┌ Agent 层:Orchestrator(pipeline 状态机 + 预算 + 进度事件)
├ Skill 层:各阶段 prompt 契约(distill / architect / critique …)
└ Tool 层:确定性工具(fetch_url / paste_text / github_raw / …)
```

### 3.1 Tools(执行层,纯代码,无 LLM)

| 工具 | 输入 → 输出 | 说明 |
|---|---|---|
| `paste_text` | 用户粘贴文本 → SourceDoc | **P0 首选**:零网络依赖、内容最可靠 |
| `fetch_url` | URL → HTML→正文纯文本 | 桌面端走现成 `mmAiFetch` IPC;浏览器端需 CORS 代理(dev 可加 node 反代)。正文提取用 Readability 类算法 |
| `github_raw` | GitHub 仓库页 URL → raw Markdown | 第一篇用例的最佳来源:`microsoft/ai-agents-for-beginners` 的 README 本身是结构化 Markdown,比 HTML 干净得多 |
| `get_transcript` | 视频页 URL → 字幕文本 | **P2**:MS Learn 节目页没有内嵌字幕(已实测),YouTube 字幕属二期 |
| `search_web` | query → 搜索结果 | **P2 可选**:需要搜索 API key,仅用于"只有主题没有来源"的增强场景 |
| `read_local_file` | MD/DOCX/PDF → 文本 | **P2**:即 README 规划的三期"文档转导图" |

工具安全约束:协议白名单 http/https、响应大小上限(如 2MB)、
单工具超时、去脚本(HTML 转纯文本后进 prompt)。

### 3.2 Skills(可复用的 prompt + 流程契约)

延续 `prompts.ts` 的写法风格,每个 skill 一个文件、可独立单测:

| Skill | 输入 → 输出 | 要点 |
|---|---|---|
| `source-distill` | SourceDoc → DistilledNote[] | 长文分块 map-reduce:按标题层级切块,每块抽要点(带原文引文),reduce 去重合并。温度 0.3 |
| `mindmap-architect` | DistilledNote[] + 约束 → 候选树 JSON | 复用现有 depth/maxChildren/maxNodes/语言约束;**每个节点须引用支撑它的 noteId**。温度 0.5 |
| `self-critique` | 候选树 + SourceDoc → 评分 + 修改意见 | rubric:①溯源——抽样节点核对引文;②覆盖——README/原文各章节是否都有分支;③具体度——叶子是否仍是"大概念";④结构——深度/分支均衡。温度 0 |
| `topic-fallback` | 仅主题(无来源)→ 树 | 两阶段:先 brainstorm 20+ 候选要点再筛并组织;比现状单发好,但产物须标注"未基于来源" |

数据契约(新增于 `types`):

```ts
interface SourceDoc { title: string; url?: string; chunks: { id: string; headingPath?: string; text: string }[]; }
interface DistilledNote { id: string; content: string; quote: string; chunkId: string; }
// MindmapTree 节点扩展(可选,旧树不受影响):
interface MindmapNode { label: string; children?: MindmapNode[]; source?: { noteIds: string[] } }
```

### 3.3 Agent 层:Orchestrator(固定状态机)

```
[输入] 主题 + 来源(链接 | 粘贴文本 | 文件)
 → INGEST    工具取数 → SourceDoc(标题/分块)
 → DISTILL   source-distill → 要点集(进度:第 i/N 块)
 → ARCHITECT mindmap-architect → 候选树(schema.ts 校验,失败走现有重答机制)
 → CRITIQUE  self-critique → 总分 < 阈值则携修改意见回 ARCHITECT(至多 1 次)
 → RENDER    tree-model.ts 单事务上画布;引文写入节点 note/tooltip
```

- 预算控制:总步数 ≤ 8、总 token 上限、单阶段超时;超限降级
  (如 DISTILL 失败→把原文截断直送 ARCHITECT 并提示质量风险)。
- 每阶段向 UI 发进度事件(阶段名 + 细节 + 可取消)——把"思考"外显。
- 全程可配置跳过 CRITIQUE(追求速度时)。

## 4. UI 变更(`dialogs.ts`)

1. 生成对话框新增**内容来源**域,三选一:
   `主题(现状)` / `链接(自动识别 GitHub raw 最佳路径)` / `粘贴文本`。
2. 生成中:对话框变为进度面板(抓取中 → 提炼中 3/7 → 构造中 →
   审校中[得分 82] → 完成),附取消按钮。
3. 完成后(可选,二期):侧栏"溯源视图",点节点高亮原文引文。
4. 偏好沿用 `mindmapAI.generation.v1` 记忆上次来源类型。

## 5. 仓库落地映射

| 变更 | 文件 |
|---|---|
| 新增 `ai/src/agent/`:`pipeline.ts`(状态机)、`tools.ts`(工具实现+注册表)、`skills.ts`(阶段 prompt 构造)、`budget.ts` | 新目录 |
| `MindmapNode.source` 可选字段、解析透传 | `ai/src/ai/schema.ts` |
| chatRequest 支持按阶段的自定义超时与温度(P0 无需 function calling) | `ai/src/ai/client.ts` |
| 来源域 + 进度面板 | `ai/src/ui/dialogs.ts` |
| 引文写进 mxCell note(value 不变,不影响布局/估宽) | `ai/src/mindmap/tree-model.ts` |
| mock 扩展为可按阶段脚本化(INGEST/DISTILL/…各返回固定体) | `ai/dev-mock-server.mjs` |
| i18n 新 key | `resources/dia.txt` / `dia_zh.txt` |

## 6. 贯穿用例:第一篇 before / after

**before(现状)**:输入"AI Agents for Beginners 第一篇" →
`什么是AI代理 / 核心组成 / 常见类型 / 应用场景 / 未来展望` 一类常识骨架。

**after(设计后)**:识别 GitHub 仓库 → 拉取
`raw.githubusercontent.com/microsoft/ai-agents-for-beginners/main/01-intro-to-ai-agents/README.md`
→ distill/architect 后的一级分支应忠实对应真实章节:

- Agent 的定义与类型(环境/传感器/执行器 + 类型表:简单反射 → 多智能体 MAS)
- 何时该用 Agent(开放性问题、多步工具调用、持续改进)
- Agentic 方案三要素(开发:Foundry Agent Service / 模式 / 框架)
- 代码样例(Python 与 .NET)
- 冒烟测试(可选,关联 Lesson 16)

每个叶子节点可点开看到 README 原句引文。差异即"AI 做出的反应"的答案:
**从"编一张像样的图"变成"读完全文后复述结构"。**

## 7. 测试策略

- 各 skill 的 prompt 构造/输出解析:vitest 单测(延续现有 38+ 用例风格)。
- pipeline 状态机:阶段转移、预算超限降级、CRITIQUE 回炉、取消。
- e2e:扩展 `dev-mock-server.mjs` 按阶段返回脚本化响应;浏览器端
  走粘贴文本来源(无网络依赖)即可回归全链路。
- 评审质量:构造"少一章 / 叶子全是空话 / 引文对不上"三个坏树样例,
  断言 self-critique 能发现。

## 8. 分期

- **P0(无网络依赖,纯增量)**:`paste_text` 来源 + DISTILL →
  ARCHITECT → CRITIQUE 三阶段 + 进度面板 + note 溯源。
  浏览器现有模式即可用,先行验证质量提升幅度。
- **P1(取数能力)**:桌面端 `fetch_url`/`github_raw`(复用 mmAiFetch);
  浏览器模式加 dev 代理并明示"浏览器模式不支持取链接"。
- **P2**:字幕/`search_web`/本地 MD·PDF/懒展开(点击节点再生成子树)/
  多来源合并。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 浏览器端 CORS | P0 用粘贴文本绕开;P1 桌面端 mmAiFetch 直连;web 模式代理并明示 |
| MS Learn 节目页无字幕 | 优先 GitHub README(P1 即可覆盖该课程全部 18 课) |
| 长来源 token 爆炸 | 分块 map-reduce;单块超长再细切;DISTILL 输出上限 |
| 幻觉节点 | 引文强制 + critique 溯源抽检 + 不达标回炉一次 |
| 阶段变多变慢 | 进度面板外显各阶段;CRITIQUE 可关;实测"慢而有据"换"快而空泛" |
