require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');

// Ensure critical environment variables are present at startup
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not defined in your environment variables!');
    process.exit(1);
}
if (!process.env.ABLITERATION_API_KEY) {
    console.error('❌ ERROR: ABLITERATION_API_KEY is not defined in your environment variables!');
    process.exit(1);
}

// Initialize the Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

// The Brain/Personality
let systemPrompt = '';
try {
    systemPrompt = fs.readFileSync('Terri.txt', 'utf8');
    if (systemPrompt.startsWith('const systemPrompt = `')) {
        systemPrompt = systemPrompt.substring('const systemPrompt = `'.length);
    }
    if (systemPrompt.endsWith('`;')) {
        systemPrompt = systemPrompt.substring(0, systemPrompt.length - '`;'.length);
    }
    systemPrompt = systemPrompt.trim();
} catch (err) {
    console.error('❌ ERROR: Could not read Terri.txt file. Make sure it exists in the folder!');
    process.exit(1);
}

// Store conversation history per channel
const conversationHistory = new Map();
const MAX_HISTORY = 6; 

// Store active conversation windows
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

            // Add new message
            if (history.length > 0 && history[history.length - 1].role === 'user') {
                history[history.length - 1].content += `\n${promptText}`;
            } else {
                history.push({ role: 'user', content: promptText });
            }

            while (history.length > MAX_HISTORY) history.shift();
            if (history.length > 0 && history[0].role === 'assistant') history.shift();

            // --- FORMATTING FOR ABLITERATION.AI ---
            // Map our simple history into their highly specific, nested JSON format
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

            // Make the raw HTTP request using built-in fetch
            const response = await fetch("https://api.abliteration.ai/v1/responses", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.ABLITERATION_API_KEY}`
                },
                body: JSON.stringify({
                    temperature: 0.8,
                    top_p: 1,
                    input: apiInput,
                    max_output_tokens: 400,
                    model: "abliterated-model",
                    include_reasoning: false, // Turned off reasoning so he doesn't output his internal thoughts in chat
                    text: { format: { type: "text" } },
                    stream: false // Turned off stream so we get one solid chunk back
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Error ${response.status}: ${errText}`);
            }

            const data = await response.json();
            
            // Extract the reply based on standard response mapping (fallback if their schema slightly varies)
            const replyText = data?.output?.text || data?.choices?.[0]?.message?.content || data?.text || "Ugh, whatever.";

            // Save the bot's reply to the history
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
