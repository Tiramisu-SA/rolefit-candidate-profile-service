import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiCompatibleClient } from '../src/adapters/ai/clients/openai-compatible.client';
import { ClaudeClient } from '../src/adapters/ai/clients/claude.client';

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

/** A local HTTP server standing in for the provider; `reply` decides each response. */
async function fakeProvider(reply: (res: http.ServerResponse) => void) {
  const seen: Seen = { headers: {}, body: undefined };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      Object.assign(seen, { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      reply(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { seen, baseUrl, close };
}

const sendJson = (status: number, body: unknown) => (res: http.ServerResponse) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const chatCompletion = (content: string) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1_790_000_000,
  model: 'test-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const openAiClient = (baseUrl: string, apiKey = 'secret', timeoutMs = 5000) =>
  new OpenAiCompatibleClient({ provider: 'groq', model: 'test-model', apiKey, baseUrl: `${baseUrl}/v1`, timeoutMs });

test('openai-compatible client: posts a JSON-mode chat request and returns the reply text', async () => {
  const provider = await fakeProvider(sendJson(200, chatCompletion('{"name":"Pim"}')));
  try {
    const reply = await openAiClient(provider.baseUrl).complete('Instructions', 'Resume text');
    assert.equal(reply, '{"name":"Pim"}');
    assert.equal(provider.seen.method, 'POST');
    assert.equal(provider.seen.url, '/v1/chat/completions');
    assert.equal(provider.seen.headers.authorization, 'Bearer secret');
    assert.deepEqual(provider.seen.body, {
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Instructions' },
        { role: 'user', content: 'Resume text' },
      ],
      response_format: { type: 'json_object' },
    });
  } finally {
    await provider.close();
  }
});

test('openai-compatible client: no API key means no Authorization header (Ollama)', async () => {
  const provider = await fakeProvider(sendJson(200, chatCompletion('{}')));
  try {
    await openAiClient(provider.baseUrl, '').complete('s', 'u');
    assert.equal(provider.seen.headers.authorization, undefined);
  } finally {
    await provider.close();
  }
});

test('openai-compatible client: an HTTP error is thrown with its status', async () => {
  const provider = await fakeProvider(sendJson(429, { error: { message: 'Rate limit reached' } }));
  try {
    await assert.rejects(openAiClient(provider.baseUrl).complete('s', 'u'), /HTTP 429.*Rate limit reached/);
  } finally {
    await provider.close();
  }
});

test('openai-compatible client: a reply without message text is an error', async () => {
  const provider = await fakeProvider(sendJson(200, { ...chatCompletion(''), choices: [] }));
  try {
    await assert.rejects(openAiClient(provider.baseUrl).complete('s', 'u'), /no message text/);
  } finally {
    await provider.close();
  }
});

test('openai-compatible client: a provider that never answers times out', async () => {
  const provider = await fakeProvider(() => {}); // never responds
  try {
    await assert.rejects(openAiClient(provider.baseUrl, 'k', 100).complete('s', 'u'), /timed out after 100 ms/);
  } finally {
    await provider.close();
  }
});

// --- Claude (Anthropic SDK) ----------------------------------------------------

const claudeMessage = (stopReason: string, text: string | null) => ({
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  // Claude Opus 5.5 always thinks; only the text block is the answer.
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...(text === null ? [] : [{ type: 'text', text, citations: null }])],
  stop_reason: stopReason,
  stop_sequence: null,
  stop_details: stopReason === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: 'Declined' } : null,
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

const claudeClient = (baseUrl: string) =>
  new ClaudeClient({ provider: 'claude', model: 'claude-opus-5-5', apiKey: 'secret', baseUrl, timeoutMs: 5000 });

test('claude client: sends the instructions as the system prompt and returns the text block', async () => {
  const provider = await fakeProvider(sendJson(200, claudeMessage('end_turn', '{"name":"Pim"}')));
  try {
    const reply = await claudeClient(provider.baseUrl).complete('Instructions', 'Resume text');
    assert.equal(reply, '{"name":"Pim"}');
    assert.equal(provider.seen.url, '/v1/messages');
    assert.equal(provider.seen.headers.authorization, 'Bearer secret');
    assert.match(String(provider.seen.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    assert.equal(provider.seen.body.model, 'claude-opus-5-5');
    assert.equal(provider.seen.body.system, 'Instructions');
    assert.deepEqual(provider.seen.body.messages, [{ role: 'user', content: 'Resume text' }]);
    assert.equal(provider.seen.body.fallbacks, 'default');
  } finally {
    await provider.close();
  }
});

test('claude client: a declined request is an error', async () => {
  const provider = await fakeProvider(sendJson(200, claudeMessage('refusal', null)));
  try {
    await assert.rejects(claudeClient(provider.baseUrl).complete('s', 'u'), /declined/);
  } finally {
    await provider.close();
  }
});
