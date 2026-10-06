import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const apiKey = process.env.GEMINI_API_KEY?.trim();

async function listAndTestAll() {
  if (!apiKey) return;
  
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const listRes = await fetch(listUrl, { signal: AbortSignal.timeout(5000) });
  const data = await listRes.json();
  const models = data.models
    .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
    .map((m: any) => m.name.replace('models/', ''));
  
  models.unshift('gemini-3.1-pro');
  
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '{"response":"OK"}' }] }] }),
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        console.log(`[SUCCESS] ${model} - HTTP 200`);
      } else {
        console.log(`[FAIL] ${model} - HTTP ${response.status}`);
      }
    } catch (err: any) {
      console.log(`[ERROR] ${model} - ${err.message}`);
    }
  }
}
listAndTestAll();
