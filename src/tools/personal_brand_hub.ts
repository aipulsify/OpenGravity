import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { env } from '../config/env.js';

export const pbhGetArticlesDef: ToolDefinition = {
  name: 'pbh_get_articles',
  description: 'Get articles from PersonalBrandHub.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  }
};

registerTool({
  definition: pbhGetArticlesDef,
  execute: async () => {
    try {
      // The user specified a POST request with an empty body
      const response = await fetch(`${env.PERSONAL_BRAND_HUB_URL}/get_articles.php`, {
        method: 'POST',
        body: ''
      });

      if (!response.ok) {
        return `Error: PersonalBrandHub API returned ${response.status} ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } catch (error: any) {
      return `Error calling PersonalBrandHub API: ${error.message}`;
    }
  }
});
