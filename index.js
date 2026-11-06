require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');

// ensure critical env variables are present
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not defined in your environment variables!');
    process.exit(1);
}
if (!process.env.ABLITERATION_API_KEY) {
    console.error('❌ ERROR: ABLITERATION_API_KEY is not defined in your environment variables!');
    process.exit(1);
}

// initialize discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

// terri's brain
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

// store convo history per channel
const conversationHistory = new Map();
const MAX_HISTORY = 6; 

// store active convo windows
const activeConversations = new Map();

client.once('ready', () => {
    console.log(`💅 ${client.user.tag} is online, uncensored, and ready to judge.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channelId = message.channel.id;
    let isReplyToBot = false;
    
    if (message.reference && message.reference.messageId) {
        try {
            const referencedMessage = message.referencedMessage || await message.channel.messages.fetch(message.reference.messageId);
            if (referencedMessage && referencedMessage.author.id === client.user.id) {
                isReplyToBot = true;
            }
        } catch (err) {}
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

    if (directlyMentioned || mentionsName || isReplyToBot || isOngoingConversation) {
        
        await message.channel.sendTyping();

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

            // new message
            if (history.length > 0 && history[history.length - 1].role === 'user') {
                history[history.length - 1].content += `\n${promptText}`;
            } else {
                history.push({ role: 'user', content: promptText });
            }

            while (history.length > MAX_HISTORY) history.shift();
            if (history.length > 0 && history[0].role === 'assistant') history.shift();

            // map simple history into nested json format
            const apiInput = [
                {
                    role: "system",
                    type: "message",
                    content: [{ type: "input_text", text: systemPrompt }]
                },
                ...history.map(msg => ({
                    role: msg.role,
                    type: "message",
                    content: [{ type: "input_text", text: msg.content }]
                }))
            ];

            // make raw HTTP request using built in fetch
            const response = await fetch("https://api.abliteration.ai/v1/responses", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.ABLITERATION_API_KEY}`
                },
                body: JSON.stringify({
                    temperature: 0.6,
                    top_p: 0.9,
                    input: apiInput,
                    max_output_tokens: 8000, // BRUTE FORCE FIX: Give it massive space to finish thinking
                    model: "abliterated-model", 
                    text: { format: { type: "text" } },
                    stream: false 
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            // console.log("Raw API Response:", JSON.stringify(data, null, 2)); 

            let replyText = "";

            // DEEP EXTRACTION: Find the first standard text output, bypassing reasoning
            if (Array.isArray(data?.output)) {
                for (const block of data.output) {
                    if (block.type === 'reasoning') continue;
                    
                    if (block.text && typeof block.text === 'string') {
                        replyText = block.text;
                        break;
                    }
                    if (Array.isArray(block.content)) {
                        const txt = block.content.find(c => c.type === 'text' || (c.text && c.type !== 'reasoning_text'));
                        if (txt && txt.text) {
                            replyText = txt.text;
                            break;
                        }
                    }
                }
            } 
            
            if (!replyText && Array.isArray(data?.choices) && data.choices.length > 0) {
                const content = data.choices[0]?.message?.content;
                if (typeof content === 'string') {
                    replyText = content;
                }
            }

            // Absolute final safety check
            if (!replyText || typeof replyText !== 'string' || replyText.trim() === '') {
                replyText = "🙄 *stares at you in silence* (You bore me.)";
            }

            // Strip out <think> tags if they leak into the final output
            replyText = replyText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

            // save reply to history
            if (history.length > 0 && history[history.length - 1].role === 'assistant') {
                history[history.length - 1].content += `\n${replyText}`;
            } else {
                history.push({ role: 'assistant', content: replyText });
            }

            await message.reply(replyText);

            activeConversations.set(channelId, {
                lastSpeechTimestamp: Date.now(),
                userMessageCount: 0
            });

        } catch (error) {
            console.error('Ugh, an error:', error);
            message.reply("I'm a stupid fucking clanker and am not working, check the API key retard");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
