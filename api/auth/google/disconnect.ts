import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGoogleToken, deleteGoogleToken } from '../../../src/memory/google_tokens.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { telegram_id } = req.query;

    if (!telegram_id) {
        return res.status(400).json({ success: false, msg: 'Missing telegram_id' });
    }

    try {
        const token = await getGoogleToken(String(telegram_id));
        
        if (token) {
            // 1. Revoke access at Google
            try {
                await fetch(`https://oauth2.googleapis.com/revoke?token=${token.access_token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
            } catch (e) {
                console.warn('[Disconnect] Could not revoke token at Google center');
            }

            // 2. Delete from local database
            await deleteGoogleToken(String(telegram_id));
        }

        return res.status(200).json({ success: true, msg: 'Disconnected successfully' });
    } catch (err: any) {
        res.status(500).json({ success: false, msg: err.message });
    }
}
