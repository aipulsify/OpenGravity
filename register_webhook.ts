import { env } from './src/config/env.js';

async function registerWebhook() {
    const url = 'https://open-gravity-gilt.vercel.app/api/webhook';
    const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${url}`;
    
    console.log(`Setting webhook to: ${url}`);
    
    try {
        const res = await fetch(telegramUrl);
        const data = await res.json();
        console.log('Response:', data);
    } catch (e) {
        console.error('Error:', e);
    }
}

registerWebhook();
