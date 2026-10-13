import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { redactApiKey } from './jsonParser.js';

/**
 * Prioritized official Gemini models for travel plan generation.
 * Order:
 * 1. gemini-3-flash-preview (Fast, current official flash preview)
 * 2. gemini-3.8-flash (High quality flash model)
 * 3. gemini-3.5-flash (Low latency, high throughput)
 * 4. gemini-3.6-flash (Fast, verified GA)
 * 5. gemini-flash-latest (Alias fallback)
 */
export const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-flash-latest'
] as const;

export type GeminiModelName = typeof GEMINI_MODELS[number];

export interface GeminiCallMetrics {
  model: string;
  durationMs: number;
  totalAttempts: number;
}

export interface CallGeminiOptions {
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
  correlationId?: string;
}

export interface CallGeminiResult {
  text: string;
  metrics: GeminiCallMetrics;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini API with user prompt and system instruction.
 * Iterates through GEMINI_MODELS in priority order.
 * - 404 / 400 errors move immediately to next model.
 * - 429 quota exhaustion (RESOURCE_EXHAUSTED) moves immediately to next candidate model without retry delay.
 * - Transient 429 / 503 errors retry with bounded backoff (1s) before moving to next model.
 * - API keys and credentials are strictly redacted from all error messages and logs.
 * - Uses a cumulative 60-second budget across all model attempts to respect Render's
 *   100-second gateway timeout. Each individual fetch gets a 15-second cap (min 3s).
 */
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  optionsOrFetchFn: typeof fetch | CallGeminiOptions = fetch
): Promise<CallGeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('MISSING_KEY');
  }

  const options: CallGeminiOptions = typeof optionsOrFetchFn === 'function'
    ? { fetchFn: optionsOrFetchFn }
    : (optionsOrFetchFn || {});

  const fetchFn = options.fetchFn || fetch;
  const correlationId = options.correlationId || 'direct';
  const maxOutputTokens = options.maxOutputTokens || 4096;

  const MAX_RETRIES_PER_MODEL = 2;
  const CUMULATIVE_BUDGET_MS = 60000;
  const MIN_REQUEST_TIMEOUT_MS = 3000;
  const ATTEMPT_TIMEOUT_MS = 15000; // 15s max per individual model attempt to prevent long hangs
  const cascadeStart = Date.now();
  let lastError = '';
  let totalAttemptsCount = 0;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
      maxOutputTokens
    }
  };

  const configuredModel = process.env.GEMINI_MODEL?.trim() as GeminiModelName | undefined;
  const modelsToTry: GeminiModelName[] = configuredModel && (GEMINI_MODELS as readonly string[]).includes(configuredModel)
    ? [configuredModel, ...GEMINI_MODELS.filter((m) => m !== configuredModel)]
    : [...GEMINI_MODELS];

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      totalAttemptsCount++;
      const elapsed = Date.now() - cascadeStart;
      const remainingMs = CUMULATIVE_BUDGET_MS - elapsed;
      if (remainingMs <= 0) {
        lastError = `Cumulative timeout budget (${CUMULATIVE_BUDGET_MS / 1000}s) exhausted after ${Math.round(elapsed / 1000)}s.`;
        console.warn(`[Gemini][${correlationId}] ${lastError} Stopping cascade.`);
        throw new Error(`All Gemini models unavailable. Last error: ${lastError}`);
      }
      const requestTimeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, Math.max(remainingMs, MIN_REQUEST_TIMEOUT_MS));

      const attemptStart = Date.now();
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        console.log(`[Gemini][${correlationId}] Attempting ${model} (attempt ${attempt}/${MAX_RETRIES_PER_MODEL}, timeout: ${Math.round(requestTimeoutMs / 1000)}s)...`);

        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(requestTimeoutMs)
        });

        if (response.ok) {
          const data: any = await response.json();
          const candidate = data.candidates?.[0];
          const text = candidate?.content?.parts?.[0]?.text;

          if (!text || typeof text !== 'string') {
            throw new Error('Empty response from model');
          }

          const attemptDuration = Date.now() - attemptStart;
          const totalDuration = Date.now() - cascadeStart;
          console.log(
            `[Gemini][${correlationId}] Success with ${model} on attempt ${attempt} (${text.length} chars, duration: ${attemptDuration}ms, total elapsed: ${Math.round(totalDuration / 1000)}s)`
          );

          return {
            text,
            metrics: {
              model,
              durationMs: attemptDuration,
              totalAttempts: totalAttemptsCount
            }
          };
        }

        const errorData: any = await response.json().catch(() => ({}));
        const rawErrorMsg = errorData?.error?.message || response.statusText || 'Unknown error';
        const sanitizedErrorMsg = redactApiKey(rawErrorMsg, apiKey);
        lastError = `${model} (${response.status}): ${sanitizedErrorMsg}`;

        // Case 1: Model not found (404) or invalid argument (400) -> move immediately to next model
        if (response.status === 404 || response.status === 400) {
          console.warn(`[Gemini][${correlationId}] ${model} returned ${response.status} (${sanitizedErrorMsg}), skipping to next candidate model.`);
          break; // break retry loop for this model
        }

        const rawStatus = errorData?.error?.status || '';
        const isQuotaExhausted = response.status === 429 && (
          rawStatus === 'RESOURCE_EXHAUSTED' ||
          sanitizedErrorMsg.includes('RESOURCE_EXHAUSTED') ||
          sanitizedErrorMsg.toLowerCase().includes('quota')
        );

        // Case 2: Daily Quota Exhaustion (429 RESOURCE_EXHAUSTED) -> move immediately to next model without wasting time retrying
        if (isQuotaExhausted) {
          console.warn(`[Gemini][${correlationId}] ${model} daily quota exhausted (429), skipping immediately to next candidate model.`);
          break; // break retry loop for this model
        }

        // Case 3: Transient rate limit (429) or Service Unavailable / Overloaded (503 / 500) -> retry with backoff
        if (response.status === 429 || response.status === 503 || response.status === 500) {
          if (attempt < MAX_RETRIES_PER_MODEL) {
            const reason = response.status === 429 ? 'transient rate limit' : 'high demand';
            console.warn(`[Gemini][${correlationId}] ${model} returned ${response.status} (${reason}), retrying in 1s...`);
            await sleep(1000);
            continue;
          } else {
            console.warn(`[Gemini][${correlationId}] ${model} returned ${response.status} on final attempt, moving to next model.`);
            break;
          }
        }

        // Other status codes -> break and try next model
        console.warn(`[Gemini][${correlationId}] ${model} returned ${response.status}: ${sanitizedErrorMsg}`);
        break;

      } catch (err: any) {
        const attemptDuration = Date.now() - attemptStart;
        const rawErrMsg = err?.name === 'TimeoutError'
          ? `Individual attempt timed out after ${Math.round(attemptDuration / 1000)}s`
          : (err?.message || 'Network error');
        const sanitizedErrMsg = redactApiKey(rawErrMsg, apiKey);
        lastError = `${model} attempt ${attempt} failed: ${sanitizedErrMsg}`;

        if (err?.name === 'TimeoutError' || rawErrMsg.includes('abort') || rawErrMsg.includes('timeout')) {
          console.warn(`[Gemini][${correlationId}] ${model} timed out, moving to next candidate model.`);
          break;
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          console.warn(`[Gemini][${correlationId}] ${model} network error (${sanitizedErrMsg}), retrying in 1s...`);
          await sleep(1000);
          continue;
        } else {
          console.warn(`[Gemini][${correlationId}] ${model} exhausted retries, moving to next model.`);
          break;
        }
      }
    }
  }

  throw new Error(`All Gemini models unavailable. Last error: ${lastError}`);
}
