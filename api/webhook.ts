import type { VercelRequest, VercelResponse } from '@vercel/node';
import { webhookCallback } from 'grammy';
import { bot } from '../src/bot/telegram.js';
import { initDatabase } from '../src/memory/api.js';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await initDatabase();
    await bot.init();
    initialized = true;
  }
}

const handler = async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    res.status(200).send('OpenGravity Webhook is running.');
    return;
  }

  await ensureInit();

  try {
    const update = req.body;
    console.log('Received Telegram Update:', JSON.stringify(update));
    console.log('--- DEBUG ENV VARS ---');
    console.log('GOG_TOKEN_JSON present:', !!process.env.GOG_TOKEN_JSON);
    console.log('GOG_CLIENT_CREDENTIALS_JSON present:', !!process.env.GOG_CLIENT_CREDENTIALS_JSON);
    console.log('GOG_ACCOUNT:', process.env.GOG_ACCOUNT);
    console.log('----------------------');
    
    if (update) {
      await bot.handleUpdate(update);
    }
  } catch (err: any) {
    console.error('Error handling update:', err.message);
  } finally {
    // Vercel requires sending a response to terminate the function cleanly
    res.status(200).send('OK');
  }
};

export default handler;
