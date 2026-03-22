import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGoogleToken } from '../../../src/memory/google_tokens.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { telegram_id } = req.query;

    if (!telegram_id) {
        return res.status(400).json({ success: false, msg: 'Missing telegram_id' });
    }

    try {
        const token = await getGoogleToken(String(telegram_id));
        if (token) {
            return res.status(200).json({ 
                success: true, 
                connected: true, 
                email: token.email,
                scopes: token.scopes
            });
        } else {
            return res.status(200).json({ 
                success: true, 
                connected: false 
            });
        }
    } catch (err: any) {
        res.status(500).json({ success: false, msg: err.message });
    }
}
