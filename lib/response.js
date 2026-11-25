/**
 * Extract assistant text from abliteration / OpenAI-style response payloads.
 * Skips reasoning blocks; prefers message / text output.
 */
function extractReplyText(data) {
    if (!data || typeof data !== 'object') return '';

    if (Array.isArray(data.output)) {
        for (const block of data.output) {
            if (block.type === 'reasoning') continue;

            if (block.text && typeof block.text === 'string') {
                return block.text;
            }
            if (Array.isArray(block.content)) {
                for (const part of block.content) {
                    if (part.type === 'reasoning' || part.type === 'reasoning_text') continue;
                    if (part.text && typeof part.text === 'string') {
                        return part.text;
                    }
                }
            }
        }
    }

    if (Array.isArray(data.choices) && data.choices.length > 0) {
        const content = data.choices[0]?.message?.content;
        if (typeof content === 'string') return content;
    }

    return '';
}

/** Strip common leaked chain-of-thought wrappers from model output. */
function stripThinkTags(text) {
    if (!text || typeof text !== 'string') return '';
    let out = text;
    const patterns = [
        /<think>[\s\S]*?<\/redacted_thinking>/gi,
        /<think>[\s\S]*?<\/think>/gi,
        /[\s\S]*?<\/think>/gi,
        /[\s\S]*?<\/redacted_thinking>/gi,
    ];
    for (const re of patterns) {
        out = out.replace(re, '');
    }
    return out.trim();
}

/** True when the model returned nothing usable after cleanup. */
function isEmptyReply(text) {
    return !text || typeof text !== 'string' || text.trim() === '';
}

module.exports = {
    extractReplyText,
    stripThinkTags,
    isEmptyReply,
};