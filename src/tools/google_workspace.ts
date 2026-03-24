import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { getValidToken } from '../memory/google_tokens.js';
import { env } from '../config/env.js';
import { execSync, spawn } from 'child_process';
import { platform } from 'os';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';



// Determine gws binary path based on OS
const IS_WINDOWS = platform() === 'win32';
const SOURCE_GWS_BIN = IS_WINDOWS ? join(process.cwd(), 'gws.exe') : join(process.cwd(), 'gws_linux');
const TARGET_GWS_BIN = IS_WINDOWS ? SOURCE_GWS_BIN : '/tmp/gws_linux';

/**
 * Ensures the gws binary is executable.
 */
function ensureGwsBinary() {
  if (IS_WINDOWS) return TARGET_GWS_BIN;
  try {
    if (!existsSync(TARGET_GWS_BIN)) {
      console.log(`[ensureGwsBinary] Copying binary from ${SOURCE_GWS_BIN} to ${TARGET_GWS_BIN}...`);
      const binaryData = readFileSync(SOURCE_GWS_BIN);
      writeFileSync(TARGET_GWS_BIN, binaryData);
    }
    execSync(`chmod +x ${TARGET_GWS_BIN}`);
    return TARGET_GWS_BIN;
  } catch (err: any) {
    console.error(`[ensureGwsBinary] Failed to prepare binary: ${err.message}`);
    return SOURCE_GWS_BIN;
  }
}

/**
 * Escapes a JSON string for shell execution based on OS.
 */
function escapeJsonArg(json: string): string {
    if (IS_WINDOWS) {
        return `"${json.replace(/"/g, '\\"')}"`;
    }
    return `'${json}'`;
}

/**
 * Executes a gws command with user-specific authentication.
 * Uses spawn (process-based) instead of exec (shell-based) to handle large payloads.
 */
export async function runGwsCommand(telegramId: string, resourcePath: string, params: object = {}, body: object | null = null): Promise<string> {
  const gwsBin = ensureGwsBinary();
  const tokenData = await getValidToken(telegramId);
  if (!tokenData) throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');

  return new Promise((resolve, reject) => {
    // 1. Build arguments array for spawn
    const args = resourcePath.split(' ');
    
    if (Object.keys(params).length > 0) {
        args.push('--params', JSON.stringify(params));
    }
    
    if (body) {
        args.push('--json', JSON.stringify(body));
    }

    // 2. Set environment variables
    const envOptions = {
        env: { 
            ...process.env, 
            GOOGLE_WORKSPACE_CLI_TOKEN: tokenData.access_token, 
            GOOGLE_WORKSPACE_CLI_CONFIG_DIR: IS_WINDOWS ? undefined : '/tmp', 
            GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file' 
        }
    };

    console.log(`[runGwsCommand] Executing: ${gwsBin} ${args.join(' ').replace(tokenData.access_token, '***')}`);
    
    const child = spawn(gwsBin, args, envOptions);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[runGwsCommand] Success. Response length: ${stdout.length}`);
        resolve(stdout || 'Command executed successfully.');
      } else {
        console.error(`Error executing gws command (code ${code}): ${stderr}`);
        const errorMsg = `Algo ha fallado al comunicarnos con Google Workspace (${resourcePath}): ${stderr}`;
        resolve(errorMsg); // Resolve with error message for the LLM to handle
      }
    });

    child.on('error', (err) => {
      console.error(`Spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Queues a task for asynchronous execution.
 */
async function queueTask(telegramId: string, type: string, payload: object): Promise<string> {
    try {
        const response = await fetch(`${env.CLIENTVERSE_API_URL}/api/opengravity/tasks.php`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer og_secret_default_key_2026` 
            },
            body: JSON.stringify({ telegram_id: telegramId, task_type: type, payload })
        });
        
        if (!response.ok) throw new Error(`Tasks API Error: ${response.status}`);
        const data: any = await response.json();
        return `✅ **Tarea Encolada** (ID: ${data.task_id})\n\nEste proceso es asíncrono para evitar bloqueos. Te avisaré por Telegram cuando el documento esté listo.`;
    } catch (error: any) {
        console.error(`[queueTask] Error: ${error.message}`);
        return `No pude encolar la tarea en este momento. Intenta de nuevo más tarde o revisa la conexión con ClientVerse.`;
    }
}

/**
 * Common error handler for Google Account not connected.
 */
function handleAuthError(telegramId: string, messagePrefix: string) {
    const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
    return `❌ **${messagePrefix}**\n\nNecesito tu permiso para acceder a Google Workspace. Por favor, conecta tu cuenta aquí:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
}

// -----------------------------------------------------------------------------
// GENERIC TOOL 
// -----------------------------------------------------------------------------

registerTool({
    definition: {
        name: 'gws_execute',
        description: 'Execute any Google Workspace command. IMPORTANT: Use full resource paths (e.g., "docs documents create"). DO NOT use this for creating documents/sheets/slides if specialized tools exist. DO NOT send HTML content.',
        parameters: { type: 'object', properties: { resourcePath: { type: 'string' }, params: { type: 'object' }, body: { type: 'object' } }, required: ['resourcePath'] }
    },
    execute: async ({ resourcePath, params = {}, body = null }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), resourcePath, params, body);
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'Cuenta de Google no conectada');
            throw e;
        }
    }
});

// -----------------------------------------------------------------------------
// GMAIL TOOLS
// -----------------------------------------------------------------------------

registerTool({
  definition: {
    name: 'gmail_search',
    description: 'Search for emails in Gmail.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] }
  },
  execute: async ({ query, max = 10 }, { telegramId }) => {
    try {
      return await runGwsCommand(String(telegramId), 'gmail users messages list', { q: query, maxResults: max, userId: 'me' });
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo leer Gmail');
      throw e;
    }
  }
});

registerTool({
  definition: {
    name: 'gmail_send',
    description: 'Send an email via Gmail.',
    parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] }
  },
  execute: async ({ to, subject, body }, { telegramId }) => {
    try {
      const raw = Buffer.from(`To: ${to}\nSubject: ${subject}\n\n${body}`).toString('base64url');
      return await runGwsCommand(String(telegramId), 'gmail users messages send', { userId: 'me' }, { raw });
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo enviar correos');
      throw e;
    }
  }
});

// -----------------------------------------------------------------------------
// CALENDAR TOOLS
// -----------------------------------------------------------------------------

registerTool({
  definition: {
    name: 'calendar_list_events',
    description: 'List calendar events. IMPORTANT: Always use the current year (2026).',
    parameters: { type: 'object', properties: { calendarId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['calendarId', 'from', 'to'] }
  },
  execute: async ({ calendarId, from, to }, { telegramId }) => {
    try {
      return await runGwsCommand(String(telegramId), 'calendar events list', { calendarId, timeMin: from, timeMax: to });
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'Calendario no disponible');
      throw e;
    }
  }
});

registerTool({
  definition: {
    name: 'calendar_create_event',
    description: 'Create a calendar event.',
    parameters: { type: 'object', properties: { calendarId: { type: 'string' }, summary: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['calendarId', 'summary', 'from', 'to'] }
  },
  execute: async ({ calendarId, summary, from, to }, { telegramId }) => {
    try {
      const body = { summary, start: { dateTime: from }, end: { dateTime: to } };
      return await runGwsCommand(String(telegramId), 'calendar events insert', { calendarId }, body);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo crear eventos');
      throw e;
    }
  }
});

// -----------------------------------------------------------------------------
// DRIVE / DOCS / SHEETS TOOLS
// -----------------------------------------------------------------------------

registerTool({
    definition: {
      name: 'docs_create_async',
      description: 'Largo plazo: Crea un documento de Google y lo llena con contenido de forma asíncrona. Úsalo para informes largos o auditorías para evitar timeouts.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] }
    },
    execute: async ({ title, content }, { telegramId }) => {
        return await queueTask(String(telegramId), 'docs_create_with_content', { title, content });
    }
});

registerTool({
    definition: {
      name: 'docs_create',
      description: 'Crea un documento de Google VACÍO con un título. Devuelve el documentId. Rápido y síncrono.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    },
    execute: async ({ title }, { telegramId }) => {
      try {
        return await runGwsCommand(String(telegramId), 'docs documents create', {}, { title });
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo crear documentos');
        throw e;
      }
    }
});

registerTool({
    definition: {
      name: 'docs_append_text',
      description: 'Append PLAIN TEXT to a Google Doc. IMPORTANT: DO NOT SEND HTML. Use only plain text or simple markdown symbols. Keep the text concise to avoid timeouts.',
      parameters: { type: 'object', properties: { docId: { type: 'string' }, text: { type: 'string' } }, required: ['docId', 'text'] }
    },
    execute: async ({ docId, text }, { telegramId }) => {
      try {
        const body = { 
            requests: [
                { insertText: { text, location: { index: 1 } } }
            ] 
        };
        return await runGwsCommand(String(telegramId), 'docs documents batchUpdate', { documentId: docId }, body);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo editar el documento');
        throw e;
      }
    }
});

registerTool({
    definition: {
      name: 'docs_get_content',
      description: 'Get the content of a Google Doc.',
      parameters: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] }
    },
    execute: async ({ docId }, { telegramId }) => {
      try {
        return await runGwsCommand(String(telegramId), 'docs documents get', { documentId: docId });
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo leer el Documento');
        throw e;
      }
    }
});

registerTool({
    definition: {
      name: 'sheets_get',
      description: 'Get values from a Google Sheet spreadsheet.',
      parameters: { type: 'object', properties: { sheetId: { type: 'string' }, range: { type: 'string' } }, required: ['sheetId', 'range'] }
    },
    execute: async ({ sheetId, range }, { telegramId }) => {
      try {
        return await runGwsCommand(String(telegramId), 'sheets spreadsheets values get', { spreadsheetId: sheetId, range });
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo leer la Hoja');
        throw e;
      }
    }
});

// -----------------------------------------------------------------------------
// SLIDES / ADMIN TOOLS
// -----------------------------------------------------------------------------

registerTool({
    definition: {
        name: 'slides_create',
        description: 'Create a new presentation.',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    },
    execute: async ({ title }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), 'slides presentations create', {}, { title });
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo crear presentaciones');
            throw e;
        }
    }
});

registerTool({
    definition: {
        name: 'admin_list_users',
        description: 'List Workspace users.',
        parameters: { type: 'object', properties: { domain: { type: 'string' } } }
    },
    execute: async ({ domain }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), 'admin directory users list', { domain });
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'Admin no disponible');
            throw e;
        }
    }
});

// -----------------------------------------------------------------------------
// INTERACTIVE TOOLS
// -----------------------------------------------------------------------------

registerTool({
    definition: {
      name: 'og_open_workspace_app',
      description: 'Opens a Google Doc or Sheet in an interactive Mini App.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, type: { type: 'string', enum: ['doc', 'sheet'] }, title: { type: 'string' } },
        required: ['id', 'type', 'title']
      }
    },
    execute: async ({ id, type, title }, { telegramId }) => {
        try {
            if (!telegramId) throw new Error('CONTEXT_MISSING_TELEGRAM_ID');
            const resource = type === 'doc' ? 'docs documents get' : 'sheets spreadsheets values get';
            const params = type === 'doc' ? { documentId: id } : { spreadsheetId: id, range: 'A1:Z100' };
            const content = await runGwsCommand(String(telegramId), resource, params);
            
            const snapshotId = Math.random().toString(36).substring(2, 10);
            const knowledgeApi = `${env.CLIENTVERSE_API_URL}/api/opengravity/knowledge.php`;
            await fetch(knowledgeApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer og_secret_default_key_2026` },
                body: JSON.stringify({ telegram_id: telegramId, topic: snapshotId, content, category: 'document', metadata: { original_title: title, original_id: id, type } })
            });
            const baseUrl = env.VITE_WORKSPACE_VIEWER_URL.replace(/\/$/, '');
            return `Documento procesado. Ábrelo aquí:\n\n[TELEGRAM_WEB_APP:${baseUrl}/workspace/${snapshotId}]`;
        } catch (error: any) {
            if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo abrir el archivo');
            return `Error: ${error.message}`;
        }
    }
});
