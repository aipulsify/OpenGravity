import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { saveGoogleToken } from '../../../src/memory/google_tokens.js';
import { Bot } from 'grammy';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).send(`Auth Error: ${String(error)}`);
    }

    if (!code || !state) {
        return res.status(400).send('Missing code or state');
    }

    try {
        // 1. Verify state JWT
        const decoded = jwt.verify(String(state), JWT_SECRET) as { telegram_id: string };
        const telegramId = decoded.telegram_id;

        // 2. Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: CLIENT_ID!,
                client_secret: CLIENT_SECRET!,
                redirect_uri: REDIRECT_URI!,
                grant_type: 'authorization_code'
            })
        });

        if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            console.error('[OAuth Callback] Token exchange failed:', errBody);
            return res.status(500).send(`Token exchange failed: ${errBody}`);
        }

        const data = await tokenRes.json();
        
        // 3. Save to database via API
        const expiryDate = new Date(Date.now() + data.expires_in * 1000).toISOString();
        
        // Optionally fetch user email for logging/reference
        let email = '';
        try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${data.access_token}` }
            });
            const userInfo = await userRes.json();
            email = userInfo.email || '';
        } catch (e) {
            console.warn('[OAuth Callback] Could not fetch user email');
        }

        const saveSuccess = await saveGoogleToken(telegramId, {
            access_token: data.access_token,
            refresh_token: data.refresh_token, // This is only present on first authorization
            token_expiry: expiryDate,
            scopes: data.scope,
            email: email
        });

        if (!saveSuccess) {
            return res.status(500).send('Failed to save tokens to database. Please check Knowledge Hub API.');
        }

        // 4. Notify Telegram Bot
        if (BOT_TOKEN) {
            const bot = new Bot(BOT_TOKEN);
            await bot.api.sendMessage(telegramId, `✅ **Google Workspace Conectado**\n\nTu cuenta \`${email || 'principal'}\` se ha vinculado correctamente. Ya puedes usar herramientas como Gmail, Drive y Calendar.`);
        }

        // 5. Success UI
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f4f4f9;">
                    <h1 style="color: #4CAF50;">¡Conectado con éxito!</h1>
                    <p>Tu cuenta de Google ha sido vinculada a OpenGravity.</p>
                    <p>Ya puedes cerrar esta ventana y volver a Telegram.</p>
                    <div style="margin-top: 30px; color: #888; font-size: 0.8em;">OpenGravity x Google Workspace</div>
                </body>
            </html>
        `);

    } catch (err: any) {
        console.error('[OAuth Callback] Error:', err.message);
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).send('Invalid or expired state session. Please try logging in again.');
        }
        res.status(500).send(`Internal Error: ${err.message}`);
    }
}
