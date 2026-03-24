import { VercelRequest, VercelResponse } from '@vercel/node';
import { runGwsCommand } from '../src/tools/google_workspace.js';
import { bot } from '../src/bot/telegram.js';
import { env } from '../src/config/env.js';

/**
 * api/worker.ts - Asynchronous Task Processor for OpenGravity
 * Designed to be triggered by a Vercel Cron or a recursive webhook.
 */
export default async function (req: VercelRequest, res: VercelResponse) {
    const SECRET = "og_secret_default_key_2026";
    
    // Auth Check
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        // 1. Fetch one pending task from PHP API
        const pollRes = await fetch(`${env.CLIENTVERSE_API_URL}/api/opengravity/tasks.php?limit=1`, {
            headers: { 'Authorization': `Bearer ${SECRET}` }
        });
        const tasks: any[] = await pollRes.json();

        if (!tasks || tasks.length === 0) {
            return res.status(200).json({ status: "idle", message: "No tasks found" });
        }

        const task = tasks[0];
        const { id, telegram_id, task_type, payload } = task;
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

        console.log(`[worker] Processing task ${id} (${task_type}) for user ${telegram_id}`);

        // 2. Mark as processing (PATCH)
        await fetch(`${env.CLIENTVERSE_API_URL}/api/opengravity/tasks.php`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
            body: JSON.stringify({ task_id: id, status: 'processing' })
        });

        // 3. Execute logic
        let summary = "";
        let resultLink = null;
        
        if (task_type === 'docs_create_with_content') {
            const { title, content } = data;
            
            // Step 1: Create
            const createRes = await runGwsCommand(telegram_id, 'docs documents create', {}, { title });
            const docInfo = JSON.parse(createRes);
            const docId = docInfo.documentId;
            
            // Step 2: Append
            const body = { requests: [{ insertText: { text: content, location: { index: 1 } } }] };
            await runGwsCommand(telegram_id, 'docs documents batchUpdate', { documentId: docId }, body);
            
            resultLink = `https://docs.google.com/document/d/${docId}/edit`;
            summary = `✅ Documento creado: "${title}"\n[Ver en Google Docs](${resultLink})`;
        }

        // 4. Update result (PATCH)
        await fetch(`${env.CLIENTVERSE_API_URL}/api/opengravity/tasks.php`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SECRET}` },
            body: JSON.stringify({ task_id: id, status: 'done', result_link: resultLink })
        });

        // 5. Notify user via Telegram
        await bot.api.sendMessage(telegram_id, summary, { parse_mode: 'Markdown' });

        return res.status(200).json({ status: "completed", task_id: id });

    } catch (error: any) {
        console.error(`[worker] Error processing task: ${error.message}`);
        return res.status(500).json({ status: "error", message: error.message });
    }
}
