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

  // Debug logs before handing off
  console.log('--- DEBUG ENV VARS ---');
  console.log('GOG_TOKEN_JSON present:', !!process.env.GOG_TOKEN_JSON);
  try {
    const update = req.body;
    
    if (update) {
      // Process the message fully before Vercel closes the connection
      await bot.handleUpdate(update);
    }
    
    // Only acknowledge Telegram after our bot has finished or failed internally
    res.status(200).send('OK');
  } catch (err: any) {
    console.error('Webhook Error:', err.message);
    res.status(200).send('OK'); // Still send 200 so Telegram doesn't retry infinitely
  }
};

export default handler;
