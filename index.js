require('dotenv').config();

// Ensure critical environment variables are present at startup
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: DISCORD_TOKEN is not defined in your environment variables!');
    process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY is not defined in your environment variables!');
    process.exit(1);
}

const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');

// Initialize the Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

// Initialize Gemini with the explicit API key to guarantee it loads correctly
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const fs = require('fs');
// The Brain/Personality
let systemPrompt = fs.readFileSync('const systemPrompt = `You are an AI.txt', 'utf8');

// Clean up any JS syntax if the file was saved as a JS string literal
if (systemPrompt.startsWith('const systemPrompt = `')) {
    systemPrompt = systemPrompt.substring('const systemPrompt = `'.length);
}
if (systemPrompt.endsWith('`;')) {
    systemPrompt = systemPrompt.substring(0, systemPrompt.length - '`;'.length);
}
systemPrompt = systemPrompt.trim();

// Store conversation history per channel
const conversationHistory = new Map();
const MAX_HISTORY = 50; // Keeps the last 50 messages for context

// Store active conversation windows to allow back-and-forth without tagging/naming
const activeConversations = new Map();

client.once('ready', () => {
    console.log(`💅 ${client.user.tag} is online and already judging everyone.`);
});

client.on('messageCreate', async (message) => {
    // Ignore messages from other bots
    if (message.author.bot) return;

    const channelId = message.channel.id;

    // Check if the message is a reply to the bot
    let isReplyToBot = false;
    if (message.reference && message.reference.messageId) {
        try {
            const referencedMessage = message.referencedMessage || await message.channel.messages.fetch(message.reference.messageId);
            if (referencedMessage && referencedMessage.author.id === client.user.id) {
                isReplyToBot = true;
            }
        } catch (err) {
            console.error('Failed to fetch referenced message:', err);
        }
    }

    // Determine if Terri is being spoken to (directly mentioned, named, or replied to)
    const directlyMentioned = message.mentions.has(client.user);
    const mentionsName = /\bterri\b/i.test(message.content);

    // Check if there is an active ongoing conversation in this channel
    let isOngoingConversation = false;
    const convo = activeConversations.get(channelId);
    
    if (convo) {
        const timePassed = Date.now() - convo.lastSpeechTimestamp;
        // If it's been less than 90 seconds (1.5 minutes) and fewer than 3 messages have passed
        if (timePassed < 35000 && convo.userMessageCount < 3) {
            isOngoingConversation = true;
            convo.userMessageCount++;
        } else {
            // Conversation has gone cold
            activeConversations.delete(channelId);
        }
    }

    if (directlyMentioned || mentionsName || isReplyToBot || isOngoingConversation) {
        
        // Show the typing indicator
        await message.channel.sendTyping();

        try {
            // Strip the bot's @mention out of the message
            let userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();

            // If the message starts with "terri", let's strip it clean so the AI gets a clean prompt
            if (userMessage.toLowerCase().startsWith('terri')) {
                userMessage = userMessage.slice(5).replace(/^[,.:\s]+/, '').trim();
            }

            // Prefix the message with the user's name so the AI knows who is speaking
            const promptText = `[${message.author.username}]: ${userMessage}`;
            
            // Initialize history for this channel if it doesn't exist
            if (!conversationHistory.has(channelId)) {
                conversationHistory.set(channelId, []);
            }
            const history = conversationHistory.get(channelId);

            // Add the new message to the history. 
            // The Gemini API requires alternating roles (user -> model -> user).
            // If the last message was also from a user, we merge them to prevent errors.
            if (history.length > 0 && history[history.length - 1].role === 'user') {
                history[history.length - 1].parts[0].text += `\n${promptText}`;
            } else {
                history.push({ role: 'user', parts: [{ text: promptText }] });
            }

            // Keep history array within our maximum limit
            while (history.length > MAX_HISTORY) {
                history.shift();
            }
            // Gemini API strictly requires the conversation to start with a 'user' role
            if (history.length > 0 && history[0].role === 'model') {
                history.shift();
            }

            // Send the entire conversation history to Gemini
            const response = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: history,
                config: {
                    systemInstruction: systemPrompt,
                    temperature: 0.8, // Maximum sass
                }
            });

            const replyText = response.text;

            // Save the bot's reply to the history
            if (history.length > 0 && history[history.length - 1].role === 'model') {
                history[history.length - 1].parts[0].text += `\n${replyText}`;
            } else {
                history.push({ role: 'model', parts: [{ text: replyText }] });
            }

            // Send the reply to Discord
            await message.reply(replyText);

            // Mark/Refresh the conversation as active so he stays involved in back-and-forth
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

// Wake him up
client.login(process.env.DISCORD_TOKEN);
