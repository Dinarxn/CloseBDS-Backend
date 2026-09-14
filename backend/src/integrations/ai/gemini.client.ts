import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiTestResponse {
  text: string;
  model: string;
}

/**
 * Executes a minimal isolated prompt against Google Gemini.
 * Never logs, prints, or exposes the API key or raw sensitive headers.
 */
export async function testGeminiConnection(
  prompt: string = 'Respond with exactly: GEMINI_CONNECTION_OK'
): Promise<GeminiTestResponse> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: modelName });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  if (!responseText || responseText.trim().length === 0) {
    throw new Error('Gemini returned an empty response');
  }

  return {
    text: responseText.trim(),
    model: modelName,
  };
}
