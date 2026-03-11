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
  console.log('GOG_CLIENT_CREDENTIALS_JSON present:', !!process.env.GOG_CLIENT_CREDENTIALS_JSON);
  console.log('----------------------');

  // Let grammy handle the lifecycle and response cleanly
  const cb = webhookCallback(bot, 'express');
  return cb(req as any, res as any);
};

export default handler;
