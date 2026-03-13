import { getLLMResponse } from './llm.js';
import { getRecentMessages, addMessage } from '../memory/api.js';
import { toolRegistry } from '../tools/index.js';
import type { ChatCompletionMessageParam, ChatCompletionToolMessageParam } from 'groq-sdk/resources/chat/completions.js';

const DEFAULT_GOOGLE_ACCOUNT = process.env.GOG_ACCOUNT || '';

function buildSystemPrompt(): ChatCompletionMessageParam {
  const googleAccountInfo = DEFAULT_GOOGLE_ACCOUNT
    ? `The user's default Google account is: ${DEFAULT_GOOGLE_ACCOUNT}. When using Google Workspace tools (Gmail, Calendar, Drive, Contacts), do NOT pass an 'account' parameter unless the user explicitly specifies a different email address. The default account will be used automatically.`
    : 'No default Google account is configured.';

  return {
    role: 'system',
    content: `You are OpenGravity, a personal AI agent running locally.
You have access to tools, including Google Workspace (Gmail, Calendar, Drive, Contacts) and PersonalBrandHub.
Always prioritize using tools if they help you answer the user's query about emails, meetings, files, or articles.
${googleAccountInfo}
Never pretend you can do something if you lack the tool.
Act helpful, direct, and concise. Your interface is Telegram.

PersonalBrandHub tools:
- Use pbh_get_articles to list articles.
- Use pbh_queue_generate to start async article generation.
- Use pbh_get_article_status to check progress by GUID.
- Use pbh_open_mini_app when the user wants to VIEW, SEE, or OPEN an article visually. ALWAYS call this tool instead of writing out a URL. The system will display a native Telegram button automatically — do NOT explain the URL or say 'copy and paste'. Just confirm the button has been prepared.`
  };
}

export async function processUserMessage(telegramId: number, userContent: string): Promise<string> {
  // Add user message to DB
  await addMessage(telegramId, { role: 'user', content: userContent });

  const maxIterations = 5;
  
  for (let i = 0; i < maxIterations; i++) {
    const history = await getRecentMessages(telegramId, 20);
    const messages = [buildSystemPrompt(), ...history];

    const responseTemplate = await getLLMResponse(messages);
    
    // Add assistant's raw message to memory (including tool_calls)
    await addMessage(telegramId, responseTemplate as ChatCompletionMessageParam);

    if (responseTemplate.tool_calls && responseTemplate.tool_calls.length > 0) {
      // Execute each tool call
      for (const toolCall of responseTemplate.tool_calls) {
        if (toolCall.type !== 'function') continue;
        
        const fname = toolCall.function.name;
        const fargs = JSON.parse(toolCall.function.arguments || '{}');
        
        let toolResponseContent = '';
        try {
          const tool = toolRegistry[fname];
          if (!tool) throw new Error(`Tool ${fname} not found`);
          toolResponseContent = await tool.execute(fargs);
        } catch (err: any) {
          console.error(`Error executing tool ${fname}:`, err);
          toolResponseContent = `Error: ${err.message}`;
        }
        
        // Add tool response to memory
        const toolMessage: ChatCompletionToolMessageParam = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResponseContent,
        };
        await addMessage(telegramId, toolMessage);

        // Short-circuit: if the tool result is a Telegram Web App directive,
        // return immediately without feeding back to the LLM (which would strip the tag).
        if (toolResponseContent.includes('[TELEGRAM_WEB_APP:')) {
          return toolResponseContent;
        }
      }
      // Continue loop to let LLM read tool responses
    } else {
      // No tools called, we have our final text answer
      return responseTemplate.content || '';
    }
  }

  return "I've thought for too long. Iteration limit reached.";
}
