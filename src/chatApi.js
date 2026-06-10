const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export { HELIA_API_BASE };

export function buildChatApiPayload(conversation, userId) {
  const apiMessages = (conversation || []).map((m) => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const raw = m.content;
    const content =
      typeof raw === 'string'
        ? raw
        : raw == null
          ? ''
          : (() => {
              try {
                return JSON.stringify(raw);
              } catch {
                return String(raw);
              }
            })();
    return { role, content };
  });
  return { messages: apiMessages, userId };
}

function normalizeSseBuffer(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSseEventBlock(block) {
  const normalized = normalizeSseBuffer(block);
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  let eventName = 'message';
  const dataParts = [];
  for (const line of trimmed.split('\n')) {
    const lineNorm = line.replace(/\r$/, '');
    if (lineNorm.startsWith('event:')) eventName = lineNorm.slice(6).trim();
    else if (lineNorm.startsWith('data:')) dataParts.push(lineNorm.slice(5).trimStart());
  }
  const dataStr = dataParts.join('\n');
  if (!dataStr) return null;
  try {
    return { eventName, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

function processSseCarry(carry, onTextDelta, fullTextRef) {
  let fullText = fullTextRef.text;
  let sep;
  while ((sep = carry.indexOf('\n\n')) !== -1) {
    const rawBlock = carry.slice(0, sep);
    carry = carry.slice(sep + 2);
    const parsed = parseSseEventBlock(rawBlock);
    if (!parsed) continue;
    if (parsed.eventName === 'delta' && parsed.data && typeof parsed.data.text === 'string') {
      fullText += parsed.data.text;
      onTextDelta(parsed.data.text);
    } else if (parsed.eventName === 'error') {
      throw new Error(parsed.data?.message || 'Stream error');
    } else if (parsed.eventName === 'done') {
      fullTextRef.text = fullText;
      return { carry, done: true, fullText };
    }
  }
  fullTextRef.text = fullText;
  return { carry, done: false, fullText };
}

async function consumeChatSseStream(body, onTextDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  const fullTextRef = { text: '' };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        carry = normalizeSseBuffer(carry);
        const flushed = processSseCarry(carry, onTextDelta, fullTextRef);
        carry = flushed.carry;
        if (flushed.done) return fullTextRef.text;
        if (carry.trim()) {
          const lastTry = parseSseEventBlock(carry);
          if (lastTry?.eventName === 'delta' && lastTry.data?.text) {
            fullTextRef.text += lastTry.data.text;
            onTextDelta(lastTry.data.text);
          } else if (lastTry?.eventName === 'done') {
            return fullTextRef.text;
          }
        }
        return fullTextRef.text;
      }
      carry += decoder.decode(value, { stream: true });
      carry = normalizeSseBuffer(carry);
      const flushed = processSseCarry(carry, onTextDelta, fullTextRef);
      carry = flushed.carry;
      if (flushed.done) return fullTextRef.text;
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      /* ignore */
    }
  }
  return fullTextRef.text;
}

export async function streamChatFromApi(conversation, userId, onTextDelta) {
  if (!userId) throw new Error('Missing user id; cannot call chat API.');
  const resp = await fetch(`${HELIA_API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatApiPayload(conversation, userId)),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Backend error: ${resp.status} ${text}`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    throw new Error((await resp.text()) || 'Expected streaming chat response');
  }
  if (!resp.body) throw new Error('No response body from chat stream');
  return consumeChatSseStream(resp.body, onTextDelta);
}

export function formatSessionListDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  } catch {
    return '';
  }
}
