import { registerTool, type ToolDefinition } from '../agent/tools.js';

const definition: ToolDefinition = {
  name: 'get_current_time',
  description: 'Get the current date and time. Use this when you need to know the current time.',
  parameters: {
    type: 'object',
    properties: {}
  }
};

registerTool({
  definition,
  execute: () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      local: now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate()
    });
  }
});
