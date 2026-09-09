import { build } from 'esbuild';

// 打包为 IIFE 挂到 window.MindmapAI，经 <script> 加载 —— 与 drawio 自身
// 依赖的加载方式一致（无 ESM、无 import map）。target 取 es2017：代码使用
// async/await（esbuild 无法将其降级到 es5），运行环境是 Electron Chromium
// 与现代浏览器，es2017 足够。
const minify = process.argv.includes('--minify');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'MindmapAI',
  target: 'es2017',
  outfile: '../webapp/src/main/webapp/js/ai/mindmap-ai.js',
  minify,
  sourcemap: minify ? false : 'inline',
  logLevel: 'info',
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
} else {
  await build(options);
}
