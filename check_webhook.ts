import { env } from './src/config/env.js';
async function run() {
    const r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/getWebhookInfo');
    const data = await r.json();
    console.log(JSON.stringify(data, null, 2));
}
run();
