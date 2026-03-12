import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getAllToolDefinitions } from '../tools/index.js';

// Use any for complex groq-sdk types that fail to resolve in some Vercel build environments
type ChatCompletionMessageParam = any;
type ChatCompletionTool = any;

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const FALLBACK_URL = 'https://openrouter.ai/api/v1';

async function fetchFromOpenRouter(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[]) {
  if (!env.OPENROUTER_API_KEY) throw new Error("No OpenRouter API key found");
  
  const payload: any = {
    model: env.OPENROUTER_MODEL,
    messages
  };
  
  if (tools.length > 0) {
    payload.tools = tools;
  }

  const response = await fetch(`${FALLBACK_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message;
}

async function fetchFromZai(messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[]) {
  if (!env.ZAI_API_KEY) throw new Error("No Z.ai API key found");
  
  const payload: any = {
    model: env.ZAI_MODEL,
    messages
  };
  
  if (tools.length > 0) {
    payload.tools = tools;
  }

  let endpoint = env.ZAI_API_URL.replace(/\/$/, '');
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint += '/chat/completions';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.ZAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Z.ai Error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message;
}

export async function getLLMResponse(messages: ChatCompletionMessageParam[]) {
  const definitions = getAllToolDefinitions();
  const tools: ChatCompletionTool[] = definitions.map(def => ({
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters
    }
  }));

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });
    return response.choices[0].message;
  } catch (error) {
    console.error('Groq failed, attempting fallback to OpenRouter', error);
    try {
      return await fetchFromOpenRouter(messages, tools);
    } catch (fallbackError) {
      console.error('OpenRouter fallback failed, attempting Z.ai', fallbackError);
      try {
        return await fetchFromZai(messages, tools);
      } catch (zaiError) {
        console.error('Z.ai fallback failed', zaiError);
        throw error; // Throw original Groq error to trace back
      }
    }
  }
}

export async function transcribeAudio(filePath: string): Promise<string> {
  try {
    const fs = await import('fs');
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
      response_format: 'json',
    });
    return transcription.text;
  } catch (error: any) {
    console.error('Groq transcription detailed failure:', {
      message: error.message,
      name: error.name,
      status: error.status,
      response: error.response?.data || error.error
    });
    throw new Error(`Groq says: ${error.message}`);
  }
}
