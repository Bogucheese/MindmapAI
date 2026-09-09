/**
 * 12 种思维导图/思考图类型目录(源自
 * https://zhuanlan.zhihu.com/p/648532879):
 * 名称、定义、优点/适用场景,以及 AI 槽位协议(JSON schema 描述)。
 * 结构由槽位协议决定,几何布局由 charts/layout.ts 确定性完成。
 */

export type ChartTypeId =
  | 'circle'        // 圆圈图
  | 'bubble'        // 气泡图
  | 'doubleBubble'  // 双重气泡图
  | 'tree'          // 树形图
  | 'flow'          // 流程图
  | 'multiFlow'     // 多重流程图
  | 'brace'         // 括号图
  | 'venn'          // 韦恩图
  | 'fishbone'      // 鱼骨图
  | 'timeline'      // 时间线
  | 'bridge'        // 桥状图
  | 'org';          // 组织结构图

export interface ChartTypeMeta {
  id: ChartTypeId;
  name: string;
  /** 定义(一句话) */
  definition: string;
  /** 优点/适用场景(一句话) */
  pros: string;
  /** AI 槽位协议(JSON schema 描述,进 prompt) */
  slots: string;
  /** 槽位示例(进 prompt) */
  example: string;
}

export const CHART_TYPES: Record<ChartTypeId, ChartTypeMeta> = {
  circle: {
    id: 'circle',
    name: '圆圈图',
    definition: '由内圈(主题)与外圈(相关描述)构成,用来定义一个事物。',
    pros: '适合发散思维与自由联想,快速罗列主题的一切相关内容。',
    slots: '{"center": "中心主题", "outer": ["属性/联想1", "属性/联想2", "..."]}(outer 6-10 项)',
    example: '{"center":"太阳能","outer":["清洁","可再生","成本逐年下降","受天气影响","储能是关键"]}',
  },
  bubble: {
    id: 'bubble',
    name: '气泡图',
    definition: '中心大气泡为主题,周围气泡描述主题的相关属性,以整体方式分析解释事物。',
    pros: '适合分析、解释和描述事物属性,比圆圈图更强调"属性描述"。',
    slots: '{"center": "中心主题", "bubbles": ["属性1", "属性2", "..."]}(bubbles 5-8 项)',
    example: '{"center":"远程办公","bubbles":["灵活省时","沟通成本高","依赖自律","需要协作工具"]}',
  },
  doubleBubble: {
    id: 'doubleBubble',
    name: '双重气泡图',
    definition: '两个中心气泡并列,中间为共同点,两侧为各自的差异点,用于两个事物的对比比较。',
    pros: '清晰找出两个事物的共同点与不同点,帮助建立知识体系。',
    slots: '{"left": "事物A", "right": "事物B", "shared": ["共同点..."], "leftOnly": ["A独有..."], "rightOnly": ["B独有..."]}(各 2-5 项)',
    example: '{"left":"纸质书","right":"电子书","shared":["承载知识","可标注"],"leftOnly":["无电量焦虑","纸质触感"],"rightOnly":["便携","可检索"]}',
  },
  tree: {
    id: 'tree',
    name: '树形图(树状图)',
    definition: '像一棵树,树干为主、发散枝丫,将知识总分,主要用于分组和分类。',
    pros: '帮助对事物进行分类,寻找共性与特性,结构清晰。',
    slots: '{"root": "主题", "branches": [{"label": "分类1", "leaves": ["成员...", "..."]}, {"label": "分类2", "leaves": [...]}]}(2-5 个分类,每类 2-5 个成员)',
    example: '{"root":"编程语言","branches":[{"label":"前端","leaves":["JavaScript","TypeScript"]},{"label":"后端","leaves":["Go","Java"]}]}',
  },
  flow: {
    id: 'flow',
    name: '流程图',
    definition: '展示事物的演变,说明事情发生的顺序和过程,通过连续性分析内在逻辑。',
    pros: '培养程序性思维和统筹能力;步骤/判断/输入输出等部件可按语义选用。',
    slots: '{"title": "流程名", "lanes": ["角色/阶段1", "角色/阶段2"](可选,给出时每个步骤须带 "lane": 从0开始的泳道序号), "steps": [{"label": "步骤", "shape": "process|decision|data|terminator|document|database|preparation|manualInput|manualOperation|delay|display|triangle|note", "lane": 0, "dashed": false(该步的进入连线用虚线), "arrow": "到下一步的连线标注(可省略)"}]}(steps 4-10 个;第一个/最后一个建议 shape=terminator;判断用 decision 且下一步用 arrow 标注分支条件;涉及多个角色/阶段时给出 lanes 并把步骤分到泳道)',
    example: '{"title":"需求交付","lanes":["产品","研发","测试"],"steps":[{"label":"开始","shape":"terminator","lane":0},{"label":"写需求","shape":"document","lane":0},{"label":"开发","shape":"process","lane":1},{"label":"通过?","shape":"decision","lane":2,"arrow":"是"},{"label":"回归验证","shape":"process","lane":2,"dashed":true,"arrow":"否"}]}',
  },
  multiFlow: {
    id: 'multiFlow',
    name: '多重流程图',
    definition: '因果思维:中间是事件,左侧是原因,右侧是结果,理清前因后果。',
    pros: '适用于复杂流程或多分支事件,确定一件事的原因和影响。',
    slots: '{"event": "中心事件", "causes": ["原因1", "..."], "effects": ["结果1", "..."]}(causes/effects 各 2-5 项)',
    example: '{"event":"服务宕机","causes":["流量激增","磁盘故障"],"effects":["用户流失","故障复盘"]}',
  },
  brace: {
    id: 'brace',
    name: '括号图',
    definition: '用大括号表示整体与局部的关系,展示事物与组成部分。',
    pros: '建立空间感,展示知识包含关系,分析知识结构。',
    slots: '{"whole": "整体", "parts": [{"label": "部件1", "detail": "说明(可省略)"}, ...]}(parts 3-8 个)',
    example: '{"whole":"计算机","parts":[{"label":"CPU","detail":"运算核心"},{"label":"内存","detail":"临时存储"},{"label":"硬盘","detail":"持久存储"}]}',
  },
  venn: {
    id: 'venn',
    name: '韦恩图',
    definition: '以交叠的圆显示元素集合的重叠区域,展示集合间的数学或逻辑联系。',
    pros: '直观表现事物间的共性与个性。',
    slots: '{"left": {"title": "集合A", "items": ["仅A有的..."]}, "right": {"title": "集合B", "items": ["仅B有的..."]}, "shared": ["共同点..."]}(items/shared 各 2-5 项)',
    example: '{"left":{"title":" mammals","items":["胎生","恒温"]},"right":{"title":"鱼类","items":["卵生","水生"]},"shared":["脊椎动物","游动"]}',
  },
  fishbone: {
    id: 'fishbone',
    name: '鱼骨图',
    definition: '又叫因果图:主刺指向问题,大骨为原因类别,小骨为具体原因,透过现象看本质。',
    pros: '发现问题根本原因的图形方法,直观描绘原因之间的关系。',
    slots: '{"problem": "问题", "categories": [{"name": "类别(如人/机/料/法)", "causes": ["具体原因..."]}]}(categories 3-6 个,每类 2-4 个原因)',
    example: '{"problem":"网站加载慢","categories":[{"name":"资源","causes":["图片未压缩","脚本过大"]},{"name":"网络","causes":["无CDN"]}]}',
  },
  timeline: {
    id: 'timeline',
    name: '时间线(时间轴)',
    definition: '通过时间顺序、主题趋势、流程前后串联系列事物。',
    pros: '记录重要事件的发展或展示主题的进度与过程。',
    slots: '{"title": "主题", "events": [{"time": "时间/阶段", "label": "事件"}]}(events 4-10 个,按时间先后)',
    example: '{"title":"AI 发展","events":[{"time":"1950","label":"图灵测试"},{"time":"2022","label":"ChatGPT"}]}',
  },
  bridge: {
    id: 'bridge',
    name: '桥状图',
    definition: '在桥型横线上下写下具有相关性的一组事物,按此相关性列出更多类似组,用于类比和类推。',
    pros: '训练类比推理:第一组建立关系,后续组沿用同一关系。',
    slots: '{"relation": "关系描述", "pairs": [{"top": "上位", "bottom": "下位"}]}(pairs 2-4 组,第一组为示例)',
    example: '{"relation":"倍数关系","pairs":[{"top":"蜻蜓","bottom":"蚊子"},{"top":"猎豹","bottom":"蚂蚁"}]}',
  },
  org: {
    id: 'org',
    name: '组织结构图',
    definition: '展示组织内人员、等级、岗位、职责的相互关系,或主题下的层级逻辑。',
    pros: '层级清晰,广泛用于组织架构与分类层级展示。',
    slots: '{"root": "最高层级", "branches": [{"label": "部门/岗位", "members": ["成员/下级..."]}]}(branches 2-6 个,每个 1-5 个成员;成员绘制为人形部件)',
    example: '{"root":"CEO","branches":[{"label":"研发部","members":["前端组","后端组"]},{"label":"市场部","members":["品牌"]}]}',
  },
};

export const CHART_TYPE_ORDER: ChartTypeId[] = [
  'circle',
  'bubble',
  'doubleBubble',
  'tree',
  'flow',
  'multiFlow',
  'brace',
  'venn',
  'fishbone',
  'timeline',
  'bridge',
  'org',
];

export function isChartTypeId(v: string): v is ChartTypeId {
  return Object.prototype.hasOwnProperty.call(CHART_TYPES, v);
}

/** 供 prompt 的类型说明(一段) */
export function chartTypePrompt(meta: ChartTypeMeta): string {
  return `${meta.name} — 定义:${meta.definition} 优点/适用:${meta.pros}\n输出槽位(严格 JSON):${meta.slots}\n示例:${meta.example}`;
}
