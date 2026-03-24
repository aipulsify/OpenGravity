import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { getValidToken } from '../memory/google_tokens.js';
import { env } from '../config/env.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
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
 * Executes a gws command with user-specific authentication.
 */
async function runGwsCommand(telegramId: string, command: string): Promise<string> {
  const gwsBin = ensureGwsBinary();
  
  // 1. Fetch User-Specific Token from DB/API
  const tokenData = await getValidToken(telegramId);
  if (!tokenData) {
    console.log(`[runGwsCommand] No token found for ${telegramId}. Throwing error.`);
    throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
  }

  try {
    // 2. Set environment variables for gws v0.19.0
    const envOptions = {
        env: { 
          ...process.env, 
          GOOGLE_WORKSPACE_CLI_TOKEN: tokenData.access_token,
          // Support for file-based keyring just in case, though token env var usually bypasses it
          GOOGLE_WORKSPACE_CLI_CONFIG_DIR: IS_WINDOWS ? undefined : '/tmp',
          GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file'
        }
    };

    // 3. Execute
    const { stdout, stderr } = await execPromise(`${gwsBin} ${command}`, envOptions);

    if (stderr && stderr.length > 0) {
      console.warn(`gws stderr: ${stderr}`);
    }
    return stdout || 'Command executed successfully.';
  } catch (error: any) {
    console.error(`Error executing gws command: ${error.message}`);
    const stderr = error.stderr ? `\n\nDetalles del error:\n${error.stderr}` : '';
    return `Algo ha fallado al comunicarnos con Google: ${error.message}${stderr}`;
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
    description: 'Execute any Google Workspace command using the gws CLI. Use this for advanced operations across Gmail, Drive, Calendar, Sheets, Docs, Slides, and Admin.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The GWS command to run (e.g., "drive files list --max 5")' }
        },
        required: ['command']
    }
};

registerTool({
    definition: gwsExecuteDef,
    execute: async ({ command }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), command);
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

const gmailSearchDef: ToolDefinition = {
  name: 'gmail_search',
  description: 'Search for emails in Gmail.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max: { type: 'number', description: 'Max results' }
    },
    required: ['query']
  }
};

registerTool({
  definition: gmailSearchDef,
  execute: async ({ query, max = 10 }, { telegramId }) => {
    try {
      return await runGwsCommand(String(telegramId), `gmail search "${query}" --max ${max} --json`);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        return handleAuthError(String(telegramId), 'No puedo leer tus correos');
      }
      throw e;
    }
  }
});

const gmailSendDef: ToolDefinition = {
  name: 'gmail_send',
  description: 'Send an email via Gmail.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient' },
      subject: { type: 'string', description: 'Subject' },
      body: { type: 'string', description: 'Content' }
    },
    required: ['to', 'subject', 'body']
  }
};

registerTool({
  definition: gmailSendDef,
  execute: async ({ to, subject, body }, { telegramId }) => {
    try {
      const tokenData = await getValidToken(String(telegramId));
      if (!tokenData) throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');

      const gwsBin = ensureGwsBinary();
      const output = execSync(`${gwsBin} gmail send --to "${to}" --subject "${subject}" --body-file -`, {
        input: body,
        encoding: 'utf-8',
        env: { 
          ...process.env, 
          GOOGLE_WORKSPACE_CLI_TOKEN: tokenData.access_token,
          GOOGLE_WORKSPACE_CLI_CONFIG_DIR: IS_WINDOWS ? undefined : '/tmp',
          GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file'
        }
      });
      return output || 'Email sent successfully.';
    } catch (error: any) {
        if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          return handleAuthError(String(telegramId), 'No puedo enviar el correo');
        }
        return `Error sending email: ${error.message}`;
    }
  }
});

// -----------------------------------------------------------------------------
// CALENDAR TOOLS
// -----------------------------------------------------------------------------

const calendarListDef: ToolDefinition = {
  name: 'calendar_list_events',
  description: 'List calendar events.',
  parameters: {
    type: 'object',
    properties: {
      calendarId: { type: 'string', description: 'ID of calendar (e.g. "primary")' },
      from: { type: 'string', description: 'ISO Start date' },
      to: { type: 'string', description: 'ISO End date' }
    },
    required: ['calendarId', 'from', 'to']
  }
};

registerTool({
  definition: calendarListDef,
  execute: async ({ calendarId, from, to }, { telegramId }) => {
    try {
      return await runGwsCommand(String(telegramId), `calendar events "${calendarId}" --from "${from}" --to "${to}" --json`);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        return handleAuthError(String(telegramId), 'Calendario no disponible');
      }
      throw e;
    }
  }
});

const calendarCreateDef: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  parameters: {
    type: 'object',
    properties: {
      calendarId: { type: 'string', description: 'ID of calendar' },
      summary: { type: 'string', description: 'Summary/Title' },
      from: { type: 'string', description: 'ISO Start' },
      to: { type: 'string', description: 'ISO End' }
    },
    required: ['calendarId', 'summary', 'from', 'to']
  }
};

registerTool({
  definition: calendarCreateDef,
  execute: async ({ calendarId, summary, from, to }, { telegramId }) => {
    try {
      return await runGwsCommand(String(telegramId), `calendar create "${calendarId}" --summary "${summary}" --from "${from}" --to "${to}" --json`);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        return handleAuthError(String(telegramId), 'No puedo crear el evento');
      }
      throw e;
    }
  }
});

// -----------------------------------------------------------------------------
// DRIVE / DOCS / SHEETS TOOLS
// -----------------------------------------------------------------------------

const docsCatDef: ToolDefinition = {
    name: 'docs_get_content',
    description: 'Get the text content of a Google Doc.',
    parameters: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: 'The Document ID' }
      },
      required: ['docId']
    }
};

registerTool({
    definition: docsCatDef,
    execute: async ({ docId }, { telegramId }) => {
      try {
        return await runGwsCommand(String(telegramId), `docs cat "${docId}"`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          return handleAuthError(String(telegramId), 'No puedo leer este Documento');
        }
        throw e;
      }
    }
});

const sheetsGetDef: ToolDefinition = {
    name: 'sheets_get',
    description: 'Get values from a Google Sheet spreadsheet.',
    parameters: {
      type: 'object',
      properties: {
        sheetId: { type: 'string', description: 'The Spreadsheet ID' },
        range: { type: 'string', description: 'The range (e.g., "Sheet1!A1:D10")' }
      },
      required: ['sheetId', 'range']
    }
};

registerTool({
    definition: sheetsGetDef,
    execute: async ({ sheetId, range }, { telegramId }) => {
      try {
        return await runGwsCommand(String(telegramId), `sheets get "${sheetId}" "${range}" --json`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          return handleAuthError(String(telegramId), 'No puedo leer esta Hoja');
        }
        throw e;
      }
    }
});

// -----------------------------------------------------------------------------
// NEW TOOLS (SLIDES, ADMIN, ETC.)
// -----------------------------------------------------------------------------

const slidesCreateDef: ToolDefinition = {
    name: 'slides_create',
    description: 'Create a new Google Slides presentation.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'The title of the presentation' }
        },
        required: ['title']
    }
};

registerTool({
    definition: slidesCreateDef,
    execute: async ({ title }, { telegramId }) => {
        try {
            return await runGwsCommand(String(telegramId), `slides presentations create --title "${title}" --json`);
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
                return handleAuthError(String(telegramId), 'No puedo crear presentaciones');
            }
            throw e;
        }
    }
});

const adminListUsersDef: ToolDefinition = {
    name: 'admin_list_users',
    description: 'List users in the Google Workspace domain (requires Admin privileges).',
    parameters: {
        type: 'object',
        properties: {
            domain: { type: 'string', description: 'Optional domain to filter' }
        }
    }
};

registerTool({
    definition: adminListUsersDef,
    execute: async ({ domain }, { telegramId }) => {
        try {
            const domainFlag = domain ? `--domain "${domain}"` : '';
            return await runGwsCommand(String(telegramId), `admin directory users list ${domainFlag} --json`);
        } catch (e: any) {
            if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
                return handleAuthError(String(telegramId), 'No puedo acceder al panel de administración');
            }
            throw e;
        }
    }
});

// -----------------------------------------------------------------------------
// INTERACTIVE TOOLS
// -----------------------------------------------------------------------------

const openWorkspaceAppDef: ToolDefinition = {
    name: 'og_open_workspace_app',
    description: 'Opens a Google Doc or Sheet in an interactive Mini App for viewing and AI interaction.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The Document or Spreadsheet ID' },
        type: { type: 'string', enum: ['doc', 'sheet'], description: 'Type of file' },
        title: { type: 'string', description: 'Title of the document' }
      },
      required: ['id', 'type', 'title']
    }
};

registerTool({
    definition: openWorkspaceAppDef,
    execute: async ({ id, type, title }, { telegramId }) => {
        try {
            if (!telegramId) throw new Error('CONTEXT_MISSING_TELEGRAM_ID');
            
            // 1. Fetch content
            const content = await runGwsCommand(String(telegramId), type === 'doc' ? `docs cat "${id}"` : `sheets get "${id}" "A1:Z100" --json`);
            
            // 2. Generate a unique snapshot ID
            const snapshotId = Math.random().toString(36).substring(2, 15);
            
            // 3. Save as a snapshot in Knowledge Hub
            const knowledgeApi = `${env.CLIENTVERSE_API_URL}/api/opengravity/knowledge.php`;
            const token = 'og_secret_default_key_2026'; // Should be in env.KNOWLEDGE_HUB_API_KEY if exists
            
            console.log(`[og_open_workspace_app] Saving to Knowledge Hub for user ${telegramId}...`);
            await fetch(knowledgeApi, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    telegram_id: telegramId,
                    topic: snapshotId,
                    content: content,
                    category: 'document',
                    metadata: { original_title: title, original_id: id, type: type }
                })
            });

            // 4. Return the Mini App link
            const miniAppUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/workspace/${snapshotId}`;
            return `Documento procesado correctamente. Puedes interactuar con él aquí:\n\n[TELEGRAM_WEB_APP:${miniAppUrl}]`;
        
        } catch (error: any) {
            console.error(`[og_open_workspace_app] Error:`, error);
            if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
                return handleAuthError(String(telegramId), 'No puedo abrir el archivo');
            }
            return `No he podido abrir el archivo de forma interactiva: ${error.message}`;
        }
    }
});
