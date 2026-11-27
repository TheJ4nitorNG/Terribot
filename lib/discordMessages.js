const DISCORD_MAX_LENGTH = 2000;
/** Leave room for " (continued…)" suffix when splitting. */
const CHUNK_BUDGET = 1980;

/**
 * Split text into Discord-safe chunks (≤ maxLen).
 * Prefers breaking on paragraph, line, then word boundaries.
 */
function splitDiscordMessage(text, maxLen = CHUNK_BUDGET) {
    if (!text || typeof text !== 'string') return [''];
    const trimmed = text.trim();
    if (trimmed.length <= maxLen) return [trimmed];

    const chunks = [];
    let remaining = trimmed;

    while (remaining.length > maxLen) {
        let sliceEnd = maxLen;
        const window = remaining.slice(0, maxLen);
        const breakAt = Math.max(
            window.lastIndexOf('\n\n'),
            window.lastIndexOf('\n'),
            window.lastIndexOf(' ')
        );
        if (breakAt > Math.floor(maxLen * 0.4)) {
            sliceEnd = breakAt;
        }
        const piece = remaining.slice(0, sliceEnd).trimEnd();
        if (piece.length === 0) {
            chunks.push(remaining.slice(0, maxLen));
            remaining = remaining.slice(maxLen).trimStart();
        } else {
            chunks.push(piece);
            remaining = remaining.slice(sliceEnd).trimStart();
        }
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks.length ? chunks : [''];
}

module.exports = {
    DISCORD_MAX_LENGTH,
    CHUNK_BUDGET,
    splitDiscordMessage,
};