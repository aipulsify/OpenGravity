import type { VercelRequest, VercelResponse } from '@vercel/node';
import { webhookCallback } from 'grammy';
import { bot } from '../src/bot/telegram.js';
import { initDatabase } from '../src/memory/api.js';

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
}

const handler = async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    res.status(200).send('OpenGravity Webhook is running.');
    return;
  }

  await ensureInit();
  const cb = webhookCallback(bot, 'express');
  await cb(req as any, res as any);
};

export default handler;
