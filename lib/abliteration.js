const DEFAULT_MODEL = 'abliterated-model-large-flash';

function parseEnvInt(name, fallback, { min, max } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
}

function parseEnvFloat(name, fallback, { min, max } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
}

function getBotConfig() {
    return {
        maxHistory: parseEnvInt('MAX_HISTORY', 8, { min: 2, max: 24 }),
        maxOutputTokens: parseEnvInt('MAX_OUTPUT_TOKENS', 450, { min: 64, max: 4096 }),
        temperature: parseEnvFloat('TEMPERATURE', 0.85, { min: 0, max: 2 }),
        topP: parseEnvFloat('TOP_P', 0.9, { min: 0, max: 1 }),
        requestTimeoutMs: parseEnvInt('REQUEST_TIMEOUT_MS', 90_000, { min: 5_000, max: 300_000 }),
        model: process.env.ABLITERATION_MODEL || DEFAULT_MODEL,
        apiRetries: parseEnvInt('API_MAX_RETRIES', 1, { min: 0, max: 3 }),
        reasoningEffort: process.env.REASONING_EFFORT ?? 'none',
    };
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /v1/responses with timeout, optional single retry on transient errors.
 */
async function callAbliteration(apiKey, apiInput, config) {
    const body = {
        temperature: config.temperature,
        top_p: config.topP,
        input: apiInput,
        max_output_tokens: config.maxOutputTokens,
        model: config.model,
        include_reasoning: false,
        text: { format: { type: 'text' } },
        stream: false,
    };

    if (config.reasoningEffort && config.reasoningEffort.toLowerCase() !== 'omit') {
        body.reasoning = { effort: config.reasoningEffort };
    }

    let lastError;
    const attempts = 1 + config.apiRetries;

    for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

        try {
            const response = await fetch('https://api.abliteration.ai/v1/responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errText = await response.text();
                const err = new Error(`API Error ${response.status}: ${errText}`);
                err.status = response.status;
                if (RETRYABLE_STATUSES.has(response.status) && attempt < attempts - 1) {
                    await sleep(800 * (attempt + 1));
                    continue;
                }
                throw err;
            }

            return await response.json();
        } catch (err) {
            lastError = err;
            const isAbort = err.name === 'AbortError';
            const retryable =
                isAbort ||
                (err.status !== undefined && RETRYABLE_STATUSES.has(err.status));
            if (retryable && attempt < attempts - 1) {
                await sleep(800 * (attempt + 1));
                continue;
            }
            if (isAbort) {
                throw new Error(`API request timed out after ${config.requestTimeoutMs}ms`);
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError || new Error('API request failed');
}

module.exports = {
    DEFAULT_MODEL,
    getBotConfig,
    callAbliteration,
    RETRYABLE_STATUSES,
};