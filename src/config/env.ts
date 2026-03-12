import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_USER_IDS',
  'GROQ_API_KEY',
  'CLIENTVERSE_API_URL',
  'CLIENTVERSE_API_KEY',
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS!.split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => parseInt(id, 10)),
  GROQ_API_KEY: process.env.GROQ_API_KEY!,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  ZAI_API_KEY: process.env.ZAI_API_KEY || '',
  ZAI_API_URL: process.env.ZAI_API_URL || 'https://api.z.ai/v1',
  ZAI_MODEL: process.env.ZAI_MODEL || 'meta-llama/llama-3.3-70b-instruct',
  CLIENTVERSE_API_URL: process.env.CLIENTVERSE_API_URL!,
  CLIENTVERSE_API_KEY: process.env.CLIENTVERSE_API_KEY!,
  PERSONAL_BRAND_HUB_URL: process.env.PERSONAL_BRAND_HUB_URL || 'https://personalbrandhub.aipulsify.com/api/public',
  PERSONAL_BRAND_HUB_ADMIN_URL: process.env.PERSONAL_BRAND_HUB_ADMIN_URL || 'https://personalbrandhub.aipulsify.com/api/admin',
};

// Check if there are valid user IDs
if (env.TELEGRAM_ALLOWED_USER_IDS.length === 0 || env.TELEGRAM_ALLOWED_USER_IDS.some(isNaN)) {
    throw new Error('TELEGRAM_ALLOWED_USER_IDS must contain valid integer Telegram User IDs separated by commas.');
}
