// One-shot: write mindmapAI settings via CDP, then close the app gracefully.
const port = 9222;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find(t => t.type === 'page' && /webapp\/index\.html/.test(t.url));
if (page == null) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
await evalJs(`window.localStorage.setItem('mindmapAI.settings.v1', JSON.stringify({version:1, settings:{baseUrl:'http://127.0.0.1:8787', model:'mock-model', temperature:0.3}})); true`);
console.log('settings written:', await evalJs(`window.localStorage.getItem('mindmapAI.settings.v1')`));
await send('Browser.close');
setTimeout(() => process.exit(0), 3000);
