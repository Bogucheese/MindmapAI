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
