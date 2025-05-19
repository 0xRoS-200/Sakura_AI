// Discord Bot with AI Integration
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`🤖 Bot is online as ${client.user.tag}`);
});

// Convert the comma-separated lists into arrays
const allowedGuildIds = process.env.ALLOWED_GUILD_IDS.split(",");
const allowedChannelNames = process.env.ALLOWED_CHANNEL_NAMES.split(",");

client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id == 1371527399749189723) return;

    // Check if the message is from an allowed server
    if (!allowedGuildIds.includes(message.guild.id)) return;

    // Check if the message is from an allowed channel
    if (!allowedChannelNames.includes(message.channel.name)) return;
    
    const userId = message.author.id;
    const userName = message.author.username;
    const userMessage = message.content;
    
    try {
        // Send the message to the AI bot server
        const response = await axios.post(`${process.env.AI_BOT_SERVER_URL}/api/chat/${userId}`, {
            message: userMessage,
            userName: userName
        });
        
        // Get the AI bot response
        const botResponse = response.data.message;
        
        // Function to safely send messages to Discord
        const sendMessageSafely = async (text) => {
            try {
                // Split messages that exceed Discord's 2000 character limit
                const chunkSize = 1990; // Slightly less than 2000 to be safe
                
                // If text is within Discord's limit, send it directly
                if (text.length <= chunkSize) {
                    await message.channel.send(text);
                    return;
                }
                
                // Otherwise, split into chunks and send multiple messages
                let chunkIndex = 0;
                const totalChunks = Math.ceil(text.length / chunkSize);
                
                for (let i = 0; i < text.length; i += chunkSize) {
                    chunkIndex++;
                    const chunk = text.substring(i, i + chunkSize);
                    
                    // Add part number to indicate this is a multi-part message
                    const prefix = totalChunks > 1 ? `[Part ${chunkIndex}/${totalChunks}] ` : '';
                    await message.channel.send(prefix + chunk);
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (err) {
                console.error('Error sending message to Discord:', err);
                // Try again with smaller chunks without showing error
                try {
                    // Use even smaller chunks
                    const smallerChunkSize = 1000;
                    for (let i = 0; i < text.length; i += smallerChunkSize) {
                        const chunk = text.substring(i, i + smallerChunkSize);
                        await message.channel.send(chunk);
                        await new Promise(resolve => setTimeout(resolve, 800));
                    }
                } catch (finalErr) {
                    console.error('Failed to send even with smaller chunks:', finalErr);
                    // Silent failure - we tried our best
                }
            }
        };
        
        // First message as a reply to maintain context
        try {
            // Calculate total chunks to see if we need splitting
            const chunkSize = 1990;
            const totalChunks = Math.ceil(botResponse.length / chunkSize);
            
            // First chunk as a reply
            const firstChunk = botResponse.substring(0, Math.min(botResponse.length, chunkSize));
            const remainingText = botResponse.substring(chunkSize);
            
            // If there's more content, add continuation marker
            let continuationNote = '';
            if (remainingText.length > 0) {
                continuationNote = totalChunks > 2 ? 
                    ` (continued in ${totalChunks-1} more messages)` : 
                    ' (continued in next message)';
            }
            
            await message.reply(firstChunk + continuationNote);
            
            // If there's more, send the rest as regular messages
            if (remainingText.length > 0) {
                await sendMessageSafely(remainingText);
            }
        } catch (replyErr) {
            console.error('Failed to send reply, falling back to regular messages:', replyErr);
            // If reply fails, send everything as regular messages
            await sendMessageSafely(botResponse);
        }
        
    } catch (err) {
        console.error('Error communicating with AI bot server:', err.response || err);
        try {
            await message.reply('Sorry, I am having trouble responding right now. Please try again later.');
        } catch (finalErr) {
            console.error('Failed to send error message:', finalErr);
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);