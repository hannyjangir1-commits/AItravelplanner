import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const apiKey = process.env.GEMINI_API_KEY?.trim();

async function findWorkingModel() {
  if (!apiKey) return;

  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const listRes = await fetch(listUrl, { signal: AbortSignal.timeout(5000) });
  const data = await listRes.json();
  const models = data.models
    .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
    .map((m: any) => m.name.replace('models/', ''));
  
  // also inject gemini-3.1-pro
  models.unshift('gemini-3.1-pro');

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Respond with OK' }] }] }),
        signal: AbortSignal.timeout(5000)
      });
      
      let success = false;
      if (response.ok) {
        const d = await response.json();
        if (d.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.log(`FOUND WORKING MODEL: ${model}`);
          return;
        }
      }
      console.log(`- ${model}: ${response.status}`);
    } catch (err: any) {
      console.log(`- ${model}: ERROR ${err.message}`);
    }
  }
}

findWorkingModel();
