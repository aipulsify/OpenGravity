import { env } from '../config/env.js';

const API_BASE = env.CLIENTVERSE_API_URL;
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.CLIENTVERSE_API_KEY}`
};

export interface GoogleToken {
    access_token: string;
    refresh_token: string;
    token_expiry: string;
    scopes?: string;
    email?: string;
}

/**
 * Fetches the Google token for a specific Telegram user from the Knowledge Hub API.
 */
export async function getGoogleToken(telegramId: string): Promise<GoogleToken | null> {
    try {
        const res = await fetch(`${API_BASE}/api/opengravity/tokens.php?telegram_id=${telegramId}`, { headers: HEADERS });
        if (!res.ok) return null;
        
        const data = await res.json();
        return data.success ? data.token : null;
    } catch (e) {
        console.error(`[getGoogleToken] Error:`, e);
        return null;
    }
}

/**
 * Saves or updates a Google token for a specific Telegram user.
 */
export async function saveGoogleToken(telegramId: string, token: GoogleToken): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/api/opengravity/tokens.php`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                telegram_id: telegramId,
                ...token
            })
        });
        
        const text = await res.text();
        const data = text ? JSON.parse(text) : { success: false, msg: 'Empty response' };
        if (!data.success) {
            console.error(`[saveGoogleToken] API Error (${res.status}):`, data.msg || data.error || text);
        }
        return data.success;
    } catch (e) {
        console.error(`[saveGoogleToken] Network/Parse Error:`, e);
        return false;
    }
}

/**
 * Deletes a Google token (disconnects account).
 */
export async function deleteGoogleToken(telegramId: string): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/api/opengravity/tokens.php?telegram_id=${telegramId}`, {
            method: 'DELETE',
            headers: HEADERS
        });
        
        const data = await res.json();
        return data.success;
    } catch (e) {
        console.error(`[deleteGoogleToken] Error:`, e);
        return false;
    }
}

/**
 * Refreshes the access token using the refresh token if it's expired or about to expire.
 */
export async function getValidToken(telegramId: string): Promise<GoogleToken | null> {
    const token = await getGoogleToken(telegramId);
    if (!token) return null;

    // Check if close to expiry (less than 5 mins)
    const expiry = new Date(token.token_expiry);
    const now = new Date();
    
    if (expiry <= new Date(now.getTime() + 5 * 60000)) {
        console.log(`[getValidToken] Token for ${telegramId} expiring. Refreshing...`);
        try {
            const res = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    refresh_token: token.refresh_token,
                    client_id: process.env.GOOGLE_CLIENT_ID || '',
                    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
                    grant_type: 'refresh_token',
                }),
            });

            const data = await res.json();
            if (data.error) {
                if (data.error === 'invalid_grant') {
                    await deleteGoogleToken(telegramId);
                }
                throw new Error(data.error);
            }

            const updatedToken: GoogleToken = {
                ...token,
                access_token: data.access_token,
                token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString()
            };
            
            await saveGoogleToken(telegramId, updatedToken);
            return updatedToken;
        } catch (e) {
            console.error(`[getValidToken] Refresh failed:`, e);
            return null;
        }
    }
    
    return token;
}
