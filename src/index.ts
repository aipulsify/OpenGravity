import { bot } from './bot/telegram.js';
import { initDatabase } from './memory/api.js';

console.log('Starting OpenGravity...'); // FINAL FINAL FINAL: Added refresh_token & email to gog import

// Initialize database before starting bot
await initDatabase();

bot.start({
  onStart: (botInfo) => {
    console.log(`Bot initialized successfully as @${botInfo.username}`);
  }
});

// Enable graceful stop
process.once('SIGINT', () => {
    console.log('Stopping OpenGravity...');
    bot.stop();
});
process.once('SIGTERM', () => {
    console.log('Stopping OpenGravity...');
    bot.stop();
});
