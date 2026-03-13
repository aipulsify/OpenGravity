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
      status: { type: 'string', enum: ['initialized', 'ready', 'publish', 'generating'], description: 'Filter by article status' }
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

export const pbhQueueGenerateDef: ToolDefinition = {
  name: 'pbh_queue_generate',
  description: 'Queue an article for generation in PersonalBrandHub (Async).',
  parameters: {
    type: 'object',
    properties: {
      guid: { type: 'string', description: 'Unique identifier for the article' },
      title: { type: 'string', description: 'Title of the news article' },
      source_url: { type: 'string', description: 'Original source URL of the news' }
    },
    required: ['guid', 'title', 'source_url']
  }
};

registerTool({
  definition: pbhQueueGenerateDef,
  execute: async ({ guid, title, source_url }) => {
    try {
      const url = `${env.PERSONAL_BRAND_HUB_ADMIN_URL}/queue_generate.php`;
      console.log(`[pbh_queue_generate] Calling API: ${url} for guid: ${guid}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ guid, title, source_url })
      });

      if (!response.ok) {
        return `Error: PersonalBrandHub Admin API returned ${response.status} ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } catch (error: any) {
      return `Error calling PersonalBrandHub Admin API: ${error.message}`;
    }
  }
});

export const pbhGetArticleStatusDef: ToolDefinition = {
  name: 'pbh_get_article_status',
  description: 'Check the generation status of an article in PersonalBrandHub.',
  parameters: {
    type: 'object',
    properties: {
      guid: { type: 'string', description: 'The unique identifier (GUID) of the article' }
    },
    required: ['guid']
  }
};

registerTool({
  definition: pbhGetArticleStatusDef,
  execute: async ({ guid }) => {
    try {
      const url = `${env.PERSONAL_BRAND_HUB_ADMIN_URL}/get_article_status.php?guid=${guid}`;
      console.log(`[pbh_get_article_status] Calling API: ${url}`);

      const response = await fetch(url, {
        method: 'GET'
      });

      if (!response.ok) {
        return `Error: PersonalBrandHub Admin API returned ${response.status} ${response.statusText}`;
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } catch (error: any) {
      return `Error calling PersonalBrandHub Admin API: ${error.message}`;
    }
  }
});

export const pbhOpenMiniAppDef: ToolDefinition = {
  name: 'pbh_open_mini_app',
  description: 'Provide an interactive Mini App button to view an article in PersonalBrandHub.',
  parameters: {
    type: 'object',
    properties: {
      guid: { type: 'string', description: 'The GUID of the article to view' },
      url: { type: 'string', description: 'Explicit URL to open (optional)' }
    },
    required: []
  }
};

registerTool({
  definition: pbhOpenMiniAppDef,
  execute: async ({ guid, url }) => {
    let targetUrl = url;
    if (!targetUrl && guid) {
      // PersonalBrandHub uses React Router: /article/:guid
      targetUrl = `${env.PERSONAL_BRAND_HUB_BASE_URL}/article/${guid}`;
    } else if (!targetUrl) {
      targetUrl = env.PERSONAL_BRAND_HUB_BASE_URL;
    }
    
    // We return a special directive for the bot to handle
    return `[TELEGRAM_WEB_APP:${targetUrl}]`;
  }
});


