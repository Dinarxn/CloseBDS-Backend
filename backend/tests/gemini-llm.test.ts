/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import dotenv from 'dotenv';
import { testGeminiConnection } from '../src/integrations/ai/gemini.client.js';

// Load environment variables from .env
dotenv.config();

async function runGeminiConnectionTest() {
  console.log('--- Starting Gemini Isolated LLM Connection Test ---');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('[Gemini Connection Test]: GEMINI_API_KEY is missing');
    throw new Error('GEMINI_API_KEY is missing');
  }

  console.log('Dispatching isolated test prompt to Gemini API...');
  const result = await testGeminiConnection('Respond with exactly: GEMINI_CONNECTION_OK');

  assert.ok(result.text.length > 0, 'Gemini response must not be empty');
  assert.ok(
    result.text.includes('GEMINI_CONNECTION_OK'),
    `Response expected to contain "GEMINI_CONNECTION_OK", received: "${result.text}"`
  );

  console.log(`✓ Gemini connection verified successfully using model: ${result.model}`);
  console.log(`✓ Response text received: "${result.text}"`);
  console.log('--- Gemini Isolated LLM Connection Test Passed Successfully ---');
}

runGeminiConnectionTest().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  if (errorMessage.includes('GEMINI_API_KEY is missing')) {
    console.error('Test Result: GEMINI_API_KEY is missing');
  } else {
    console.error('Test Result: Gemini request failed —', errorMessage);
  }
  process.exit(1);
});
