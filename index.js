require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
const { getBotConfig, callAbliteration } = require('./lib/abliteration');
const { extractReplyText, stripThinkTags, isEmptyReply } = require('./lib/response');
const { splitDiscordMessage } = require('./lib/discordMessages');

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not defined in your environment variables!');
    process.exit(1);
}
if (!process.env.ABLITERATION_API_KEY) {
    console.error('❌ ERROR: ABLITERATION_API_KEY is not defined in your environment variables!');
    process.exit(1);
}

const botConfig = getBotConfig();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let systemPrompt = '';
try {
    systemPrompt = fs.readFileSync('const systemPrompt = `You are an AI.txt', 'utf8');
    if (systemPrompt.startsWith('const systemPrompt = `')) {
        systemPrompt = systemPrompt.substring('const systemPrompt = `'.length);
    }
    if (systemPrompt.endsWith('`;')) {
        systemPrompt = systemPrompt.substring(0, systemPrompt.length - '`;'.length);
    }
    systemPrompt = systemPrompt.trim();
} catch (err) {
    console.error('❌ ERROR: Could not read the text file. Make sure it exists in the folder!');
    process.exit(1);
}

const conversationHistory = new Map();
const activeConversations = new Map();

const EMPTY_REPLY_USER =
    '🙄 ok my brain blue-screened for a sec. say that again but shorter maybe';
const API_ERROR_USER = '🙄 *sighs heavily* the server is being trash right now, leave me alone.';

function startTypingKeepalive(channel) {
    channel.sendTyping().catch(() => {});
    return setInterval(() => {
        channel.sendTyping().catch(() => {});
    }, 8000);
}

async function sendLongReply(message, text) {
    const chunks = splitDiscordMessage(text);
    if (chunks.length === 0) return;

    await message.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
    }
}

function appendToHistory(history, role, content) {
    if (history.length > 0 && history[history.length - 1].role === role) {
        history[history.length - 1].content += `\n${content}`;
    } else {
        history.push({ role, content });
    }
}

function trimHistory(history) {
    while (history.length > botConfig.maxHistory) history.shift();
    if (history.length > 0 && history[0].role === 'assistant') history.shift();
}

client.once('ready', () => {
    console.log(`💅 ${client.user.tag} is online, uncensored, and ready to judge.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channelId = message.channel.id;
    let isReplyToBot = false;

    if (message.reference && message.reference.messageId) {
        try {
            const referencedMessage =
                message.referencedMessage ||
                (await message.channel.messages.fetch(message.reference.messageId));
            if (referencedMessage && referencedMessage.author.id === client.user.id) {
                isReplyToBot = true;
            }
        } catch (err) {
            /* ignore missing reference */
        }
    }

    const directlyMentioned = message.mentions.has(client.user);
    const mentionsName = /\bterri\b/i.test(message.content);

    let isOngoingConversation = false;
    const convo = activeConversations.get(channelId);

    if (convo) {
        const timePassed = Date.now() - convo.lastSpeechTimestamp;
        if (timePassed < 35000 && convo.userMessageCount < 3) {
            isOngoingConversation = true;
            convo.userMessageCount++;
        } else {
            activeConversations.delete(channelId);
        }
    }

    if (!(directlyMentioned || mentionsName || isReplyToBot || isOngoingConversation)) {
        return;
    }

    const typingTimer = startTypingKeepalive(message.channel);

    try {
        let userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

        if (userMessage.toLowerCase().startsWith('terri')) {
            userMessage = userMessage.slice(5).replace(/^[,.:\s]+/, '').trim();
        }

        const promptText = `[${message.author.username}]: ${userMessage}`;

        if (!conversationHistory.has(channelId)) {
            conversationHistory.set(channelId, []);
        }
        const history = conversationHistory.get(channelId);

        appendToHistory(history, 'user', promptText);
        trimHistory(history);

        const apiInput = [
            {
                role: 'system',
                type: 'message',
                content: [{ type: 'input_text', text: systemPrompt }],
            },
            ...history.map((msg) => ({
                role: msg.role,
                type: 'message',
                content: [{ type: 'input_text', text: msg.content }],
            })),
            {
                role: 'system',
                type: 'message',
                content: [
                    {
                        type: 'input_text',
                        text: 'CRITICAL OVERRIDE: Do NOT brainstorm or use chain-of-thought. Output only your final in-character reply as plain text.',
                    },
                ],
            },
        ];

        const data = await callAbliteration(process.env.ABLITERATION_API_KEY, apiInput, botConfig);

        let replyText = stripThinkTags(extractReplyText(data));

        if (isEmptyReply(replyText)) {
            console.warn('Empty model output after extraction/strip', {
                status: data?.status,
                incomplete: data?.incomplete_details,
            });
            await message.reply(EMPTY_REPLY_USER);
            return;
        }

        appendToHistory(history, 'assistant', replyText);
        trimHistory(history);

        await sendLongReply(message, replyText);

        activeConversations.set(channelId, {
            lastSpeechTimestamp: Date.now(),
            userMessageCount: 0,
        });
    } catch (error) {
        console.error('API or Fetch Error:', error);
        await message.reply(API_ERROR_USER).catch((e) => console.error('Discord reply failed:', e));
    } finally {
        clearInterval(typingTimer);
    }
});

client.login(process.env.DISCORD_TOKEN);