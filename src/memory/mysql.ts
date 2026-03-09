import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions.js';

// Crear el pool de conexiones usando los datos de ClientVerse
const pool = mysql.createPool({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  port: Number(env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Inicializar las tablas para OpenGravity
export async function initDatabase() {
  // Las tablas ya han sido creadas manualmente en Clientverse.
  // Solo comprobamos que conectamos.
  try {
    await pool.query('SELECT 1 FROM og_chat_memory LIMIT 1');
    console.log("ClientVerse OpenGravity tables connected.");
  } catch(e) {
      console.warn("Could not connect to tables. Ensure DB credentials are correct and MySQL is running.");
      throw e;
  }
}

export async function getRecentMessages(telegramId: number, limit: number = 20): Promise<ChatCompletionMessageParam[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT role, content, tool_calls FROM og_chat_memory WHERE telegram_id = ? ORDER BY id DESC LIMIT ?',
    [telegramId, limit]
  );
  
  // Vienen de más nuevo a más viejo, revertimos
  return rows.reverse().map(row => {
    const msg: any = { role: row.role };
    if (row.content) msg.content = row.content;
    if (row.tool_calls) msg.tool_calls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
    return msg as ChatCompletionMessageParam;
  });
}

export async function addMessage(telegramId: number, message: ChatCompletionMessageParam): Promise<void> {
  const role = message.role;
  let content = null;
  let tool_calls = null;

  if ('content' in message && message.content) {
      // @ts-ignore
      content = message.content;
  }
  
  if ('tool_calls' in message && message.tool_calls) {
      tool_calls = JSON.stringify(message.tool_calls);
  }

  // Handle case for tool response which has tool_call_id
  if (role === 'tool' && 'tool_call_id' in message) {
    // we just store the content for now. A more robust implementation would link it to the call.
  }

  await pool.query(
    'INSERT INTO og_chat_memory (telegram_id, role, content, tool_calls) VALUES (?, ?, ?, ?)',
    [telegramId, role, content, tool_calls]
  );
}

export async function clearMemory(telegramId: number): Promise<void> {
  await pool.query('DELETE FROM og_chat_memory WHERE telegram_id = ?', [telegramId]);
}
