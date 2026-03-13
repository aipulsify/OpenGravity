import { env } from '../config/env.js';
import { registerTool, ToolDefinition } from '../agent/tools.js';

const API_BASE = `${env.CLIENTVERSE_API_URL}/api/opengravity/knowledge.php`;
const API_KEY = 'og_secret_default_key_2026';
const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`
};

export const ogSaveKnowledgeDef: ToolDefinition = {
  name: 'og_save_knowledge',
  description: 'Saves a fact, style preference, or document to the user\'s long-term memory (Knowledge Hub).',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'A short, descriptive title for the knowledge item.' },
      content: { type: 'string', description: 'The actual information to be remembered.' },
      category: { 
        type: 'string', 
        enum: ['fact', 'style', 'preference', 'document'],
        description: 'The type of knowledge being saved.'
      },
      telegram_id: { type: 'number', description: 'The Telegram ID of the user (provided by context).' }
    },
    required: ['topic', 'content', 'telegram_id']
  }
};

export const ogSearchKnowledgeDef: ToolDefinition = {
  name: 'og_search_knowledge',
  description: 'Searches the user\'s long-term memory for relevant facts, styles, or preferences.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search term or question to look up.' },
      category: { 
        type: 'string', 
        enum: ['fact', 'style', 'preference', 'document'],
        description: 'Optional category filter.'
      },
      telegram_id: { type: 'number', description: 'The Telegram ID of the user.' }
    },
    required: ['query', 'telegram_id']
  }
};

registerTool({
  definition: ogSaveKnowledgeDef,
  execute: async ({ topic, content, category, telegram_id }: { topic: string, content: string, category?: string, telegram_id: number }) => {
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          telegram_id,
          topic,
          content,
          category: category || 'fact'
        })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return JSON.stringify(data);
    } catch (error: any) {
      return `Error saving knowledge: ${error.message}`;
    }
  }
});

registerTool({
  definition: ogSearchKnowledgeDef,
  execute: async ({ query, category, telegram_id }: { query: string, category?: string, telegram_id: number }) => {
    try {
      let url = `${API_BASE}?telegram_id=${telegram_id}&query=${encodeURIComponent(query)}`;
      if (category) url += `&category=${category}`;

      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      if (data.items && data.items.length > 0) {
        return `Found ${data.items.length} relevant items in Long Term Memory:\n` + 
          data.items.map((item: any) => `- [${item.category}] ${item.topic}: ${item.content}`).join('\n');
      }
      return "No relevant information found in Long Term Memory.";
    } catch (error: any) {
      return `Error searching knowledge: ${error.message}`;
    }
  }
});
