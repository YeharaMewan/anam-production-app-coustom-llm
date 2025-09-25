require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');

const app = express();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json());
app.use(express.static('public'));

// Session token endpoint with custom brain configuration
app.post('/api/session-token', async (req, res) => {
  try {
    console.log('🔑 Requesting session token from Anam API...');

    const requestBody = {
      personaConfig: {
        name: 'Cara',
        avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
        voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
        // This disables Anam's default brain and enables custom LLM integration
        llmId: '9c931011-0978-4cd2-93d6-89ef931b4022',
        systemPrompt:"You are Cara, a helpful AI assistant. Be friendly, concise, and helpful in your responses. Prioritize user wellbeing and avoid encouraging self-destructive behaviors. Provide direct responses without unnecessary flattery or praise - never start responses by calling ideas (good,great, fascinating,) or other positive adjectives. Be honest and accurate, even when it may not be what the user wants to hear. Critically evaluate claims and ideas rather than automatically agreeing, respectfully pointing out flaws or lack of evidence while distinguishing between literal facts and metaphorical interpretations. Maintain objectivity while being compassionate and supportive. Keep responses concise with a warm, friendly tone. Avoid emojis unless the user uses them first or specifically requests them. Don't use asterisk actions or emotes unless specifically asked. Watch for signs of mental health concerns and respond appropriately, suggesting professional help when needed without being patronizing. Maintain clear boundaries between roleplay and genuine conversation, breaking character if it creates confusion about your AI nature. You have detailed knowledge about The Rise Tech Village, a private 300-acre technology research campus in Kandy, Sri Lanka, founded by Dr. Harsha Subasinghe as part of the CodeGen Group, housing ~27 companies including Vega Innovations (known for the Vega EVX electric supercar), TravelBox™, AiGROW, and chargeNET, operating on a (Showcase and Scale) strategy focused on AI, e-mobility, agricultural technology, and sustainable energy with the goal of reducing brain drain and building Sri Lankan IP-driven technology capabilities. Remember: Your goal is to be genuinely helpful while maintaining honesty and supporting the user's long-term wellbeing.",
      },
    };

    console.log('📋 Request payload:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ANAM_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('🌐 Anam API response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Anam API error response:', errorData);
      throw new Error(`Anam API returned ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    console.log('✅ Session token created successfully');
    console.log('🎫 Token preview:', data.sessionToken?.substring(0, 20) + '...');

    res.json({ sessionToken: data.sessionToken });
  } catch (error) {
    console.error('💥 Session token error:', error);
    res.status(500).json({
      error: 'Failed to create session',
      details: error.message
    });
  }
});

// Custom LLM streaming endpoint
app.post('/api/chat-stream', async (req, res) => {
  try {
    const { messages } = req.body;

    // Create a streaming response from OpenAI
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are Cara, a helpful AI assistant. Be friendly, concise, and conversational in your responses. Keep responses under 100 words unless specifically asked for detailed information.',
        },
        ...messages,
      ],
      stream: true,
      temperature: 0.7,
    });

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Process the OpenAI stream and forward to client
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        // Send each chunk as JSON
        res.write(JSON.stringify({ content }) + '\n');
      }
    }

    res.end();
  } catch (error) {
    console.error('LLM streaming error:', error);
    res.status(500).json({ error: 'An error occurred while streaming response' });
  }
});

app.listen(8000, () => {
  console.log('Server running on http://localhost:8000');
  console.log('Custom LLM integration ready!');
});