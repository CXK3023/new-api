/**
 * Cloudflare Worker - fal.ai OpenRouter 代理
 * 
 * 此 Worker 将 OpenAI 兼容的 API 请求转发到 fal.ai 的 OpenRouter 端点
 * 支持流式和非流式响应，完整的错误处理
 * 
 * 在 NewAPI 中配置:
 * - 渠道类型: OpenAI
 * - 渠道地址: https://your-worker.workers.dev
 * - API 密钥: 您的 fal.ai API 密钥
 */

// fal.ai OpenRouter OpenAI 兼容端点
const FAL_OPENROUTER_BASE_URL = 'https://fal.run/openrouter/router/openai/v1';

// CORS 头配置
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

/**
 * 主入口函数
 */
export default {
  async fetch(request, env, ctx) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 路由处理
      if (path === '/' || path === '') {
        return handleRoot();
      }

      if (path === '/health') {
        return handleHealth();
      }

      if (path === '/v1/models') {
        return handleModels(request);
      }

      if (path === '/v1/chat/completions') {
        return await handleChatCompletions(request);
      }

      // 其他 /v1/* 路径透传
      if (path.startsWith('/v1/')) {
        return await handleGenericProxy(request, path);
      }

      // 未匹配的路径
      return createErrorResponse(404, 'not_found', `Path ${path} not found`);

    } catch (error) {
      console.error('Worker error:', error);
      return createErrorResponse(500, 'internal_error', error.message || 'Internal server error');
    }
  }
};

/**
 * 处理 CORS 预检请求
 */
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * 处理根路径 - 返回 API 信息
 */
function handleRoot() {
  const info = {
    name: 'fal.ai OpenRouter Proxy',
    version: '1.0.0',
    description: 'Cloudflare Worker proxy for fal.ai OpenRouter API with OpenAI compatibility',
    endpoints: {
      '/': 'API information',
      '/health': 'Health check',
      '/v1/models': 'List available models',
      '/v1/chat/completions': 'Chat completions (OpenAI compatible)',
    },
    documentation: {
      fal_ai: 'https://docs.fal.ai',
      openrouter: 'https://openrouter.ai/docs',
    },
    usage: {
      note: 'Configure this Worker URL as the base URL in your OpenAI-compatible client',
      authorization: 'Use your fal.ai API key as Bearer token',
      example: 'Authorization: Bearer your-fal-api-key',
    },
  };

  return new Response(JSON.stringify(info, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 处理健康检查
 */
function handleHealth() {
  return new Response(JSON.stringify({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    upstream: FAL_OPENROUTER_BASE_URL,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 处理模型列表请求
 */
async function handleModels(request) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return createErrorResponse(401, 'unauthorized', 'Missing Authorization header');
  }

  // 返回一些常用的 OpenRouter 模型
  const models = {
    object: 'list',
    data: [
      { id: 'google/gemini-2.5-flash', object: 'model', created: 1700000000, owned_by: 'google' },
      { id: 'google/gemini-2.5-pro', object: 'model', created: 1700000000, owned_by: 'google' },
      { id: 'anthropic/claude-sonnet-4', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'anthropic/claude-3.5-sonnet', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'anthropic/claude-3-opus', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'openai/gpt-4.1', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'openai/gpt-4o', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'openai/gpt-4-turbo', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'meta-llama/llama-4-maverick', object: 'model', created: 1700000000, owned_by: 'meta' },
      { id: 'meta-llama/llama-3.1-405b-instruct', object: 'model', created: 1700000000, owned_by: 'meta' },
      { id: 'mistralai/mistral-large', object: 'model', created: 1700000000, owned_by: 'mistral' },
      { id: 'deepseek/deepseek-chat', object: 'model', created: 1700000000, owned_by: 'deepseek' },
      { id: 'deepseek/deepseek-reasoner', object: 'model', created: 1700000000, owned_by: 'deepseek' },
    ],
  };

  return new Response(JSON.stringify(models), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 处理 Chat Completions 请求 - 核心功能
 */
async function handleChatCompletions(request) {
  // 验证请求方法
  if (request.method !== 'POST') {
    return createErrorResponse(405, 'method_not_allowed', 'Only POST method is allowed');
  }

  // 提取并转换认证头
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return createErrorResponse(401, 'unauthorized', 'Missing Authorization header');
  }

  // 转换 Bearer token 为 fal.ai 的 Key 格式
  const falAuthHeader = convertAuthHeader(authHeader);
  if (!falAuthHeader) {
    return createErrorResponse(401, 'invalid_auth', 'Invalid Authorization header format');
  }

  // 解析请求体
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    return createErrorResponse(400, 'invalid_json', 'Invalid JSON in request body');
  }

  // 验证必需字段
  if (!requestBody.model) {
    return createErrorResponse(400, 'invalid_request', 'Missing required field: model');
  }
  if (!requestBody.messages || !Array.isArray(requestBody.messages)) {
    return createErrorResponse(400, 'invalid_request', 'Missing or invalid field: messages');
  }

  // 检测是否为流式请求
  const isStream = requestBody.stream === true;

  // 构建上游请求
  const upstreamUrl = `${FAL_OPENROUTER_BASE_URL}/chat/completions`;
  const upstreamHeaders = {
    'Content-Type': 'application/json',
    'Authorization': falAuthHeader,
    'Accept': isStream ? 'text/event-stream' : 'application/json',
  };

  // 发送请求到 fal.ai
  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify(requestBody),
  });

  // 处理上游错误响应
  if (!upstreamResponse.ok) {
    return await handleUpstreamError(upstreamResponse);
  }

  // 根据请求类型处理响应
  if (isStream) {
    return handleStreamResponse(upstreamResponse);
  } else {
    return handleNonStreamResponse(upstreamResponse);
  }
}

/**
 * 转换认证头格式
 * Bearer xxx -> Key xxx
 */
function convertAuthHeader(authHeader) {
  if (!authHeader) return null;

  // 支持 "Bearer xxx" 格式
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7).trim();
    return `Key ${token}`;
  }

  // 支持直接传递 "Key xxx" 格式
  if (authHeader.toLowerCase().startsWith('key ')) {
    return authHeader;
  }

  // 支持直接传递 token (无前缀)
  if (!authHeader.includes(' ')) {
    return `Key ${authHeader}`;
  }

  return null;
}

/**
 * 处理非流式响应
 */
async function handleNonStreamResponse(upstreamResponse) {
  const responseBody = await upstreamResponse.text();
  
  // 尝试解析和验证 JSON
  let jsonResponse;
  try {
    jsonResponse = JSON.parse(responseBody);
  } catch (e) {
    // 如果不是有效 JSON，直接返回
    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  }

  // 检查是否有错误
  if (jsonResponse.error) {
    return new Response(JSON.stringify(jsonResponse), {
      status: upstreamResponse.status >= 400 ? upstreamResponse.status : 400,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      },
    });
  }

  return new Response(JSON.stringify(jsonResponse), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 处理流式响应 (SSE)
 */
function handleStreamResponse(upstreamResponse) {
  // 使用 TransformStream 透传流式响应
  const { readable, writable } = new TransformStream();

  // 异步处理流
  streamProcessor(upstreamResponse.body, writable);

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 处理流数据
 */
async function streamProcessor(readableStream, writableStream) {
  const reader = readableStream.getReader();
  const writer = writableStream.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      // 直接透传数据
      await writer.write(value);
    }
  } catch (error) {
    console.error('Stream processing error:', error);
    // 发送错误事件
    const errorEvent = `data: ${JSON.stringify({
      error: {
        message: error.message || 'Stream processing error',
        type: 'stream_error',
      }
    })}\n\n`;
    await writer.write(encoder.encode(errorEvent));
  } finally {
    await writer.close();
  }
}

/**
 * 处理上游 API 错误
 */
async function handleUpstreamError(response) {
  let errorBody;
  try {
    errorBody = await response.json();
  } catch (e) {
    errorBody = { error: { message: await response.text() || 'Unknown upstream error' } };
  }

  // 转换为 OpenAI 错误格式
  const error = errorBody.error || errorBody;
  const openAIError = {
    error: {
      message: error.message || error.detail || JSON.stringify(error),
      type: mapErrorType(response.status),
      code: error.code || mapErrorCode(response.status),
    },
  };

  return new Response(JSON.stringify(openAIError), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 通用代理处理 - 用于其他 /v1/* 端点
 */
async function handleGenericProxy(request, path) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return createErrorResponse(401, 'unauthorized', 'Missing Authorization header');
  }

  const falAuthHeader = convertAuthHeader(authHeader);
  if (!falAuthHeader) {
    return createErrorResponse(401, 'invalid_auth', 'Invalid Authorization header format');
  }

  // 构建上游 URL
  const upstreamUrl = `${FAL_OPENROUTER_BASE_URL}${path.replace('/v1', '')}`;

  // 复制请求头
  const headers = new Headers();
  headers.set('Authorization', falAuthHeader);
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  // 转发请求
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: headers,
    body: request.method !== 'GET' ? await request.text() : undefined,
  });

  // 透传响应
  const responseBody = await upstreamResponse.text();
  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 创建 OpenAI 格式的错误响应
 */
function createErrorResponse(status, code, message) {
  const error = {
    error: {
      message: message,
      type: mapErrorType(status),
      code: code,
    },
  };

  return new Response(JSON.stringify(error), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/**
 * 映射 HTTP 状态码到 OpenAI 错误类型
 */
function mapErrorType(status) {
  switch (status) {
    case 400:
      return 'invalid_request_error';
    case 401:
      return 'authentication_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 429:
      return 'rate_limit_error';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'server_error';
    default:
      return 'api_error';
  }
}

/**
 * 映射 HTTP 状态码到错误代码
 */
function mapErrorCode(status) {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'invalid_api_key';
    case 403:
      return 'access_denied';
    case 404:
      return 'not_found';
    case 429:
      return 'rate_limit_exceeded';
    case 500:
      return 'internal_error';
    case 502:
      return 'bad_gateway';
    case 503:
      return 'service_unavailable';
    case 504:
      return 'gateway_timeout';
    default:
      return 'unknown_error';
  }
}

