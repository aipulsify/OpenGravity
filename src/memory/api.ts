import { env } from '../config/env.js';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions.js';

const API_BASE = env.CLIENTVERSE_API_URL;
const HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.CLIENTVERSE_API_KEY}`
};

// Ya no hay inicialización de base de datos desde NodeJS.
export async function initDatabase() {
    console.log("Using API memory. Checking connection...");
    try {
        const res = await fetch(`${API_BASE}/api/opengravity/memory.php?telegram_id=1&limit=1`, { headers: HEADERS });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        console.log("API Memory connected successfully.");
    } catch (e: any) {
        console.warn("Could not connect to API memory:", e.message);
    }
}

export async function getRecentMessages(telegramId: number, limit: number = 20): Promise<ChatCompletionMessageParam[]> {
    const res = await fetch(`${API_BASE}/api/opengravity/memory.php?telegram_id=${telegramId}&limit=${limit}`, { headers: HEADERS });
    
    if (!res.ok) {
        throw new Error(`Failed to fetch memory: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`API Error: ${data.msg}`);
    }

    // Los mensajes ya vienen ordenados DESC pero la API de Groq los necesita ASC
    const rows = data.messages.reverse();

    return rows.map((row: any) => {
        const msg: any = { role: row.role };
        if (row.content) msg.content = row.content;
        if (row.tool_calls) msg.tool_calls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
        if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
        return msg as ChatCompletionMessageParam;
    });
}

export async function addMessage(telegramId: number, message: ChatCompletionMessageParam): Promise<void> {
    const role = message.role;
    let content = null;
    let tool_calls = null;
    let tool_call_id = null;

    if ('content' in message && message.content) {
        // @ts-ignore
        content = message.content;
    }
    
    if ('tool_calls' in message && message.tool_calls) {
        tool_calls = message.tool_calls;
    }

    if ('tool_call_id' in message && message.tool_call_id) {
        tool_call_id = message.tool_call_id;
    }

    const payload = {
        telegram_id: telegramId,
        role: role,
        content: content,
        tool_calls: tool_calls,
        tool_call_id: tool_call_id
    };

    const res = await fetch(`${API_BASE}/api/opengravity/memory.php`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`Failed to save message: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`API Error: ${data.msg}`);
    }
}

export async function clearMemory(telegramId: number): Promise<void> {
    const res = await fetch(`${API_BASE}/api/opengravity/memory.php?telegram_id=${telegramId}`, {
        method: 'DELETE',
        headers: HEADERS
    });

    if (!res.ok) {
        throw new Error(`Failed to clear memory: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.success) {
        throw new Error(`API Error: ${data.msg}`);
    }
}
