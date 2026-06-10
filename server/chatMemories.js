const { callClaude, parseJsonArrayFromClaude } = require('./healthContext');

async function fetchRecentMemories(supabase, userId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('chat_memories')
    .select('memory_text, created_at')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw new Error('Failed to fetch chat memories: ' + error.message);
  return data || [];
}

function buildMemoriesBlock(memories) {
  if (!memories.length) return '';
  const lines = memories.map((m) => {
    const when = m.created_at ? new Date(m.created_at).toLocaleDateString('en-US') : 'recently';
    return `- ${m.memory_text} (mentioned ${when})`;
  });
  return (
    'RECENT THINGS THE USER HAS MENTIONED IN CHAT (reference naturally when relevant — do not recite this list):\n' +
    lines.join('\n')
  );
}

async function extractAndStoreMemories(supabase, apiKey, userId, userMessage) {
  const text = String(userMessage || '').trim();
  if (!text || !userId) return [];

  const system = `You extract short health-related memories from a user's chat message.
Return ONLY a JSON array of strings. Each string is one concise memory in third person about the user (e.g. "Has been feeling very tired lately").
Include symptoms, feelings, concerns, struggles, or health changes they mention.
Return an empty array [] if there is nothing health-related to remember.
Do not include greetings or small talk. Max 3 memories per message.`;

  const prompt = `User message:\n${text.slice(0, 2000)}`;

  const raw = await callClaude(apiKey, system, prompt, 350);
  let memories = [];
  try {
    memories = parseJsonArrayFromClaude(raw, 'chat memories');
  } catch {
    return [];
  }

  const inserted = [];
  for (const mem of memories) {
    const memoryText = String(mem || '').trim().slice(0, 500);
    if (!memoryText) continue;

    const { data, error } = await supabase
      .from('chat_memories')
      .insert({
        user_id: userId,
        memory_text: memoryText,
        source_message: text.slice(0, 2000),
      })
      .select('id, memory_text, created_at')
      .single();

    if (!error && data) inserted.push(data);
  }

  return inserted;
}

module.exports = {
  fetchRecentMemories,
  buildMemoriesBlock,
  extractAndStoreMemories,
};
