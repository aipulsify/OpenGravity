import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid',
    'profile'
];

export default function handler(req: VercelRequest, res: VercelResponse) {
    const { telegram_id } = req.query;

    if (!telegram_id) {
        return res.status(400).send('Missing telegram_id');
    }

    if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).send('OAuth Configuration Missing (Client ID or Redirect URI)');
    }

    // Create a secure state using JWT
    const state = jwt.sign({ 
        telegram_id: String(telegram_id),
        iat: Math.floor(Date.now() / 1000)
    }, JWT_SECRET, { expiresIn: '10m' });

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.set('client_id', CLIENT_ID);
    googleAuthUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('scope', SCOPES.join(' '));
    googleAuthUrl.searchParams.set('access_type', 'offline');
    googleAuthUrl.searchParams.set('prompt', 'consent');
    googleAuthUrl.searchParams.set('state', state);

    res.redirect(googleAuthUrl.toString());
}
