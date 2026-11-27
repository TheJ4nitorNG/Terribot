const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractReplyText, stripThinkTags, isEmptyReply } = require('../lib/response');
const { splitDiscordMessage, CHUNK_BUDGET } = require('../lib/discordMessages');

test('extractReplyText skips reasoning blocks', () => {
    const data = {
        output: [
            { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'secret' }] },
            {
                type: 'message',
                content: [{ type: 'text', text: 'literally go touch grass' }],
            },
        ],
    };
    assert.equal(extractReplyText(data), 'literally go touch grass');
});

test('extractReplyText falls back to choices', () => {
    const data = {
        choices: [{ message: { content: 'ok and?' } }],
    };
    assert.equal(extractReplyText(data), 'ok and?');
});

test('stripThinkTags removes think wrappers', () => {
    assert.equal(
        stripThinkTags('visible</think>actual reply'),
        'actual reply'
    );
    assert.equal(
        stripThinkTags('<think>secret</think>snark'),
        'snark'
    );
});

test('isEmptyReply', () => {
    assert.equal(isEmptyReply(''), true);
    assert.equal(isEmptyReply('   '), true);
    assert.equal(isEmptyReply('nah'), false);
});

test('splitDiscordMessage keeps short messages intact', () => {
    const s = 'short';
    assert.deepEqual(splitDiscordMessage(s), [s]);
});

test('splitDiscordMessage splits long text under budget', () => {
    const long = 'word '.repeat(600).trim();
    const chunks = splitDiscordMessage(long);
    assert.ok(chunks.length > 1);
    for (const c of chunks) {
        assert.ok(c.length <= CHUNK_BUDGET, `chunk length ${c.length}`);
    }
    assert.equal(chunks.join(' '), long);
});