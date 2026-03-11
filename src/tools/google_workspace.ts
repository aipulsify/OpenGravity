import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const execPromise = promisify(exec);

// Determine gog binary path based on OS
const IS_WINDOWS = platform() === 'win32';
const GOG_BIN = IS_WINDOWS ? '.\\gog.exe' : join(process.cwd(), 'gog_linux');
const GOG_CONFIG_DIR = IS_WINDOWS
  ? `${process.env.APPDATA}\\gogcli`
  : '/tmp/gogcli';

// On Linux (Vercel): write credentials and token from env vars to /tmp so gog can find them
function setupGogAuth() {
  if (!IS_WINDOWS) {
    try {
      if (!existsSync(GOG_CONFIG_DIR)) mkdirSync(GOG_CONFIG_DIR, { recursive: true });
      
      // 1. Write the GCP Client ID Credentials
      if (process.env.GOG_CLIENT_CREDENTIALS_JSON) {
        writeFileSync(join(GOG_CONFIG_DIR, 'credentials.json'), process.env.GOG_CLIENT_CREDENTIALS_JSON);
      }
      
      // 2. Write the User Session Token using the account name
      if (process.env.GOG_TOKEN_JSON && process.env.GOG_ACCOUNT) {
        const tokenFileName = `token_${process.env.GOG_ACCOUNT}.json`;
        writeFileSync(join(GOG_CONFIG_DIR, tokenFileName), process.env.GOG_TOKEN_JSON);
      }
    } catch (e) {
      console.warn('Could not write gog credentials:', e);
    }
  }
}

async function runGogCommand(command: string, account?: string): Promise<string> {
  setupGogAuth();
  try {
    // Only pass --account if it looks like a real email address (not placeholder text)
    const resolvedAccount = account && account.includes('@') ? account : process.env.GOG_ACCOUNT;
    const accountFlag = resolvedAccount ? `--account "${resolvedAccount}"` : '';
    const fullCommand = `${GOG_BIN} ${command} ${accountFlag}`.trim();
    const { stdout, stderr } = await execPromise(fullCommand, {
      env: { ...process.env, XDG_CONFIG_HOME: '/tmp' }
    });
    if (stderr) {
      console.warn(`gog stderr: ${stderr}`);
    }
    return stdout || 'Command executed successfully.';
  } catch (error: any) {
    console.error(`Error executing gog command: ${error.message}`);
    if (error.message.includes('not recognized') || error.message.includes('ENOENT')) {
        return "Error: The 'gog' CLI tool is not installed or not in the system path.";
    }
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
  execute: async ({ query, max = 10, account }) => {
    return runGogCommand(`gmail search "${query}" --max ${max} --json --no-input`, account);
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
  execute: async ({ to, subject, body, account }) => {
    setupGogAuth();
    try {
      const resolvedAccount = account && account.includes('@') ? account : process.env.GOG_ACCOUNT;
      const accountFlag = resolvedAccount ? `--account "${resolvedAccount}"` : '';
      
      const output = execSync(`${GOG_BIN} gmail send --to "${to}" --subject "${subject}" --body-file - ${accountFlag}`, {
        input: body,
        encoding: 'utf-8',
        env: { ...process.env, XDG_CONFIG_HOME: '/tmp' }
      });
      return output || 'Email sent successfully.';
    } catch (error: any) {
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
  execute: async ({ calendarId, from, to, account }) => {
    return runGogCommand(`calendar events "${calendarId}" --from "${from}" --to "${to}" --json`, account);
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
  execute: async ({ calendarId, summary, from, to, account }) => {
    return runGogCommand(`calendar create "${calendarId}" --summary "${summary}" --from "${from}" --to "${to}" --json`, account);
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
    execute: async ({ max = 20 }) => {
      return runGogCommand(`contacts list --max ${max} --json`);
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
    execute: async ({ sheetId, range }) => {
      return runGogCommand(`sheets get "${sheetId}" "${range}" --json`);
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
    execute: async ({ sheetId, range, values }) => {
      const valuesJson = JSON.stringify(values);
      return runGogCommand(`sheets append "${sheetId}" "${range}" --values-json '${valuesJson}' --insert INSERT_ROWS`);
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
    execute: async ({ docId }) => {
      return runGogCommand(`docs cat "${docId}"`);
    }
  });
