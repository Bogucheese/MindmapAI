/**
 * M5 验收用固定 fixture（「AI → 示例导图」演示也用它）：
 * 8 个一级分支（覆盖色板循环 6 色）、3 层深度、CJK 长标签（折行）。
 */

import type { MindmapTree } from '../ai/schema';

export const DEMO_TREE: MindmapTree = {
  label: '新能源汽车产业链分析',
  children: [
    {
      label: '上游 · 原材料',
      children: [
        { label: '锂矿与盐湖提锂' },
        { label: '正极材料：磷酸铁锂与三元锂的路线之争与成本平衡' },
        { label: '电解液 / 隔膜 / 负极' },
      ],
    },
    {
      label: '中游 · 三电系统',
      children: [
        { label: '动力电池', children: [{ label: '宁德时代' }, { label: '比亚迪弗迪' }] },
        { label: '驱动电机与电控' },
        { label: '高压快充平台' },
      ],
    },
    {
      label: '下游 · 整车与市场',
      children: [
        { label: '传统车企转型' },
        { label: '新势力', children: [{ label: '蔚小理' }, { label: '小米汽车' }] },
        { label: '出口与海外建厂' },
      ],
    },
    {
      label: '补能与服务',
      children: [{ label: '充电桩运营' }, { label: '换电模式' }, { label: '电池回收与梯次利用' }],
    },
    { label: '政策与标准' },
    {
      label: '智能驾驶产业链',
      children: [{ label: '芯片' }, { label: '传感器' }, { label: '算法与数据闭环' }],
    },
    { label: '氢燃料电池路线' },
    {
      label: '投资逻辑与风险',
      children: [{ label: '产能过剩' }, { label: '价格战' }, { label: '技术路线切换' }],
    },
  ],
};
