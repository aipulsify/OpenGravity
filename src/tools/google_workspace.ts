import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { getValidToken } from '../memory/google_tokens.js';
import { env } from '../config/env.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const execPromise = promisify(exec);

// Determine gog binary path based on OS
const IS_WINDOWS = platform() === 'win32';
const SOURCE_GOG_BIN = IS_WINDOWS ? join(process.cwd(), 'gog.exe') : join(process.cwd(), 'gog_linux');
const TARGET_GOG_BIN = IS_WINDOWS ? SOURCE_GOG_BIN : '/tmp/gog_linux';
const GOG_CONFIG_DIR = IS_WINDOWS
  ? `${process.env.APPDATA}\\gogcli`
  : '/tmp/gogcli';

/**
 * Ensures the gog binary is executable.
 * On Vercel (Linux), we must copy it to /tmp because the source dir is read-only.
 */
function ensureGogBinary() {
  if (IS_WINDOWS) return TARGET_GOG_BIN;
  
  try {
    if (!existsSync(TARGET_GOG_BIN)) {
      console.log(`[ensureGogBinary] Copying binary from ${SOURCE_GOG_BIN} to ${TARGET_GOG_BIN}...`);
      const binaryData = readFileSync(SOURCE_GOG_BIN);
      writeFileSync(TARGET_GOG_BIN, binaryData);
    }
    
    // Always attempt chmod to be safe (it's allowed in /tmp)
    execSync(`chmod +x ${TARGET_GOG_BIN}`);
    return TARGET_GOG_BIN;
  } catch (err: any) {
    console.error(`[ensureGogBinary] Failed to prepare binary: ${err.message}`);
    return SOURCE_GOG_BIN; // Fallback to original path
  }
}

// On Linux (Vercel): write credentials and token from env vars to /tmp so gog can find them
async function setupGogAuth(telegramId: string, accountToUse?: string) {
  console.log(`[setupGogAuth] Starting for telegramId: ${telegramId}, account: ${accountToUse}`);
  if (!IS_WINDOWS) {
    try {
      if (!existsSync(GOG_CONFIG_DIR)) mkdirSync(GOG_CONFIG_DIR, { recursive: true });
      
      const gogBin = ensureGogBinary();
      const resolvedTargetAccount = accountToUse || process.env.GOG_ACCOUNT;
      const envOpts = { 
        env: { 
          ...process.env, 
          XDG_CONFIG_HOME: '/tmp', 
          HOME: '/tmp',
          GOG_KEYRING_PASSWORD: 'open_gravity_dummy_pass'
        } 
      };

      // Force gogcli to use a file-based keyring
      execSync(`${gogBin} config set keyring_backend file`, envOpts);

      // 1. Write the GCP Client ID Credentials
      if (process.env.GOG_CLIENT_CREDENTIALS_JSON) {
        const credPath = join(GOG_CONFIG_DIR, 'credentials.json');
        if (!existsSync(credPath)) {
          console.log(`[setupGogAuth] Writing credentials to ${credPath}...`);
          writeFileSync(credPath, process.env.GOG_CLIENT_CREDENTIALS_JSON);
        }
      }
      
      // 2. Fetch User-Specific Token from DB/API
      console.log(`[setupGogAuth] Fetching token for ${telegramId}...`);
      const accessToken = await getValidToken(telegramId);
      if (accessToken && resolvedTargetAccount) {
        console.log(`[setupGogAuth] Token found. Importing...`);
        const tokenJson = JSON.stringify({ access_token: accessToken, token_type: 'Bearer', email: resolvedTargetAccount });
        const tempTokenPath = join('/tmp', `temp_token_${resolvedTargetAccount}.json`);
        writeFileSync(tempTokenPath, tokenJson);
        
        try {
          execSync(`${gogBin} auth tokens import "${tempTokenPath}" --account "${resolvedTargetAccount}" --no-input`, envOpts);
        } catch (importErr: any) {
          console.error('[setupGogAuth] Error importing token:', importErr.message);
        } finally {
          if (existsSync(tempTokenPath)) unlinkSync(tempTokenPath);
        }
      } else if (!accessToken) {
          console.log(`[setupGogAuth] No token found for ${telegramId}. Throwing error.`);
          throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
      }
    } catch (e: any) {
      console.warn('Could not setup gog credentials:', e.message);
      throw e;
    }
  }
}

async function runGogCommand(telegramId: string, command: string, account?: string): Promise<string> {
  const resolvedAccount = account && account.includes('@') ? account : process.env.GOG_ACCOUNT;
  await setupGogAuth(telegramId, resolvedAccount);
  const gogBin = ensureGogBinary();
  
  try {
    const accountFlag = resolvedAccount ? `--account "${resolvedAccount}"` : '';
    const fullCommand = `${gogBin} ${command} ${accountFlag}`.trim();
    
    const { stdout, stderr } = await execPromise(fullCommand, {
      env: { 
        ...process.env, 
        XDG_CONFIG_HOME: '/tmp', 
        HOME: '/tmp',
        GOG_KEYRING_PASSWORD: 'open_gravity_dummy_pass'
      }
    });

    if (stderr && stderr.length > 0 && !stderr.includes('Imported refresh token')) {
      console.warn(`gog stderr: ${stderr}`);
    }
    return stdout || 'Command executed successfully.';
  } catch (error: any) {
    if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
      throw error; // Let the specific tool handle the link generation
    }
    console.error(`Error executing gog command: ${error.message}`);
    return `Error: ${error.message}${error.stderr ? `\nStderr: ${error.stderr}` : ''}`;
  }
}

// GMAIL SEARCH
const gmailSearchDef: ToolDefinition = {
  name: 'gmail_search',
  description: 'Search for emails in Gmail.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max: { type: 'number', description: 'Max results' },
      account: { type: 'string', description: 'Gmail address to use (optional if default is set)' }
    },
    required: ['query']
  }
};

registerTool({
  definition: gmailSearchDef,
  execute: async ({ query, max = 10, account }, { telegramId }) => {
    console.log(`[gmail_search] Called by telegramId: ${telegramId}`);
    try {
      return await runGogCommand(String(telegramId), `gmail search "${query}" --max ${max} --json --no-input`, account);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
        return `❌ **Cuenta de Google no conectada**\n\nNecesito tu permiso para acceder a Gmail. Por favor, conéctala aquí:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
      }
      throw e;
    }
  }
});

// GMAIL SEND
const gmailSendDef: ToolDefinition = {
  name: 'gmail_send',
  description: 'Send an email via Gmail.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient' },
      subject: { type: 'string', description: 'Subject' },
      body: { type: 'string', description: 'Content' },
      account: { type: 'string', description: 'Gmail address to use' }
    },
    required: ['to', 'subject', 'body']
  }
};

registerTool({
  definition: gmailSendDef,
  execute: async ({ to, subject, body, account }, { telegramId }) => {
    try {
      const resolvedAccount = account && account.includes('@') ? account : process.env.GOG_ACCOUNT;
      await setupGogAuth(String(telegramId), resolvedAccount);
      
      const accountFlag = resolvedAccount ? `--account "${resolvedAccount}"` : '';
      const gogBin = ensureGogBinary();
      const output = execSync(`${gogBin} gmail send --to "${to}" --subject "${subject}" --body-file - ${accountFlag}`, {
        input: body,
        encoding: 'utf-8',
        env: { 
          ...process.env, 
          XDG_CONFIG_HOME: '/tmp', 
          HOME: '/tmp',
          GOG_KEYRING_PASSWORD: 'open_gravity_dummy_pass'
        }
      });
      return output || 'Email sent successfully.';
    } catch (error: any) {
        if (error.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
          return `❌ **Cuenta de Google no conectada**\n\nNecesito tu permiso para enviar correos. Conéctala aquí:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
        }
        return `Error sending email: ${error.message}`;
    }
  }
});

// CALENDAR LIST
const calendarListDef: ToolDefinition = {
  name: 'calendar_list_events',
  description: 'List calendar events.',
  parameters: {
    type: 'object',
    properties: {
      calendarId: { type: 'string', description: 'ID of calendar' },
      from: { type: 'string', description: 'ISO Start date' },
      to: { type: 'string', description: 'ISO End date' },
      account: { type: 'string', description: 'Gmail address to use' }
    },
    required: ['calendarId', 'from', 'to']
  }
};

registerTool({
  definition: calendarListDef,
  execute: async ({ calendarId, from, to, account }, { telegramId }) => {
    try {
      return await runGogCommand(String(telegramId), `calendar events "${calendarId}" --from "${from}" --to "${to}" --json`, account);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
        return `❌ **Calendar no conectado**\n\nConecta tu cuenta para ver tus eventos:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
      }
      throw e;
    }
  }
});

// CALENDAR CREATE
const calendarCreateDef: ToolDefinition = {
  name: 'calendar_create_event',
  description: 'Create a calendar event.',
  parameters: {
    type: 'object',
    properties: {
      calendarId: { type: 'string', description: 'ID of calendar' },
      summary: { type: 'string', description: 'Summary/Title' },
      from: { type: 'string', description: 'ISO Start' },
      to: { type: 'string', description: 'ISO End' },
      account: { type: 'string', description: 'Gmail address to use' }
    },
    required: ['calendarId', 'summary', 'from', 'to']
  }
};

registerTool({
  definition: calendarCreateDef,
  execute: async ({ calendarId, summary, from, to, account }, { telegramId }) => {
    try {
      return await runGogCommand(String(telegramId), `calendar create "${calendarId}" --summary "${summary}" --from "${from}" --to "${to}" --json`, account);
    } catch (e: any) {
      if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
        const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
        return `❌ **Calendar no conectado**\n\nConecta tu cuenta para crear eventos:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
      }
      throw e;
    }
  }
});

// CONTACTS LIST
const contactsListDef: ToolDefinition = {
    name: 'contacts_list',
    description: 'List Google Contacts.',
    parameters: {
      type: 'object',
      properties: {
        max: { type: 'number', description: 'Max results' }
      }
    }
  };
  
  registerTool({
    definition: contactsListDef,
    execute: async ({ max = 20 }, { telegramId }) => {
      try {
        return await runGogCommand(String(telegramId), `contacts list --max ${max} --json`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
          return `❌ **Contactos no conectados**\n\nConecta tu cuenta para ver tus contactos:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
        }
        throw e;
      }
    }
  });

// SHEETS GET
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
        return await runGogCommand(String(telegramId), `sheets get "${sheetId}" "${range}" --json`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
          return `❌ **Sheets no conectado**\n\nConecta tu cuenta para leer hojas de cálculo:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
        }
        throw e;
      }
    }
  });

// SHEETS APPEND
const sheetsAppendDef: ToolDefinition = {
    name: 'sheets_append',
    description: 'Append rows to a Google Sheet.',
    parameters: {
      type: 'object',
      properties: {
        sheetId: { type: 'string', description: 'The Spreadsheet ID' },
        range: { type: 'string', description: 'The range to append to (e.g., "A:C")' },
        values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '2D array of values' }
      },
      required: ['sheetId', 'range', 'values']
    }
  };
  
  registerTool({
    definition: sheetsAppendDef,
    execute: async ({ sheetId, range, values }, { telegramId }) => {
      try {
        const valuesJson = JSON.stringify(values);
        return await runGogCommand(String(telegramId), `sheets append "${sheetId}" "${range}" --values-json '${valuesJson}' --insert INSERT_ROWS`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
          return `❌ **Sheets no conectado**\n\nConecta tu cuenta para añadir datos:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
        }
        throw e;
      }
    }
  });

// DOCS CAT
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
        return await runGogCommand(String(telegramId), `docs cat "${docId}"`);
      } catch (e: any) {
        if (e.message === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
          const loginUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/api/auth/google/login?telegram_id=${telegramId}`;
          return `❌ **Google Docs no conectado**\n\nConecta tu cuenta para leer documentos:\n\n[TELEGRAM_WEB_APP:${loginUrl}]`;
        }
        throw e;
      }
    }
  });

// OPEN WORKSPACE MINI APP (Option B)
const openWorkspaceAppDef: ToolDefinition = {
    name: 'og_open_workspace_app',
    description: 'Opens a Google Doc or Sheet in an interactive Mini App for viewing and AI interaction.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The Document or Spreadsheet ID' },
        type: { type: 'string', enum: ['doc', 'sheet'], description: 'Type of file' },
        title: { type: 'string', description: 'Title of the document' },
        telegram_id: { type: 'number', description: 'Telegram user ID' }
      },
      required: ['id', 'type', 'title', 'telegram_id']
    }
};

registerTool({
    definition: openWorkspaceAppDef,
    execute: async ({ id, type, title, telegram_id }, { telegramId }) => {
        try {
            // Use the telegramId from context if available, fallback to the one in args
            const resolvedTelegramId = telegramId || telegram_id;
            
            // 1. Fetch content
            const content = await runGogCommand(String(resolvedTelegramId), type === 'doc' ? `docs cat "${id}"` : `sheets get "${id}" "A1:Z100" --json`);
            
            // Validate content - check for common Google CLI error patterns
            if (!content || content.startsWith('Error:') || content.includes('not found') || content.includes('Google API error')) {
                return `❌ No he podido abrir el archivo "${title}".
                
El identificador "${id}" no parece ser un ID de Google válido o el archivo no existe. 

**¿Qué puedes intentar?**
1.  **Búsqueda Asistida**: Pídeme "Busca en mi Google Drive el archivo '...'" y yo encontraré el ID técnico por ti.
2.  **Copia el ID de la URL**: El ID es la cadena larga que aparece en la barra de direcciones de tu navegador (ej: 1ABC...xyz).
3.  **Formato Nativo**: Asegúrate de que el archivo sea un Google Doc o Sheet real, no un archivo subido (como un .docx o .xlsx sin convertir).`;
            }

            // 2. Generate a unique snapshot ID
            const snapshotId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            
            // 3. Save as a snapshot in Knowledge Hub
            const knowledgeApi = `${env.CLIENTVERSE_API_URL}/api/opengravity/knowledge.php`;
            const token = 'og_secret_default_key_2026';
            
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            try {
                console.log(`[og_open_workspace_app] Saving ${content.length} characters to Knowledge Hub...`);
                await fetch(knowledgeApi, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        telegram_id,
                        topic: snapshotId,
                        content: content,
                        category: 'document',
                        metadata: { original_title: title, original_id: id, type: type }
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            // 4. Return the Mini App link
            const miniAppUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/workspace/${snapshotId}`;
            return `Documento procesado correctamente. Puedes abrirlo e interactuar con la IA aquí:\n\n[TELEGRAM_WEB_APP:${miniAppUrl}]`;
        
        } catch (error: any) {
            console.error(`[og_open_workspace_app] Error:`, error);
            if (error.name === 'AbortError') {
                return `⚠️ La operación tardó demasiado. Si el documento es muy grande, intenta de nuevo en unos segundos.`;
            }
            return `Error opening interactive workspace: ${error.message}`;
        }
    }
});
