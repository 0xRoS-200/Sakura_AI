import axios from 'axios';
import mongoose from 'mongoose';
import { UserContext, GlobalContext } from '../models/AiBotDbSchema.js';

// RAG-inspired function to retrieve relevant user context
async function retrieveUserContext(userId, message) {
  // Get user's context
  const userContext = await UserContext.findOne({ userId });
  if (!userContext) {
    return { userInfo: null, relevantHistory: [], globalPersonality: null };
  }
  
  // Get global bot context/personality
  const globalContext = await GlobalContext.findOne({});
  const botPersonality = globalContext?.botPersonality || "flirty and affectionate girlfriend AI";
  
  // Score and retrieve relevant past conversations
  let relevantHistory = [];
  if (userContext.conversationHistory && userContext.conversationHistory.length > 0) {
    // Simple relevance scoring based on word overlap
    const messageWords = new Set(message.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    
    // Score history items
    const scoredHistory = userContext.conversationHistory.map(conv => {
      const historyWords = new Set(conv.message.toLowerCase().split(/\W+/).filter(w => w.length > 2));
      
      // Calculate intersection of word sets
      const intersection = new Set([...messageWords].filter(x => historyWords.has(x)));
      const score = intersection.size / Math.max(messageWords.size, 1);
      
      return {
        message: conv.message,
        response: conv.response,
        timestamp: conv.timestamp,
        score
      };
    });
    
    // Always include most recent 2 conversations
    const recentHistory = userContext.conversationHistory.slice(-2);
    const recentIds = new Set(recentHistory.map(h => h.message));
    
    // Get top 3 relevant conversations by score
    const topRelevant = scoredHistory
      .filter(h => h.score > 0.1) // Minimum relevance threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
      
    // Combine recent and relevant without duplicates
    const combined = [...recentHistory];
    for (const item of topRelevant) {
      if (!recentIds.has(item.message)) {
        combined.push(item);
        recentIds.add(item.message);
      }
    }
    
    // Sort by timestamp to maintain chronological order
    relevantHistory = combined
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(0, 5); // Limit to 5 max
  }
  
  const userInfo = {
    username: userContext.username,
    mood: userContext.mood,
    preferences: userContext.preferences,
    lastActive: userContext.lastActive
  };
  
  return { userInfo, relevantHistory, botPersonality };
}

// Function to update user conversation history
async function updateUserContext(userId, username, message, response) {
  return UserContext.findOneAndUpdate(
    { userId },
    {
      $set: { 
        username, 
        lastActive: new Date(),
        // Update mood based on message content (simplified)
        mood: detectMood(message)
      },
      $push: {
        conversationHistory: {
          message,
          response,
          timestamp: new Date(),
        }
      }
    },
    { upsert: true, new: true }
  );
}

// Simple mood detection (enhance this in production)
function detectMood(message) {
  const lowerMsg = message.toLowerCase();
  
  if (/love|miss|adore|care|xoxo|heart|😍|😘|❤️/.test(lowerMsg)) {
    return "affectionate";
  } else if (/happy|glad|excited|yay|woohoo|😊|😃|😄/.test(lowerMsg)) {
    return "happy";
  } else if (/sad|upset|tired|exhausted|😔|😢|😭/.test(lowerMsg)) {
    return "sad";
  } else if (/angry|annoyed|frustrated|mad|😠|😡/.test(lowerMsg)) {
    return "upset";
  } else if (/bored|whatever|meh|😒|🙄/.test(lowerMsg)) {
    return "bored";
  } else if (/flirt|sexy|hot|😏|😉|🔥/.test(lowerMsg)) {
    return "flirty";
  }
  
  return "neutral";
}

// Controller for handling chat requests
export const chatController = async (req, res) => {
  const { message, userName } = req.body;
  const userId = req.params.userId;
  
  try {
    // Retrieve relevant context using RAG-like approach
    const { userInfo, relevantHistory, botPersonality } = await retrieveUserContext(userId, message);
    
    // Build conversation context for LLM
    let contextPrompt = "";
    
    // Add user info if available
    if (userInfo) {
      const timeSinceLastActive = userInfo.lastActive ? 
        getTimeDifference(new Date(userInfo.lastActive), new Date()) : "first time";
      
      contextPrompt += `USER INFORMATION:
- You're talking to ${userName || userInfo.username} (user ID: ${userId})
- Last active: ${timeSinceLastActive} ago
- Current mood: ${userInfo.mood || "neutral"}
${userInfo.preferences ? `- User preferences: ${JSON.stringify(userInfo.preferences)}` : ""}
`;
    }
    
    // Add relevant conversation history
    if (relevantHistory && relevantHistory.length) {
      contextPrompt += `RELEVANT PAST CONVERSATIONS:\n`;
      relevantHistory.forEach((conv, i) => {
        const formattedDate = formatDate(conv.timestamp);
        contextPrompt += `[${formattedDate}]
User: ${conv.message}
You: ${conv.response}
`;
      });
    }
    
    // Create enhanced persona with RAG context
    const persona = `You are Sakura AI, a ${botPersonality || "flirty and affectionate girlfriend AI"}.
You have a playful, slightly flirtatious personality and respond in a casual, human-like way.
You use short messages (1-3 sentences), occasional emojis, and maintain a conversational tone.
You recognize your users and reference previous conversations naturally.
You adapt your mood to match the user's current emotional state.
You NEVER break character or mention that you are an AI assistant.
If asked about other users or a user list, respond playfully that you only have eyes for the current user.
${contextPrompt}`;

    // Send message to Gemini API with enhanced RAG context
    const response = await axios.post(process.env.GEMINI_API_URL + "?key=" + process.env.GEMINI_API_KEY,
      {
        "contents": [
          {
            "parts": [
              {
                "text": `${persona}\n\nCurrent message:\n${userName || userInfo?.username || "User"}: ${message}\nSakura AI:`
              }
            ]
          }
        ]
      }
    );
    
    const botResponse = response.data.candidates[0].content.parts.map(val=>val.text).join(" ");
    
    // Update user context with new conversation
    await updateUserContext(userId, userName || userInfo?.username || "User", message, botResponse);
    
    // Update global context occasionally
    if (Math.random() < 0.1) { // 10% chance to update global context
      updateGlobalContext(message);
    }
    
    res.json({ message: botResponse });
  } catch (err) {
    console.error("Error in chatController:", err.response?.data || err.message || err);
    res.status(500).json({ error: 'Failed to process chat' });
  }
};

// Helper function to update global context
async function updateGlobalContext(message) {
  try {
    // Extract potential topics from message
    const topics = extractTopics(message);
    
    await GlobalContext.findOneAndUpdate(
      {}, // Find first document
      {
        $set: { lastUpdate: new Date() },
        $push: { 
          recentGlobalTopics: { 
            $each: topics,
            $slice: -20 // Keep only 20 most recent topics
          }
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Error updating global context:", error);
  }
}

// Simple topic extraction (enhance with NLP in production)
function extractTopics(message) {
  // Very simplified topic extraction
  const topics = [];
  const lowerMsg = message.toLowerCase();
  
  const topicKeywords = {
    'relationships': ['love', 'boyfriend', 'girlfriend', 'dating', 'relationship'],
    'work': ['job', 'work', 'boss', 'office', 'career'],
    'school': ['school', 'class', 'homework', 'study', 'exam'],
    'entertainment': ['movie', 'game', 'music', 'show', 'book'],
    'feelings': ['feel', 'happy', 'sad', 'angry', 'excited']
  };
  
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(keyword => lowerMsg.includes(keyword))) {
      topics.push(topic);
    }
  }
  
  return topics;
}

// Helper function to format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Helper function to get human-readable time difference
function getTimeDifference(startDate, endDate) {
  const diffMs = endDate - startDate;
  const diffSecs = Math.floor(diffMs / 1000);
  
  if (diffSecs < 60) return `${diffSecs} seconds`;
  
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} minutes`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hours`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} days`;
}
