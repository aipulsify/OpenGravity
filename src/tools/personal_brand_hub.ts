import { registerTool, type ToolDefinition } from '../agent/tools.js';
import { env } from '../config/env.js';

export const pbhGetArticlesDef: ToolDefinition = {
  name: 'pbh_get_articles',
  description: 'Get articles from PersonalBrandHub with optional filters.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max records to fetch (default 20)' },
      period: { type: 'string', enum: ['today', 'yesterday', 'week'], description: 'Filter by date period' },
      status: { type: 'string', enum: ['initialized', 'ready', 'publish', 'published', 'generating'], description: 'Filter by article status' }
    },
    required: []
  }
};

registerTool({
  definition: pbhGetArticlesDef,
  execute: async ({ limit, period, status }) => {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (period) params.append('period', period);
      if (status) params.append('status', status);

      const queryString = params.toString();
      const url = `${env.PERSONAL_BRAND_HUB_URL}/get_articles.php${queryString ? `?${queryString}` : ''}`;
      
      console.log(`[pbh_get_articles] Calling API: ${url}`);

      const response = await fetch(url, {
        method: 'GET'
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
