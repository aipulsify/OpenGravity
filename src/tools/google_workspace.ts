import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { getValidToken } from '../memory/google_tokens.js';
import { env } from '../config/env.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const execPromise = promisify(exec);

// Determine gws binary path based on OS
const IS_WINDOWS = platform() === 'win32';
const SOURCE_GWS_BIN = IS_WINDOWS ? join(process.cwd(), 'gws.exe') : join(process.cwd(), 'gws_linux');
const TARGET_GWS_BIN = IS_WINDOWS ? SOURCE_GWS_BIN : '/tmp/gws_linux';

/**
 * Ensures the gws binary is executable.
 * On Vercel (Linux), we must copy it to /tmp because the source dir is read-only.
 */
function ensureGwsBinary() {
  if (IS_WINDOWS) return TARGET_GWS_BIN;
  
  try {
    if (!existsSync(TARGET_GWS_BIN)) {
      console.log(`[ensureGwsBinary] Copying binary from ${SOURCE_GWS_BIN} to ${TARGET_GWS_BIN}...`);
      const binaryData = readFileSync(SOURCE_GWS_BIN);
      writeFileSync(TARGET_GWS_BIN, binaryData);
    }
    
    // Always attempt chmod to be safe (it's allowed in /tmp)
    execSync(`chmod +x ${TARGET_GWS_BIN}`);
    return TARGET_GWS_BIN;
  } catch (err: any) {
    console.error(`[ensureGwsBinary] Failed to prepare binary: ${err.message}`);
    return SOURCE_GWS_BIN; // Fallback to original path
  }
}

/**
 * Escapes a JSON string for shell execution based on OS.
 */
function escapeJsonArg(json: string): string {
    if (IS_WINDOWS) {
        // For Windows PowerShell/CMD, escape double quotes
        return `"${json.replace(/"/g, '\\"')}"`;
    }
    // For Unix/Linux, wrap in single quotes
    return `'${json}'`;
}

/**
 * Executes a gws command with user-specific authentication.
 */
async function runGwsCommand(telegramId: string, resourcePath: string, params: object = {}, body: object | null = null): Promise<string> {
  const gwsBin = ensureGwsBinary();
  
  // 1. Fetch User-Specific Token from DB/API
  const tokenData = await getValidToken(telegramId);
  if (!tokenData) {
    console.log(`[runGwsCommand] No token found for ${telegramId}. Throwing error.`);
    throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
  }

  try {
    // 2. Build command components with structured flags for v0.19.0
    let fullCommand = `${gwsBin} ${resourcePath}`;
    
    if (Object.keys(params).length > 0) {
        fullCommand += ` --params ${escapeJsonArg(JSON.stringify(params))}`;
    }
    
    if (body) {
        fullCommand += ` --body-json ${escapeJsonArg(JSON.stringify(body))}`;
    }

    // 3. Set environment variables
    const envOptions = {
        env: { 
          ...process.env, 
          GOOGLE_WORKSPACE_CLI_TOKEN: tokenData.access_token,
          GOOGLE_WORKSPACE_CLI_CONFIG_DIR: IS_WINDOWS ? undefined : '/tmp',
          GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file'
        }
    };

    console.log(`[runGwsCommand] Executing Discovery Method: ${resourcePath}`);
    console.log(`[runGwsCommand] Params: ${JSON.stringify(params)}`);
    console.log(`[runGwsCommand] Full Command: ${fullCommand.replace(tokenData.access_token, '***')}`);
    
    const { stdout, stderr } = await execPromise(fullCommand, envOptions);

    if (stderr && stderr.length > 0) {
      console.warn(`gws stderr: ${stderr}`);
    }

    console.log(`[runGwsCommand] Success. Response length: ${stdout.length}`);
    if (stdout.length < 2000) {
        console.log(`[runGwsCommand] Raw Response: ${stdout}`);
    } else {
        console.log(`[runGwsCommand] Response starts with: ${stdout.substring(0, 500)}...`);
    }

    return stdout || 'Command executed successfully.';
  } catch (error: any) {
    console.error(`Error executing gws command: ${error.message}`);
    const stderr = error.stderr ? `\n\nDetalles del error:\n${error.stderr}` : '';
    console.log(`[runGwsCommand] Failure. Stderr: ${error.stderr}`);
    return `Algo ha fallado al comunicarnos con Google Workspace (${resourcePath}): ${error.message}${stderr}`;
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

const gwsExecuteDef: ToolDefinition = {
    name: 'gws_execute',
    description: 'Execute any Google Workspace command. Params: resourcePath (e.g. "calendar events list"), params (JSON object for URL params), body (JSON object for request body).',
    parameters: {
        type: 'object',
        properties: {
            resourcePath: { type: 'string', description: 'The GWS resource path (e.g., "calendar events list")' },
            params: { type: 'object', description: 'URL parameters' },
            body: { type: 'object', description: 'Request body' }
        },
        required: ['resourcePath']
    }
};

registerTool({
    definition: gwsExecuteDef,
    execute: async ({ resourcePath, params = {}, body = null }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), resourcePath, params, body);
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
                return handleAuthError(String(telegramId), 'Cuenta de Google no conectada');
            }
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
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, max: { type: 'number' } },
      required: ['query']
    }
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
    parameters: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body']
    }
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
    description: 'List calendar events.',
    parameters: {
      type: 'object',
      properties: { calendarId: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
      required: ['calendarId', 'from', 'to']
    }
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
    parameters: {
      type: 'object',
      properties: { calendarId: { type: 'string' }, summary: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
      required: ['calendarId', 'summary', 'from', 'to']
    }
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
            const content = await runGwsCommand(String(telegramId), type === 'doc' ? 'docs documents get' : 'sheets spreadsheets values get', type === 'doc' ? { documentId: id } : { spreadsheetId: id, range: 'A1:Z100' });
            const snapshotId = Math.random().toString(36).substring(2, 10);
            const knowledgeApi = `${env.CLIENTVERSE_API_URL}/api/opengravity/knowledge.php`;
            await fetch(knowledgeApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer og_secret_default_key_2026` },
                body: JSON.stringify({ telegram_id: telegramId, topic: snapshotId, content, category: 'document', metadata: { original_title: title, original_id: id, type } })
            });
            return `Documento procesado. Ábrelo aquí:\n\n[TELEGRAM_WEB_APP:${env.PERSONAL_BRAND_HUB_BASE_URL}/workspace/${snapshotId}]`;
        } catch (error: any) {
            if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') return handleAuthError(String(telegramId), 'No puedo abrir el archivo');
            return `Error: ${error.message}`;
        }
    }
});
