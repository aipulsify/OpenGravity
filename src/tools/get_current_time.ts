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
    return new Date().toISOString();
  }
});
