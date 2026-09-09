#!/usr/bin/env node
/**
 * CDP regression for the packaged MindmapAI app (M8 checklist, automated part).
 *
 * Prerequisites:
 *   1. Mock LLM server:   node ../ai/dev-mock-server.mjs        (127.0.0.1:8787)
 *   2. Packaged app:      dist/linux-unpacked/MindmapAI --remote-debugging-port=9222
 *      (or on Windows:    dist\win-unpacked\MindmapAI.exe --remote-debugging-port=9222,
 *      driven from WSL via the same script when the CDP port is reachable)
 *
 * Modes:
 *   --flow      (default) full flow: packaged-webapp check, AI menu, secret IPC
 *               round-trip, dialog-driven generation against the mock LLM.
 *   --persist   read-only check after an app restart: settings + secret survive.
 *
 * Exits 0 when every check passes, 1 otherwise.
 */

const argv = process.argv.slice(2);
const MODE = argv.includes('--persist') ? 'persist' : 'flow';
const CDP_PORT = Number((argv.find((a) => a.startsWith('--cdp=')) ?? '--cdp=9222').split('=')[1]);
const MOCK_BASE = 'http://127.0.0.1:8787';
const REG_KEY = 'mm-regression-key';

let failures = 0;
function check(name, ok, detail = '') {
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}

async function findPageTarget() {
	for (let i = 0; i < 60; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
			const page = list.find((t) => t.type === 'page' && /webapp\/index\.html/.test(t.url));
			if (page != null) return page;
		} catch { /* app not up yet */ }
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`no page target on CDP port ${CDP_PORT} after 60s`);
}

class CdpSession {
	constructor(wsUrl) {
		this.wsUrl = wsUrl;
		this.nextId = 1;
		this.pending = new Map();
	}

	open() {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(this.wsUrl);
			this.ws.onopen = resolve;
			this.ws.onerror = (e) => reject(new Error('ws error'));
			this.ws.onmessage = (ev) => {
				const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
				if (msg.id != null && this.pending.has(msg.id)) {
					const { resolve, reject } = this.pending.get(msg.id);
					this.pending.delete(msg.id);
					if (msg.error != null) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
					else resolve(msg.result);
				}
			};
		});
	}

	send(method, params = {}) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	close() {
		try { this.ws.close(); } catch { /* already gone */ }
	}
}

async function main() {
	const target = await findPageTarget();
	const cdp = new CdpSession(target.webSocketDebuggerUrl);
	await cdp.open();

	const evalJs = async (expression) => {
		const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails != null) {
			const d = r.exceptionDetails;
			throw new Error(String(d.exception?.description ?? d.text).split('\n').slice(0, 3).join(' | '));
		}
		return r.result?.value;
	};
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	if (MODE === 'flow') {
		const href = await evalJs('location.href');
		check('loads bundled webapp (resources/webapp, prod path)',
			/\/resources\/webapp\//.test(href) && href.indexOf('dev=1') < 0, href);

		check('MindmapAI plugin global present',
			await evalJs(`typeof window.MindmapAI === 'object' && window.MindmapAI.ui != null`));

		// Dismiss first-run dialogs (template picker etc.) before driving the UI.
		await evalJs(`(function(){
			var ui = window.MindmapAI.ui;
			for (var i = 0; i < 10 && ui.dialog != null; i++) { ui.hideDialog(true); }
			return true;
		})()`);

		const menuTexts = await evalJs(`Array.prototype.slice.call(
			document.querySelectorAll('.geMenubarContainer .geItem, .geMenubar .geItem'))
			.map(function (e) { return e.textContent; })`);
		check('AI menu present in menubar', Array.isArray(menuTexts) && menuTexts.some((t) => t === 'AI'),
			JSON.stringify(menuTexts));

		// Secret round-trip through the real renderer->main IPC bridge.
		const setRes = await evalJs(`new Promise(function (res, rej) {
			window.electron.request({action: 'mmAiSetSecret', apiKey: ${JSON.stringify(REG_KEY)}},
				function (d) { res(d); }, function (m) { rej(new Error(m || 'IPC error')); });
		})`);
		check('mmAiSetSecret via window.electron bridge', setRes != null && setRes.ok === true,
			JSON.stringify(setRes));
		const getRes = await evalJs(`new Promise(function (res, rej) {
			window.electron.request({action: 'mmAiGetSecret'},
				function (d) { res(d); }, function (m) { rej(new Error(m || 'IPC error')); });
		})`);
		check('mmAiGetSecret round-trip', getRes != null && getRes.apiKey === REG_KEY,
			`encrypted=${getRes?.encrypted} (Windows should be true, WSL/Linux fallback false)`);

		// Provider settings -> mock LLM.
		await evalJs(`window.localStorage.setItem('mindmapAI.settings.v1', JSON.stringify(
			{version: 1, settings: {baseUrl: ${JSON.stringify(MOCK_BASE)}, model: 'mock-model', temperature: 0.3}})); true`);

		// Open the generate dialog through the registered action, fill and submit.
		const opened = await evalJs(`(function () {
			var ui = window.MindmapAI.ui;
			var action = ui.actions.get ? ui.actions.get('aiGenerate') : ui.actions.actions['aiGenerate'];
			action.funct();
			return document.querySelectorAll('.geDialog').length;
		})()`);
		check('generate dialog opens', opened > 0);

		await evalJs(`(function () {
			var dlg = Array.prototype.slice.call(document.querySelectorAll('.geDialog')).pop();
			var input = dlg.querySelector('input[type="text"]');
			input.value = 'Coffee supply chain';
			var gen = dlg.querySelector('button.gePrimaryBtn');
			gen.click();
			return true;
		})()`);

		let vertexCount = 0;
		for (let i = 0; i < 60 && vertexCount === 0; i++) {
			await sleep(1000);
			vertexCount = await evalJs(
				`window.MindmapAI.ui.editor.graph.getChildCells(
					window.MindmapAI.ui.editor.graph.getDefaultParent(), true, false).length`);
		}
		check('generation reaches canvas via mock LLM', vertexCount >= 3, `vertices=${vertexCount}`);
	} else {
		// --persist: state written by the earlier --flow run must survive a restart.
		const href = await evalJs('location.href');
		check('app restarted on bundled webapp', /\/resources\/webapp\//.test(href), href);

		const settings = await evalJs(
			`JSON.parse(window.localStorage.getItem('mindmapAI.settings.v1') || 'null')`);
		check('settings persist across restart',
			settings?.settings?.baseUrl === MOCK_BASE, JSON.stringify(settings));

		const getRes = await evalJs(`new Promise(function (res, rej) {
			window.electron.request({action: 'mmAiGetSecret'},
				function (d) { res(d); }, function (m) { rej(new Error(m || 'IPC error')); });
		})`);
		check('API key persists across restart', getRes?.apiKey === REG_KEY,
			`encrypted=${getRes?.encrypted}`);
	}

	cdp.close();
	if (failures > 0) process.exit(1);
	console.log('ALL CHECKS PASSED');
}

main().then(
	() => process.exit(failures > 0 ? 1 : 0),
	(e) => { console.error('ERROR:', e.message); process.exit(1); }
);
