import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAiConfig } from '../src/config/ai-config';

test('ai config: no AI_PROVIDER (or "none") means no AI, and no errors', () => {
  assert.deepEqual(readAiConfig({}), { config: null, errors: [] });
  assert.deepEqual(readAiConfig({ AI_PROVIDER: 'none', AI_MODEL: 'x' }), { config: null, errors: [] });
});

test('ai config: a preset provider fills in its address', () => {
  const { config, errors } = readAiConfig({ AI_PROVIDER: 'Gemini', AI_MODEL: 'gemini-flash', AI_API_KEY: ' key ' });
  assert.deepEqual(errors, []);
  assert.deepEqual(config, {
    provider: 'gemini',
    model: 'gemini-flash',
    apiKey: 'key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    timeoutMs: 60000,
  });
  assert.equal(readAiConfig({ AI_PROVIDER: 'groq', AI_MODEL: 'm', AI_API_KEY: 'k' }).config?.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(readAiConfig({ AI_PROVIDER: 'openrouter', AI_MODEL: 'm', AI_API_KEY: 'k' }).config?.baseUrl, 'https://openrouter.ai/api/v1');
});

test('ai config: hosted providers need a model and a key; Ollama needs no key', () => {
  assert.deepEqual(readAiConfig({ AI_PROVIDER: 'groq' }).errors, [
    'AI_MODEL is required for AI_PROVIDER=groq (a model id from the provider\'s model list)',
    'AI_API_KEY is required for AI_PROVIDER=groq',
  ]);
  const ollama = readAiConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'llama3.2' });
  assert.deepEqual(ollama.errors, []);
  assert.equal(ollama.config?.baseUrl, 'http://localhost:11434/v1');
  assert.equal(ollama.config?.apiKey, '');
});

test('ai config: claude defaults to Claude Opus 5.5 and may take its key from the Anthropic SDK', () => {
  const { config, errors } = readAiConfig({ AI_PROVIDER: 'claude' });
  assert.deepEqual(errors, []);
  assert.equal(config?.model, 'claude-opus-5-5');
  assert.equal(config?.apiKey, '');
});

test('ai config: any other OpenAI-style server works with AI_BASE_URL', () => {
  assert.deepEqual(readAiConfig({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm' }).errors, [
    'AI_BASE_URL is required for AI_PROVIDER=openai-compatible',
  ]);
  const { config } = readAiConfig({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm', AI_BASE_URL: 'http://localhost:1234/v1/' });
  assert.equal(config?.baseUrl, 'http://localhost:1234/v1');
});

test('ai config: unknown providers, bad URLs and bad timeouts are reported', () => {
  assert.match(readAiConfig({ AI_PROVIDER: 'gpt' }).errors[0], /^AI_PROVIDER must be one of gemini, groq, openrouter, ollama, claude, openai-compatible, none \(got "gpt"\)$/);
  assert.deepEqual(readAiConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'm', AI_BASE_URL: 'localhost:11434' }).errors, [
    'AI_BASE_URL must be an http or https URL (got "localhost:11434")',
  ]);
  assert.deepEqual(readAiConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'm', AI_TIMEOUT_MS: '0' }).errors, [
    'AI_TIMEOUT_MS must be a whole number of milliseconds above 0 (got "0")',
  ]);
  assert.equal(readAiConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'm', AI_TIMEOUT_MS: '90000' }).config?.timeoutMs, 90000);
});
