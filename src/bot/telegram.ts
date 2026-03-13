import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../config/env.js';
import { processUserMessage } from '../agent/loop.js';
import { transcribeAudio } from '../agent/llm.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { markdownToTelegramHtml } from '../utils/format.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Auth middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  
  if (!env.TELEGRAM_ALLOWED_USER_IDS.includes(ctx.from.id)) {
    console.warn(`Unauthorized access attempt from user ID: ${ctx.from.id}`);
    await ctx.reply("Sorry, you are not authorized to use this bot.");
    return;
  }
  
  await next();
});

bot.command('start', async (ctx) => {
  await ctx.reply("Hello! I am OpenGravity. How can I help you today?");
});

/**
 * Extracts [TELEGRAM_WEB_APP:URL] from text and returns cleaned text + URL.
 */
function parseWebApp(text: string): { cleanText: string; webAppUrl: string | null } {
  const regex = /\[TELEGRAM_WEB_APP:(https?:\/\/[^\]]+)\]/;
  const match = text.match(regex);
  if (match) {
    const webAppUrl = match[1];
    const cleanText = text.replace(regex, '').trim();
    return { cleanText, webAppUrl };
  }
  return { cleanText: text, webAppUrl: null };
}

// Handle text messages
bot.on('message:text', async (ctx) => {
  try {
    // Show typing status
    await ctx.replyWithChatAction('typing');
    
    if(!ctx.from) return;

    const response = await processUserMessage(ctx.from.id, ctx.message.text);
    const { cleanText, webAppUrl } = parseWebApp(response);
    
    const replyOptions: any = { parse_mode: 'HTML' };
    if (webAppUrl) {
      replyOptions.reply_markup = new InlineKeyboard().webApp("Ver Artículo 🖋️", webAppUrl);
    }
    
    // Telegram requires non-empty text even when an inline keyboard is attached
    const textToSend = cleanText || (webAppUrl ? '👇 Toca el botón para abrir el artículo:' : '');

    try {
      const htmlResponse = markdownToTelegramHtml(textToSend);
      await ctx.reply(htmlResponse || textToSend, replyOptions);
    } catch (parseError) {
      console.warn('Failed to send HTML format, falling back to plain text:', parseError);
      await ctx.reply(textToSend, replyOptions);
    }
  } catch (error) {
    console.error('Error processing message:', error);
    await ctx.reply("Sorry, I encountered an internal error while processing that request.");
  }
});

// Handle voice messages
bot.on(['message:voice', 'message:audio'], async (ctx) => {
  let tempPath = '';
  try {
    await ctx.replyWithChatAction('typing');
    
    if (!ctx.from) return;

    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    // Download file
    const response = await fetch(fileUrl);
    if (!response.ok) {
        throw new Error(`Failed to download file from Telegram: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const tempDir = join(tmpdir(), 'opengravity');
    if (!existsSync(tempDir)) mkdirSync(tempDir);
    
    // Telegram voice extension is usually .oga (ogg with opus)
    // Whisper supports .ogg, .mp3, .wav, .m4a
    // Let's force a more standard extension if it's .oga
    let extension = file.file_path?.split('.').pop() || 'oga';
    if (extension === 'oga') extension = 'ogg'; 
    
    tempPath = join(tempDir, `${Date.now()}.${extension}`);
    writeFileSync(tempPath, buffer);

    // Transcribe
    const transcription = await transcribeAudio(tempPath);
    
    if (!transcription || transcription.trim().length === 0) {
      await ctx.reply("I couldn't hear anything in that audio.");
      return;
    }

    await ctx.reply(`Transcribed: _${transcription}_`, { parse_mode: 'Markdown' });

    // Process transcription as a normal message
    const botResponse = await processUserMessage(ctx.from.id, transcription);
    const { cleanText, webAppUrl } = parseWebApp(botResponse);
    
    const replyOptions: any = { parse_mode: 'HTML' };
    if (webAppUrl) {
      replyOptions.reply_markup = new InlineKeyboard().webApp("Ver Artículo 🖋️", webAppUrl);
    }

    // Telegram requires non-empty text even when an inline keyboard is attached
    const textToSend = cleanText || (webAppUrl ? '👇 Toca el botón para abrir el artículo:' : '');

    try {
      const htmlResponse = markdownToTelegramHtml(textToSend);
      await ctx.reply(htmlResponse || textToSend, replyOptions);
    } catch (parseError) {
      console.warn('Failed to send HTML format, falling back to plain text:', parseError);
      await ctx.reply(textToSend, replyOptions);
    }

  } catch (error: any) {
    console.error('Error processing voice message:', error);
    // Explicitly log the Groq error details if available
    if (error.response && error.response.data) {
        console.error('Groq Error Details:', error.response.data);
    }
    await ctx.reply(`Sorry, I couldn't process your voice message. Error: ${error.message}`);
  } finally {
    if (tempPath && existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  }
});
