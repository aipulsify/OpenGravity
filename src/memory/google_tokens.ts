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
        
        const data = await res.json();
        return data.success;
    } catch (e) {
        console.error(`[saveGoogleToken] Error:`, e);
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
export async function getValidToken(telegramId: string): Promise<string | null> {
    const row = await getGoogleToken(telegramId);
    if (!row) return null;

    const expiryDate = new Date(row.token_expiry);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    // If still valid for at least 5 minutes, return access token
    if (expiryDate.getTime() - now.getTime() > fiveMinutes) {
        return row.access_token;
    }

    // Otherwise, refresh token
    console.log(`[getValidToken] Refreshing token for user ${telegramId}...`);
    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                refresh_token: row.refresh_token,
                client_id: process.env.GOOGLE_CLIENT_ID || '',
                client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
                grant_type: 'refresh_token',
            }),
        });

        const data = await res.json();

        if (data.error === 'invalid_grant') {
            await deleteGoogleToken(telegramId);
            return null;
        }

        if (!data.access_token) throw new Error(data.error || 'Unknown refresh error');

        const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
        const updatedToken: GoogleToken = {
            ...row,
            access_token: data.access_token,
            token_expiry: newExpiry
        };

        await saveGoogleToken(telegramId, updatedToken);
        return data.access_token;
    } catch (e) {
        console.error(`[getValidToken] Error refreshing:`, e);
        return null;
    }
}
