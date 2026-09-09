// ==================== MindmapAI (AI mind map plugin) ====================
// Secrets are stored in userData/mm-ai-secrets.json. When the OS keyring is
// available (Windows target) the key is safeStorage-encrypted; otherwise the
// file keeps it in plaintext with encrypted:false (dev environments like WSL).

const mmSecretsFile = () => path.join(app.getPath('userData'), 'mm-ai-secrets.json');

function mmReadSecretsFile()
{
	try
	{
		return JSON.parse(fs.readFileSync(mmSecretsFile(), 'utf8'));
	}
	catch (e)
	{
		return null; // missing or corrupt = no secret
	}
}

function mmWriteSecretsFile(obj)
{
	fs.writeFileSync(mmSecretsFile(), JSON.stringify(obj), 'utf8');
}

async function mmGetSecret()
{
	const data = mmReadSecretsFile();

	if (data == null || data.apiKey == null)
	{
		return {apiKey: null};
	}

	if (data.encrypted)
	{
		if (!safeStorage.isEncryptionAvailable())
		{
			return {apiKey: null};
		}

		return {apiKey: safeStorage.decryptString(Buffer.from(data.apiKey, 'base64')), encrypted: true};
	}

	return {apiKey: data.apiKey, encrypted: false};
}

async function mmSetSecret(apiKey)
{
	let encrypted = false;
	let payload = apiKey;

	if (safeStorage.isEncryptionAvailable())
	{
		encrypted = true;
		payload = safeStorage.encryptString(apiKey).toString('base64');
	}

	mmWriteSecretsFile({encrypted: encrypted, apiKey: payload});
	return {ok: true, encrypted: encrypted};
}

async function mmDeleteSecret()
{
	try
	{
		fs.rmSync(mmSecretsFile(), {force: true});
	}
	catch (e)
	{
		// ignore
	}

	return {ok: true};
}

// Fetches from the main process (the renderer is CSP-restricted to 'self').
// method defaults to POST (AI API calls); GET is used by the source-fetch tool.
// Resolves {ok, status, body} for any HTTP response; resolves {ok:false,
// timeout:true} on timeout; throws on network errors (bridge error path).
async function mmAiFetch(url, headers, body, timeoutMs, method)
{
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs != null ? timeoutMs : 60000);
	const m = method != null ? method : 'POST';

	try
	{
		const resp = await fetch(url, {method: m, headers: headers, body: m === 'GET' ? undefined : body, signal: controller.signal});
		const text = await resp.text();
		return {ok: true, status: resp.status, body: text};
	}
	catch (e)
	{
		if (controller.signal.aborted)
		{
			return {ok: false, timeout: true, detail: ''};
		}

		throw e;
	}
	finally
	{
		clearTimeout(timer);
	}
}

// ==================== MindmapAI end ====================
