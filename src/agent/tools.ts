export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface Tool {
  definition: ToolDefinition;
  execute: (args: any) => Promise<string> | string;
}

export const toolRegistry: Record<string, Tool> = {};

export function registerTool(tool: Tool) {
  toolRegistry[tool.definition.name] = tool;
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return Object.values(toolRegistry).map(t => t.definition);
}
