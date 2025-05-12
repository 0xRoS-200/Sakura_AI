import axios from 'axios';
import { UserContext } from '../models/AiBotDbSchema.js';

// Function to update user conversation history
async function updateConversationHistory(userId, message, response) {
    return UserContext.findOneAndUpdate(
        { userId },
        {
            $push: {
                conversationHistory: {
                    message,
                    response,
                    timestamp: new Date(),
                },
            },
            lastActive: new Date(),
        },
        { upsert: true, new: true }
    );
}

// Controller for handling chat requests
export const chatController = async (req, res) => {
    const { message } = req.body;
    const userId = req.params.userId;
    try {
        // Fetch user context
        const userContext = await UserContext.findOne({ userId });
        const contextTokens = userContext ? userContext.contextTokens : [];

        // Send message to Gemini API
        const response = await axios.post(process.env.GEMINI_API_URL + "?key=" + process.env.GEMINI_API_KEY,
            {
                "contents": [
                    {
                        "parts": [
                            {
                                "text": message
                            }
                        ]
                    }
                ]
            }
        );

        console.log(response.data.candidates[0].content.parts.map(val=>val.text).join(" "))
        const botResponse = response.data.candidates[0].content.parts.map(val=>val.text).join(" ")

        // Save conversation history
        await updateConversationHistory(userId, message, botResponse);

        res.json({ message: botResponse });
    } catch (err) {
        console.error(err.response.data);
        res.status(500).json({ error: 'Failed to process chat' });
    }
};
