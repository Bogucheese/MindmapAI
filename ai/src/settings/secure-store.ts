/**
 * API key 存取。Promise 接口，两种实现按运行环境自动选择：
 * - Electron（window.electron 桥）：主进程 IPC（mmAiGetSecret / mmAiSetSecret /
 *   mmAiDeleteSecret），Windows 下 safeStorage 加密，落盘 userData/mm-ai-secrets.json；
 * - 浏览器：localStorage 明文（界面必须提示"未加密"）。
 */

const SECRETS_STORAGE_KEY = 'mindmapAI.secrets.v1';
const API_KEY_FIELD = 'apiKey';

export type SecretStorageMode = 'electron' | 'browser-plain';

export interface SecretStorageInfo {
  mode: SecretStorageMode;
}

/** window.electron.request 的 Promise 封装（成功走 callback(data)，失败走 error(msg)） */
function electronRequest<T>(msg: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (window as unknown as { electron: { request(msg: Record<string, unknown>, cb: (data: T) => void, err: (msg: string, e?: unknown) => void): void } })
      .electron.request(msg, (data) => resolve(data), (errMsg) => reject(new Error(errMsg != null && errMsg !== '' ? String(errMsg) : 'IPC error')));
  });
}

function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    electron?: { request?: unknown };
    process?: { type?: string };
  };
  return typeof w.electron?.request === 'function' || w.process?.type === 'renderer';
}

export function describeStorage(): SecretStorageInfo {
  return { mode: isElectron() ? 'electron' : 'browser-plain' };
}

export async function getApiKey(): Promise<string | null> {
  if (isElectron()) {
    const result = await electronRequest<{ apiKey: string | null }>({ action: 'mmAiGetSecret' });
    return result != null && result.apiKey != null && result.apiKey !== '' ? result.apiKey : null;
  }
  try {
    const raw = window.localStorage.getItem(SECRETS_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    return typeof parsed.apiKey === 'string' && parsed.apiKey !== '' ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

export async function setApiKey(apiKey: string): Promise<void> {
  if (isElectron()) {
    await electronRequest({ action: 'mmAiSetSecret', apiKey });
    return;
  }
  const payload = { [API_KEY_FIELD]: apiKey };
  window.localStorage.setItem(SECRETS_STORAGE_KEY, JSON.stringify(payload));
}

export async function clearApiKey(): Promise<void> {
  if (isElectron()) {
    await electronRequest({ action: 'mmAiDeleteSecret' });
    return;
  }
  window.localStorage.removeItem(SECRETS_STORAGE_KEY);
}
