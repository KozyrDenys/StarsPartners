const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:latest';

async function ollamaGenerate(prompt, opts = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt must be a non-empty string');
  }

  const model = opts.model || OLLAMA_MODEL;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  return (data.response || '').trim();
}

// алиас, чтобы можно было вызывать как ollamaChat(...)
const ollamaChat = ollamaGenerate;

module.exports = { ollamaGenerate, ollamaChat };
