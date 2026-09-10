/**
 * i18n 辅助。所有新增字符串用 ai 前缀 key：
 * - 权威来源是 webapp 的 resources/dia.txt（英文）与 dia_zh.txt（中文），
 *   随 M3 一并维护；
 * - EN_STRINGS 仅作为资源文件缺失时的兜底，且 parseResourceStrings 只注入
 *   mxResources.resources 中不存在的 key——插件运行晚于资源文件加载，
 *   无条件 parse 会用英文覆盖 dia_zh.txt 的中文值；
 * - t(key, fallbackEn) 用于动态取值场景。
 */

export const EN_STRINGS: Record<string, string> = {
  aiMindmap: 'AI',
  aiAgentPanel: 'Agent panel',
  aiAgentLive: 'live',
  aiAgentClear: 'Clear',
  aiAgentEmpty: "Waiting for a run — the agent's distilled notes, review feedback and more will stream here.",
  aiAgentNotesWord: 'notes',
  aiAgentNodesWord: 'nodes',
  aiAgentAutotune: 'Auto-tuned parameters',
  aiAgentSkeleton: 'Section skeleton',
  aiAgentReview: 'AI review',
  aiCritGrounding: 'grounding',
  aiCritCoverage: 'coverage',
  aiCritSpecificity: 'specificity',
  aiCritStructure: 'structure',
  aiAgentVerdictPass: 'PASS',
  aiAgentVerdictRevise: 'NEEDS REVISION',
  aiAgentRevising: 'Rebuilding map from review feedback...',
  aiAgentExtras: 'Composite canvas extras',
  aiAgentMinimapsWord: 'minimaps',
  aiAgentTableRowsWord: 'table rows',
  aiAgentRelationsWord: 'relations',
  aiAgentDone: 'Done',
  aiAgentDeduped: 'Auto-merged duplicate sibling nodes',
  aiAgentReviewOff: 'review off',
  aiAgentReviewPass: 'review passed',
  aiAgentReviewRevised: 'revised after review',
  aiGalleryLayingOut: 'Laying out panorama canvas...',
  aiGalleryChartsWord: 'charts',
  aiAgentMode: 'Agent mode: the model assembles the map itself with tools (mind map only, slower)',
  aiStageAgent: 'Agent is assembling the map...',
  aiAgentFixing: 'Self-check found issues; giving the agent one round to fix them...',
  aiAgentForcedStop: 'Tool-call cap reached; finalized with the current map.',
  aiAgentFailed: 'Agent run failed',
  aiAgentDoneStatus: 'Agent finished',
  aiSend: 'Send',
  aiCommandPlaceholder: 'Instruct the agent, e.g. unify the term to AI Agent',
  aiAgentNoMap: 'No AI-generated map yet — generate one first. Agent commands edit the last AI-built map.',
  aiAgentChangesDone: 'Changes applied.',
  aiGenerate: 'Generate Mind Map...',
  aiAutoParams: 'AI picks the best depth / branches / cap',
  aiStageAutotune: 'Choosing optimal parameters...',
  aiAutotuneRootNote: 'AI-chosen parameters',
  aiSourceMode: 'Source',
  aiSourceTopic: 'Topic only',
  aiSourcePaste: 'Pasted text',
  aiSourceLink: 'Link',
  aiSourceLinkField: 'Page URL',
  aiSourceLinkPlaceholder: 'https://github.com/owner/repo or article page',
  aiFetchHint: 'GitHub links are fetched directly; other sites may require the desktop version (browser CORS).',
  aiLinkInvalid: 'Please enter a valid http(s) link.',
  aiFetchingPage: 'Fetching page...',
  aiFetchFailed: 'Failed to fetch the page',
  aiFetchBrowserHint: 'the site may block cross-origin browser requests; the desktop version can fetch it.',
  aiSourceTitle: 'Title',
  aiSourceTitlePlaceholder: 'Auto-detected from the text',
  aiSourceText: 'Content',
  aiSourceTextPlaceholder: 'Paste an article, README or notes here…',
  aiSourceRequired: 'Please paste the content to analyze.',
  aiSourceTruncated: 'long source truncated, quality may be affected',
  aiStageIngest: 'Preparing source...',
  aiStageDistill: 'Distilling knowledge points',
  aiStageArchitect: 'Structuring the mind map',
  aiStageCritique: 'Reviewing quality',
  aiStageRender: 'Drawing the mind map',
  aiCancelled: 'Cancelled.',
  aiGenNoNotes: 'No knowledge points could be extracted from the source.',
  aiTooltipHint: 'After generating, hover any node to see the supporting quote from the source.',
  aiExpand: 'Expand node',
  aiExpanding: 'Expanding node...',
  aiExpandFailed: 'Failed to expand the node',
  aiExpandNoChildren: 'The AI returned no children.',
  aiChartType: 'Chart type',
  aiChartTypeMindmap: 'Mind map',
  aiChartArchitect: 'Designing the chart...',
  aiChartDirection: 'Direction',
  aiDirectionVertical: 'Vertical (top-down)',
  aiDirectionHorizontal: 'Horizontal (left-right)',
  aiShapeGallery: 'Shape gallery (AI examples)',
  aiGalleryBuilding: 'Generating shape gallery...',
  aiGalleryFail: 'Failed to generate the shape gallery',
  aiChartEdit: 'Edit this chart with AI…',
  aiChartEditApply: 'Apply',
  aiChartEditPlaceholder: 'e.g. change the start node to manual input; add an approval step; remove the XX branch…',
  aiChartEditRequired: 'Please describe the change you want.',
  aiChartEditing: 'Editing the chart...',
  aiChartEditFailed: 'Failed to edit the chart',
  aiTopic: 'Topic',
  aiTopicPlaceholder: 'e.g. Coffee supply chain',
  aiDepth: 'Depth',
  aiMaxChildren: 'Branches per node',
  aiMaxNodes: 'Max nodes',
  aiOutputLang: 'Label language',
  aiLangAuto: 'Auto (follow topic)',
  aiLayout: 'Layout',
  aiLayoutRadial: 'Radial',
  aiLayoutTree: 'Tree (horizontal)',
  aiLayoutTreeVertical: 'Tree (vertical)',
  aiReplace: 'Replace existing mind map on the canvas',
  aiGenerateBtn: 'Generate',
  aiGenerating: 'Generating mind map...',
  aiNoKey: 'No API key configured.',
  aiOpenSettings: 'Open Settings',
  aiTopicRequired: 'Please enter a topic.',
  aiGenInvalidRange: 'Please check the numeric ranges (depth 1-6, branches 1-10, nodes 5-200).',
  aiGenSchema: 'The AI reply could not be parsed as a mind map. Raw reply:',
  aiGenBuildFail: 'Failed to draw the mind map',
  aiDemo: 'Demo Mind Map',
  aiSettings: 'Settings...',
  aiBaseUrl: 'Base URL',
  aiApiKey: 'API Key',
  aiModel: 'Model',
  aiTemperature: 'Temperature',
  aiTestConnection: 'Test Connection',
  aiSave: 'Save',
  aiStorageNoticeBrowser:
    'The API key is stored in this browser (localStorage) without encryption. The desktop version will use encrypted storage.',
  aiStorageNoticeElectron: 'The API key will be stored with system-level encryption.',
  aiTestingConn: 'Testing connection...',
  aiConnNoKey: 'Please enter an API key first.',
  aiConnOk: 'Connection successful',
  aiConnHttp: 'The API returned an error',
  aiConnTimeout: 'Connection timed out',
  aiConnNetwork: 'Network error',
  aiSaveFailed: 'Failed to save the API key',
  aiTemperatureRange: 'Temperature must be a number between 0 and 2.',
};

export function t(key: string, fallbackEn: string): string {
  // 非 drawio 环境(单元测试/Node)无 mxResources,直接用兜底文案
  if (typeof mxResources === 'undefined') return fallbackEn;
  const value = mxResources.get(key, null, fallbackEn);
  return value != null ? String(value) : fallbackEn;
}

export function parseResourceStrings(): void {
  const bundles = mxResources.resources as Record<string, string> | undefined;
  const lines: string[] = [];
  for (const key of Object.keys(EN_STRINGS)) {
    if (bundles == null || bundles[key] == null) {
      lines.push(`${key}=${EN_STRINGS[key]}`);
    }
  }
  if (lines.length > 0) {
    mxResources.parse(lines.join('\n'));
  }
}
// 图表类型(名称取自 charts/catalog 中文常量,不重复维护 i18n)
