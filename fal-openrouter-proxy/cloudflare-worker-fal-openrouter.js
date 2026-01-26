/**
 * fal.ai OpenRouter -> OpenAI 兼容代理
 * 
 * 功能：
 * - 将标准 OpenAI 格式的请求转换为 fal 格式
 * - 支持普通请求和流式响应
 * - 支持 CORS 跨域
 * - /v1/models 从 OpenRouter 获取完整模型列表（含图像模型）
 * - 图像生成模型自动添加 modalities 参数
 * - 智能 image_config（仅 Gemini/Seedream）：默认 4K 1:1，支持从提示词解析
 * - 图像生成响应自动转换为 Markdown 图片格式（只返回第一张）
 * - 思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）
 * - Anthropic 格式兼容（/v1/messages → OpenAI，保留 cache_control）
 * - 通用 CORS 代理（/proxy?url=xxx）：转发任意请求并添加 CORS 头
 * - 余额查询（/v1/dashboard/billing/*）：OpenAI 兼容格式
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard
 * 2. 创建 Workers & Pages -> Create Worker
 * 3. 粘贴此代码并 Deploy
 * 4. 获取 Worker URL 使用
 * 
 * 在 NewAPI 中配置：
 * - 渠道类型: OpenAI
 * - 渠道地址: https://your-worker.workers.dev
 * - API 密钥: 您的 fal.ai API 密钥
 */

// ==================== 常量配置 ====================

const FAL_BASE_URL = "https://fal.run/openrouter/router/openai/v1";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_IMAGE_MODELS_URL = "https://openrouter.ai/api/frontend/models/find?output_modalities=image";
const FAL_BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";

// 图像生成模型默认配置
const IMAGE_MODEL_DEFAULTS = {
  image_size: "4K",
  aspect_ratio: "1:1",
};

// 需要应用智能 image_config 的模型
const SMART_IMAGE_CONFIG_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image-preview",
  "bytedance-seed/seedream-4.5",
];

// 已知的图像生成模型列表
const KNOWN_IMAGE_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image-preview",
  "bytedance-seed/seedream-4.5",
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini",
  "openai/gpt-image-1",
  "black-forest-labs/flux.2-max",
  "black-forest-labs/flux.2-flex",
  "black-forest-labs/flux.2-pro",
  "sourceful/riverflow-v2-max-preview",
  "sourceful/riverflow-v2-standard-preview",
  "sourceful/riverflow-v2-fast-preview",
];

// 思考模型映射配置
const THINKING_MODEL_MAPPINGS = {
  "deepseek/deepseek-v3.2-thinking": "deepseek/deepseek-v3.2",
  "deepseek/deepseek-chat-v3.1-thinking": "deepseek/deepseek-chat-v3.1:free",
  "deepseek/deepseek-r1-thinking": "deepseek/deepseek-r1",
};

// CORS 响应头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// 静态定价表（$/M tokens）- 作为 fallback
const MODEL_PRICING_FALLBACK = {
  "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "anthropic/claude-opus-4.5": { input: 5, output: 25 },
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-opus-4": { input: 15, output: 75 },
  "anthropic/claude-3.7-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3-opus": { input: 15, output: 75 },
  "anthropic/claude-3-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
  "anthropic/claude-3.5-haiku": { input: 0.8, output: 4 },
};

// 动态定价缓存
let modelPricingCache = null;
let pricingCacheTime = 0;
const PRICING_CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 天缓存

// ==================== 主入口 ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // 路由处理
      const path = url.pathname;

      // 首页 - 显示使用说明
      if (path === "/" || path === "") {
        return handleRoot(url);
      }

      // 通用 CORS 代理
      if (path === "/proxy") {
        return await handleProxyRequest(request, url);
      }

      // 模型列表
      if (path === "/v1/models" || path === "/models") {
        return await fetchOpenRouterModels();
      }

      // 健康检查
      if (path === "/health") {
        return handleHealth();
      }

      // Anthropic 格式端点 - /v1/messages
      if (path === "/v1/messages" || path === "/messages") {
        return await handleAnthropicRequest(request, env);
      }

      // 调试端点 - 查看转换后的请求
      if (path === "/v1/messages/debug" || path === "/messages/debug") {
        return await debugAnthropicRequest(request);
      }

      // 余额查询端点
      if (path === "/v1/dashboard/billing/subscription" || path === "/dashboard/billing/subscription") {
        return await handleBalanceRequest(request, env, "subscription");
      }
      if (path === "/v1/dashboard/billing/credit_grants" || path === "/dashboard/billing/credit_grants") {
        return await handleBalanceRequest(request, env, "credit_grants");
      }
      if (path === "/v1/dashboard/billing/usage" || path === "/dashboard/billing/usage") {
        return await handleBalanceRequest(request, env, "usage");
      }

      // 其他 /v1/* 路径 - 通用代理
      if (path.startsWith("/v1/") || path.startsWith("/chat/") || path.startsWith("/embeddings")) {
        return await handleOpenAIProxy(request, env, url);
      }

      // 未匹配的路径
      return jsonResponse({
        error: {
          message: `Path ${path} not found`,
          type: "not_found_error",
          code: "not_found",
        },
      }, 404);

    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse({
        error: {
          message: `Internal error: ${error.message}`,
          type: "internal_error",
          code: "internal_error",
        },
      }, 500);
    }
  },
};

// ==================== 路由处理函数 ====================

/**
 * 首页 - 显示 API 使用说明
 */
function handleRoot(url) {
  return jsonResponse({
    service: "fal.ai OpenRouter Proxy",
    version: "2.0.0",
    description: "Cloudflare Worker proxy for fal.ai OpenRouter API with OpenAI/Anthropic compatibility",
    usage: {
      base_url: `${url.origin}/v1`,
      api_key: "your-fal-api-key",
      example: "client = OpenAI(base_url='此URL/v1', api_key='your-fal-key')",
    },
    endpoints: {
      "/": "API 信息和文档",
      "/health": "健康检查",
      "/v1/models": "模型列表（从 OpenRouter 动态获取）",
      "/v1/chat/completions": "Chat Completions (OpenAI 兼容)",
      "/v1/messages": "Messages (Anthropic 兼容，自动转换)",
      "/v1/messages/debug": "调试端点，查看 Anthropic→OpenAI 转换结果",
      "/v1/embeddings": "Embeddings (透传)",
      "/v1/responses": "Responses (透传)",
      "/v1/dashboard/billing/subscription": "余额查询 (OpenAI 格式)",
      "/v1/dashboard/billing/credit_grants": "额度查询 (OpenAI 格式)",
      "/proxy?url=<target_url>": "通用 CORS 代理",
    },
    features: [
      "OpenAI Chat Completions API 完整兼容",
      "Anthropic Messages API 自动转换（/v1/messages → OpenAI，保留 cache_control）",
      "思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled）",
      "图像生成模型自动添加 modalities 参数",
      "智能 image_config（仅 Gemini/Seedream）：默认 4K 1:1，支持从提示词解析",
      "图像生成响应自动转换为 Markdown 图片格式",
      "模型列表合并 frontend API，包含完整图像模型",
      "余额查询（OpenAI 兼容格式）",
      "通用 CORS 代理：/proxy?url=xxx",
      "流式响应支持 (SSE)",
    ],
    thinking_models: THINKING_MODEL_MAPPINGS,
    image_config: {
      enabled_models: SMART_IMAGE_CONFIG_MODELS,
      defaults: IMAGE_MODEL_DEFAULTS,
      prompt_keywords: {
        resolution: ["1K", "2K", "4K"],
        aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "横屏", "竖屏", "方形"],
      },
      priority: "提示词 > 请求参数 > 默认值",
    },
    docs: {
      fal_ai: "https://docs.fal.ai",
      openrouter: "https://openrouter.ai/docs",
    },
  });
}

/**
 * 健康检查
 */
function handleHealth() {
  return jsonResponse({
    status: "ok",
    timestamp: new Date().toISOString(),
    upstream: FAL_BASE_URL,
  });
}

/**
 * 处理 OpenAI 兼容 API 请求（核心代理逻辑）
 */
async function handleOpenAIProxy(request, env, url) {
  // 获取 API Key
  const falKey = extractApiKey(request, env);
  if (!falKey) {
    return jsonResponse({
      error: {
        message: "Missing API key. Provide 'Authorization: Bearer YOUR_FAL_KEY' header",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    }, 401);
  }

  // 构建目标 URL
  let targetPath = url.pathname;
  if (targetPath.startsWith("/v1")) {
    targetPath = targetPath.slice(3);
  }
  const targetUrl = `${FAL_BASE_URL}${targetPath}${url.search}`;

  // 构建请求头
  const headers = new Headers();
  headers.set("Authorization", `Key ${falKey}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", request.headers.get("Accept") || "application/json");

  // 透传 User-Agent
  const userAgent = request.headers.get("User-Agent");
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }

  const fetchOptions = {
    method: request.method,
    headers: headers,
  };

  // 处理请求体（POST/PUT）
  if (request.method === "POST" || request.method === "PUT") {
    try {
      const bodyText = await request.text();
      let body = JSON.parse(bodyText);

      // 处理思考模型路由
      if (body.model) {
        body = applyThinkingModelRouting(body);
      }

      // 为图像生成模型添加 modalities 参数和智能 image_config
      if (body.model && isImageGenerationModel(body.model)) {
        if (!body.modalities || !Array.isArray(body.modalities)) {
          body.modalities = ["image", "text"];
        }
        body = applySmartImageConfig(body);
      }

      fetchOptions.body = JSON.stringify(body);
    } catch (e) {
      // JSON 解析失败，使用原始请求体
      fetchOptions.body = request.body;
    }
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get("Content-Type") || "";

    // 构建响应头
    const responseHeaders = new Headers(CORS_HEADERS);
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    // 透传 Rate Limit headers
    const rateLimitHeaders = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];
    for (const h of rateLimitHeaders) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    // 流式响应：直接透传
    if (contentType.includes("text/event-stream")) {
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // 非流式响应：检查并转换图像格式
    const data = await response.text();

    if (contentType.includes("application/json")) {
      try {
        const jsonData = JSON.parse(data);
        const transformedData = transformImageResponse(jsonData);
        return new Response(JSON.stringify(transformedData), {
          status: response.status,
          headers: responseHeaders,
        });
      } catch (e) {
        // JSON 解析失败，返回原始数据
      }
    }

    return new Response(data, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return jsonResponse({
      error: {
        message: `Proxy error: ${error.message}`,
        type: "proxy_error",
        code: "upstream_error",
      },
    }, 502);
  }
}

/**
 * 处理余额查询请求
 */
async function handleBalanceRequest(request, env, format) {
  const falKey = extractApiKey(request, env);
  if (!falKey) {
    return jsonResponse({
      error: { message: "Unauthorized", type: "authentication_error" },
    }, 401);
  }

  try {
    const response = await fetch(FAL_BALANCE_URL, {
      headers: {
        "Authorization": `Key ${falKey}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      let errorMsg = `Failed to fetch balance: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.detail || errorData.message || errorMsg;
      } catch (e) { }
      return jsonResponse({ error: { message: errorMsg, type: "upstream_error" } }, response.status);
    }

    const balanceText = await response.text();
    const rawBalance = parseFloat(balanceText);

    if (isNaN(rawBalance)) {
      return jsonResponse({ error: { message: "Invalid balance format", type: "parse_error" } }, 502);
    }

    const balance = Math.round(rawBalance * 100) / 100;

    // 根据格式返回不同响应
    if (format === "subscription") {
      return jsonResponse({
        object: "billing_subscription",
        has_payment_method: true,
        soft_limit_usd: balance,
        hard_limit_usd: balance,
        system_hard_limit_usd: balance,
        access_until: Math.floor(Date.now() / 1000) + 86400 * 365,
      });
    }

    if (format === "credit_grants") {
      const balanceCents = Math.round(balance * 100);
      return jsonResponse({
        object: "credit_summary",
        total_granted: balanceCents,
        total_used: 0,
        total_available: balanceCents,
        grants: {
          object: "list",
          data: [{
            object: "credit_grant",
            id: "fal-balance",
            grant_amount: balanceCents,
            used_amount: 0,
            effective_at: Math.floor(Date.now() / 1000),
            expires_at: null,
          }],
        },
      });
    }

    if (format === "usage") {
      return jsonResponse({
        object: "billing_usage",
        total_usage: 0,
        daily_costs: [],
      });
    }

    return jsonResponse({ balance: balance, currency: "USD" });
  } catch (error) {
    return jsonResponse({
      error: { message: `Failed to fetch balance: ${error.message}`, type: "upstream_error" },
    }, 502);
  }
}

/**
 * 从 OpenRouter 获取模型列表（合并图像模型）
 */
async function fetchOpenRouterModels() {
  try {
    const [modelsResponse, imageModelsResponse] = await Promise.all([
      fetch(OPENROUTER_MODELS_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "fal-openai-proxy/2.0.0",
        },
      }),
      fetch(OPENROUTER_IMAGE_MODELS_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "fal-openai-proxy/2.0.0",
        },
      }),
    ]);

    if (!modelsResponse.ok) {
      return jsonResponse({
        error: { message: `Failed to fetch models: ${modelsResponse.status}`, type: "upstream_error" },
      }, modelsResponse.status);
    }

    const modelsData = await modelsResponse.json();
    const existingModels = modelsData.data || [];
    const existingIds = new Set(existingModels.map(m => m.id));

    // 尝试获取图像模型并合并
    if (imageModelsResponse.ok) {
      try {
        const imageData = await imageModelsResponse.json();
        const imageModels = imageData?.data?.models || [];

        for (const imgModel of imageModels) {
          const modelId = imgModel.slug;
          if (modelId && !existingIds.has(modelId)) {
            existingModels.push({
              id: modelId,
              name: imgModel.name || modelId,
              description: imgModel.description || "",
              context_length: imgModel.context_length || 4096,
              architecture: {
                modality: "text+image->text+image",
                input_modalities: imgModel.input_modalities || ["text", "image"],
                output_modalities: imgModel.output_modalities || ["image"],
                tokenizer: "Unknown",
              },
              pricing: {
                prompt: "0",
                completion: "0",
                image: "0.04",
              },
            });
            existingIds.add(modelId);
          }
        }
      } catch (e) {
        // 忽略图像模型获取失败
      }
    }

    return jsonResponse({ object: "list", data: existingModels });
  } catch (error) {
    return jsonResponse({
      error: { message: `Failed to fetch models: ${error.message}`, type: "upstream_error" },
    }, 502);
  }
}

/**
 * 通用 CORS 代理
 */
async function handleProxyRequest(request, url) {
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return jsonResponse({
      error: {
        message: "Missing 'url' parameter. Usage: /proxy?url=<encoded_url>",
        type: "invalid_request",
        example: "/proxy?url=" + encodeURIComponent("https://api.fal.ai/v1/models/usage"),
      },
    }, 400);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return jsonResponse({
      error: {
        message: "Invalid URL format",
        type: "invalid_request",
        provided_url: targetUrl,
      },
    }, 400);
  }

  // 构建请求头（排除 Cloudflare 特有头）
  const headers = new Headers();
  const excludeHeaders = ["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-for", "x-forwarded-proto", "x-real-ip"];

  for (const [key, value] of request.headers.entries()) {
    if (!excludeHeaders.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  const fetchOptions = {
    method: request.method,
    headers: headers,
  };

  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    fetchOptions.body = request.body;
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const responseHeaders = new Headers(CORS_HEADERS);

    const contentType = response.headers.get("Content-Type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    const passHeaders = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-request-id"];
    for (const h of passHeaders) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return jsonResponse({
      error: {
        message: `Proxy error: ${error.message}`,
        type: "proxy_error",
        target_url: targetUrl,
      },
    }, 502);
  }
}

// ==================== Anthropic 格式兼容 ====================

/**
 * 处理 Anthropic 格式请求 (/v1/messages)
 */
async function handleAnthropicRequest(request, env) {
  const falKey = extractApiKey(request, env);
  if (!falKey) {
    return jsonResponse({
      type: "error",
      error: {
        type: "authentication_error",
        message: "Missing API key. Provide 'Authorization: Bearer YOUR_FAL_KEY' or 'x-api-key' header",
      },
    }, 401);
  }

  if (request.method !== "POST") {
    return jsonResponse({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Only POST method is supported",
      },
    }, 405);
  }

  let anthropicBody;
  try {
    anthropicBody = await request.json();
  } catch (e) {
    return jsonResponse({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Invalid JSON body",
      },
    }, 400);
  }

  const isStream = anthropicBody.stream === true;
  const openaiBody = convertAnthropicToOpenAI(anthropicBody);

  const headers = new Headers();
  headers.set("Authorization", `Key ${falKey}`);
  headers.set("Content-Type", "application/json");
  if (isStream) {
    headers.set("Accept", "text/event-stream");
  }

  const targetUrl = `${FAL_BASE_URL}/chat/completions`;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(openaiBody),
    });

    const contentType = response.headers.get("Content-Type") || "";
    const responseHeaders = new Headers(CORS_HEADERS);

    // 流式响应处理
    if (isStream && contentType.includes("text/event-stream")) {
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");

      const pricing = await getModelPricing(anthropicBody.model);
      const transformStream = new TransformStream({
        transform: createStreamTransformer(anthropicBody.model, pricing),
      });

      return new Response(response.body.pipeThrough(transformStream), {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // 流式请求但上游返回非流式响应（通常是错误）
    if (isStream && !contentType.includes("text/event-stream")) {
      const errorData = await response.text();
      let errorMessage = "Upstream error";
      try {
        const errorJson = JSON.parse(errorData);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch (e) {
        errorMessage = errorData || errorMessage;
      }
      responseHeaders.set("Content-Type", "text/event-stream");
      const errorEvent = encodeSSE("error", {
        type: "error",
        error: { type: "api_error", message: errorMessage },
      });
      return new Response(errorEvent, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // 非流式响应处理
    if (!response.ok) {
      const errorData = await response.text();
      try {
        const errorJson = JSON.parse(errorData);
        return jsonResponse({
          type: "error",
          error: {
            type: "api_error",
            message: errorJson.error?.message || "Upstream error",
          },
        }, response.status);
      } catch (e) {
        return jsonResponse({
          type: "error",
          error: {
            type: "api_error",
            message: errorData || "Upstream error",
          },
        }, response.status);
      }
    }

    const openaiResponse = await response.json();
    const anthropicResponse = await convertOpenAIToAnthropic(openaiResponse, anthropicBody.model);

    responseHeaders.set("Content-Type", "application/json");
    return new Response(JSON.stringify(anthropicResponse), {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    return jsonResponse({
      type: "error",
      error: {
        type: "api_error",
        message: `Proxy error: ${error.message}`,
      },
    }, 502);
  }
}

/**
 * 调试端点 - 查看 Anthropic 请求转换后的 OpenAI 格式
 */
async function debugAnthropicRequest(request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "POST only" }, 405);
  }
  try {
    const anthropicBody = await request.json();
    const openaiBody = convertAnthropicToOpenAI(anthropicBody);
    return jsonResponse({
      original: anthropicBody,
      converted: openaiBody,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 400);
  }
}

/**
 * 将 Anthropic 请求格式转换为 OpenAI 格式
 */
function convertAnthropicToOpenAI(anthropicBody) {
  const openaiBody = {
    model: anthropicBody.model,
    stream: anthropicBody.stream || false,
    messages: [],
  };

  if (anthropicBody.max_tokens) {
    openaiBody.max_tokens = anthropicBody.max_tokens;
  }
  if (anthropicBody.temperature !== undefined) {
    openaiBody.temperature = anthropicBody.temperature;
  }
  if (anthropicBody.top_p !== undefined) {
    openaiBody.top_p = anthropicBody.top_p;
  }
  if (anthropicBody.stop_sequences) {
    openaiBody.stop = anthropicBody.stop_sequences;
  }
  if (anthropicBody.top_k !== undefined) {
    openaiBody.top_k = anthropicBody.top_k;
  }

  if (anthropicBody.stream) {
    openaiBody.stream_options = { include_usage: true };
  }
  openaiBody.usage = { include: true };

  // 转换 system prompt（保留 cache_control）
  if (anthropicBody.system) {
    if (typeof anthropicBody.system === "string") {
      // 字符串格式，无法添加 cache_control
      openaiBody.messages.push({
        role: "system",
        content: anthropicBody.system,
      });
    } else if (Array.isArray(anthropicBody.system)) {
      // 数组格式，保留完整结构（包括 cache_control）
      const systemContent = anthropicBody.system.map(block => {
        if (block.type === "text") {
          const textBlock = { type: "text", text: block.text };
          if (block.cache_control) {
            textBlock.cache_control = block.cache_control;
          }
          return textBlock;
        }
        return block;
      });
      openaiBody.messages.push({
        role: "system",
        content: systemContent,
      });
    }
  }

  // 转换 messages
  if (anthropicBody.messages) {
    for (const msg of anthropicBody.messages) {
      const convertedMsg = convertAnthropicMessage(msg);
      if (convertedMsg.__isToolResults) {
        openaiBody.messages.push(...convertedMsg.toolResults);
        if (convertedMsg.additionalMessage) {
          openaiBody.messages.push(convertedMsg.additionalMessage);
        }
      } else {
        openaiBody.messages.push(convertedMsg);
      }
    }
  }

  // 转换 tools
  if (anthropicBody.tools && anthropicBody.tools.length > 0) {
    openaiBody.tools = anthropicBody.tools.map(tool => {
      const converted = {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.input_schema || { type: "object", properties: {} },
        },
      };
      if (tool.cache_control) {
        converted.cache_control = tool.cache_control;
      }
      return converted;
    });
  }

  // 转换 tool_choice
  if (anthropicBody.tool_choice) {
    if (anthropicBody.tool_choice.type === "auto") {
      openaiBody.tool_choice = "auto";
    } else if (anthropicBody.tool_choice.type === "any") {
      openaiBody.tool_choice = "required";
    } else if (anthropicBody.tool_choice.type === "tool" && anthropicBody.tool_choice.name) {
      openaiBody.tool_choice = {
        type: "function",
        function: { name: anthropicBody.tool_choice.name },
      };
    }
  }

  return applyThinkingModelRouting(openaiBody);
}

/**
 * 转换单条 Anthropic 消息为 OpenAI 格式
 */
function convertAnthropicMessage(msg) {
  const converted = { role: msg.role };

  if (typeof msg.content === "string") {
    converted.content = msg.content;
  } else if (Array.isArray(msg.content)) {
    const hasSpecialBlocks = msg.content.some(b =>
      b.cache_control || b.type === "image" || b.type === "image_url"
    );

    const convertedContent = msg.content.map(block => {
      if (block.type === "text") {
        const textBlock = { type: "text", text: block.text };
        if (block.cache_control) {
          textBlock.cache_control = block.cache_control;
        }
        return textBlock;
      } else if (block.type === "image") {
        let imageUrl = "";
        if (block.source?.type === "base64") {
          imageUrl = `data:${block.source.media_type};base64,${block.source.data}`;
        } else if (block.source?.type === "url") {
          imageUrl = block.source.url || "";
        }
        return {
          type: "image_url",
          image_url: { url: imageUrl },
        };
      } else if (block.type === "tool_use" || block.type === "tool_result") {
        return block;
      }
      return block;
    });

    const textOnlyBlocks = convertedContent.filter(b => b.type === "text" && !b.cache_control);
    if (!hasSpecialBlocks && textOnlyBlocks.length === convertedContent.length) {
      converted.content = textOnlyBlocks.map(b => b.text).join("\n");
    } else {
      converted.content = convertedContent;
    }
  }

  // 处理 tool_calls
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    const toolUses = msg.content.filter(b => b.type === "tool_use");
    if (toolUses.length > 0) {
      converted.tool_calls = toolUses.map(tu => ({
        id: tu.id,
        type: "function",
        function: {
          name: tu.name,
          arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input),
        },
      }));
      const textBlocks = msg.content.filter(b => b.type === "text");
      if (textBlocks.length > 0) {
        converted.content = textBlocks.map(b => b.text).join("\n");
      } else {
        converted.content = null;
      }
    }
  }

  // 处理 tool_result
  if (msg.role === "user" && Array.isArray(msg.content)) {
    const toolResults = msg.content.filter(b => b.type === "tool_result");
    const otherBlocks = msg.content.filter(b => b.type !== "tool_result");

    if (toolResults.length > 0) {
      const result = {
        __isToolResults: true,
        toolResults: toolResults.map(tr => {
          const toolMsg = {
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: formatToolResultContent(tr.content),
          };
          if (tr.is_error) {
            toolMsg.content = `[ERROR] ${toolMsg.content}`;
          }
          return toolMsg;
        }),
      };

      if (otherBlocks.length > 0) {
        result.additionalMessage = {
          role: "user",
          content: otherBlocks.map(block => {
            if (block.type === "text") {
              const textBlock = { type: "text", text: block.text };
              if (block.cache_control) {
                textBlock.cache_control = block.cache_control;
              }
              return textBlock;
            }
            return block;
          }),
        };
      }
      return result;
    }
  }

  return converted;
}

/**
 * 格式化 tool_result 的 content
 */
function formatToolResultContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n") || JSON.stringify(content);
  }
  return JSON.stringify(content);
}

/**
 * 将 OpenAI 响应格式转换为 Anthropic 格式
 */
async function convertOpenAIToAnthropic(openaiResponse, model) {
  const choice = openaiResponse.choices?.[0];
  if (!choice) {
    return {
      type: "error",
      error: {
        type: "api_error",
        message: "No response from upstream",
      },
    };
  }

  const message = choice.message;
  const content = [];

  if (message.content) {
    content.push({
      type: "text",
      text: message.content,
    });
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch (e) {
        input = tc.function.arguments;
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: input,
      });
    }
  }

  let stopReason = "end_turn";
  if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") {
    stopReason = "tool_use";
  } else if (choice.finish_reason === "length") {
    stopReason = "max_tokens";
  }

  const totalPromptTokens = openaiResponse.usage?.prompt_tokens || 0;
  const outputTokens = openaiResponse.usage?.completion_tokens || 0;

  // 提取缓存 token - 支持多种数据源格式
  let cacheReadTokens = 
    openaiResponse.usage?.prompt_tokens_details?.cached_tokens ||
    openaiResponse.usage?.cache_read_input_tokens ||
    openaiResponse.usage?.cached_tokens ||  // fallback
    0;
  let cacheCreationTokens = 
    openaiResponse.usage?.cache_creation_input_tokens ||
    openaiResponse.usage?.prompt_tokens_details?.cache_creation_tokens ||  // fallback
    0;

  if (openaiResponse.usage?.cost) {
    const estimated = await estimateCacheTokensFromCost(
      totalPromptTokens,
      outputTokens,
      openaiResponse.usage.cost,
      model,
      cacheReadTokens
    );
    cacheReadTokens = estimated.cacheReadTokens;
    cacheCreationTokens = estimated.cacheCreationTokens;
  }

  const inputTokens = Math.max(0, totalPromptTokens - cacheReadTokens - cacheCreationTokens);

  return {
    id: openaiResponse.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: model || openaiResponse.model,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  };
}

/**
 * 创建流式响应转换器 (OpenAI SSE → Anthropic SSE)
 */
function createStreamTransformer(model, pricing) {
  let buffer = "";
  let messageId = `msg_${Date.now()}`;
  let totalPromptTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let totalCost = 0;
  let sentStart = false;
  let textBlockStarted = false;
  let toolCallsStarted = new Map();
  let toolCallNames = new Map();
  let finalStopReason = "end_turn";
  let contentBlocksStopped = false;

  return async function transform(chunk, controller) {
    const text = new TextDecoder().decode(chunk);
    buffer += text;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();

      if (data === "[DONE]") {
        if (totalCost > 0 && pricing) {
          const estimated = estimateCacheTokensFromCostSync(
            totalPromptTokens,
            outputTokens,
            totalCost,
            pricing,
            cacheReadTokens
          );
          cacheReadTokens = estimated.cacheReadTokens;
          cacheCreationTokens = estimated.cacheCreationTokens;
        }

        const inputTokens = Math.max(0, totalPromptTokens - cacheReadTokens - cacheCreationTokens);

        if (!sentStart) {
          controller.enqueue(encodeSSE("message_start", {
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              model: model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            },
          }));
          controller.enqueue(encodeSSE("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }));
          controller.enqueue(encodeSSE("content_block_stop", {
            type: "content_block_stop",
            index: 0,
          }));
        }

        controller.enqueue(encodeSSE("message_delta", {
          type: "message_delta",
          delta: { stop_reason: finalStopReason, stop_sequence: null },
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens,
          },
        }));

        controller.enqueue(encodeSSE("message_stop", { type: "message_stop" }));
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        const finishReason = parsed.choices?.[0]?.finish_reason;

        if (parsed.usage) {
          totalPromptTokens = parsed.usage.prompt_tokens || totalPromptTokens;
          outputTokens = parsed.usage.completion_tokens || outputTokens;

          if (parsed.usage.cost) {
            totalCost = parsed.usage.cost;
          }

          // 提取缓存读取 token（支持多种格式）
          if (parsed.usage.prompt_tokens_details?.cached_tokens) {
            cacheReadTokens = parsed.usage.prompt_tokens_details.cached_tokens;
          } else if (parsed.usage.cache_read_input_tokens) {
            cacheReadTokens = parsed.usage.cache_read_input_tokens;
          } else if (parsed.usage.cached_tokens) {
            cacheReadTokens = parsed.usage.cached_tokens;
          }

          // 提取缓存创建 token（支持多种格式）
          if (parsed.usage.cache_creation_input_tokens) {
            cacheCreationTokens = parsed.usage.cache_creation_input_tokens;
          } else if (parsed.usage.prompt_tokens_details?.cache_creation_tokens) {
            cacheCreationTokens = parsed.usage.prompt_tokens_details.cache_creation_tokens;
          }
        }

        if (!parsed.choices || parsed.choices.length === 0) {
          continue;
        }

        if (!sentStart) {
          sentStart = true;
          controller.enqueue(encodeSSE("message_start", {
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              model: model || parsed.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: totalPromptTokens, output_tokens: 0 },
            },
          }));
        }

        if (delta?.content) {
          if (!textBlockStarted) {
            textBlockStarted = true;
            controller.enqueue(encodeSSE("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }));
          }
          controller.enqueue(encodeSSE("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta.content },
          }));
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;
            const anthropicIndex = textBlockStarted ? tcIndex + 1 : tcIndex;

            if (tc.function?.name) {
              const existingName = toolCallNames.get(tcIndex) || "";
              toolCallNames.set(tcIndex, existingName + tc.function.name);
            }

            if (tc.id && !toolCallsStarted.has(tc.id)) {
              const name = toolCallNames.get(tcIndex) || tc.function?.name || "";
              toolCallsStarted.set(tc.id, { index: anthropicIndex, name });
              controller.enqueue(encodeSSE("content_block_start", {
                type: "content_block_start",
                index: anthropicIndex,
                content_block: {
                  type: "tool_use",
                  id: tc.id,
                  name: name,
                  input: {},
                },
              }));
            }

            if (tc.function?.arguments) {
              controller.enqueue(encodeSSE("content_block_delta", {
                type: "content_block_delta",
                index: anthropicIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function.arguments,
                },
              }));
            }
          }
        }

        if (finishReason && !contentBlocksStopped) {
          contentBlocksStopped = true;

          if (finishReason === "tool_calls" || finishReason === "function_call") {
            finalStopReason = "tool_use";
          } else if (finishReason === "length") {
            finalStopReason = "max_tokens";
          }

          if (!textBlockStarted && toolCallsStarted.size === 0) {
            controller.enqueue(encodeSSE("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }));
            controller.enqueue(encodeSSE("content_block_stop", {
              type: "content_block_stop",
              index: 0,
            }));
          } else {
            if (textBlockStarted) {
              controller.enqueue(encodeSSE("content_block_stop", {
                type: "content_block_stop",
                index: 0,
              }));
            }
            for (const [, info] of toolCallsStarted) {
              controller.enqueue(encodeSSE("content_block_stop", {
                type: "content_block_stop",
                index: info.index,
              }));
            }
          }
        }

      } catch (e) {
        // 解析失败，忽略
      }
    }
  };
}

/**
 * 编码 SSE 事件
 */
function encodeSSE(event, data) {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ==================== 工具函数 ====================

/**
 * 从请求中提取 API Key
 */
function extractApiKey(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader.startsWith("Key ")) return authHeader.slice(4);
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  return env?.FAL_KEY || "";
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * 处理思考模型路由
 */
function applyThinkingModelRouting(body) {
  const model = body.model;

  if (THINKING_MODEL_MAPPINGS[model]) {
    body.model = THINKING_MODEL_MAPPINGS[model];
    body.reasoning = { enabled: true };
    return body;
  }

  const thinkingMatch = model?.match(/-thinking$/i);
  if (thinkingMatch) {
    const actualModel = model.slice(0, -thinkingMatch[0].length);
    body.model = actualModel;
    body.reasoning = { enabled: true };
  }

  return body;
}

/**
 * 判断是否是图像生成模型
 */
function isImageGenerationModel(model) {
  if (!model) return false;
  const modelLower = model.toLowerCase();
  if (KNOWN_IMAGE_MODELS.some(m => m.toLowerCase() === modelLower)) {
    return true;
  }
  return modelLower.includes("-image") || modelLower.includes("image-") ||
    modelLower.includes("seedream") || modelLower.includes("flux") ||
    modelLower.includes("riverflow");
}

/**
 * 从提示词中解析 image_config 参数
 */
function parseImageConfigFromPrompt(messages) {
  if (!messages || !Array.isArray(messages)) return {};

  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length === 0) return {};

  const lastMessage = userMessages[userMessages.length - 1];
  const content = typeof lastMessage.content === "string"
    ? lastMessage.content
    : (lastMessage.content?.find?.(c => c.type === "text")?.text || "");

  const result = {};

  // 检测分辨率
  if (/\b4k\b/i.test(content)) {
    result.image_size = "4K";
  } else if (/\b2k\b/i.test(content)) {
    result.image_size = "2K";
  } else if (/\b1k\b/i.test(content)) {
    result.image_size = "1K";
  }

  // 检测宽高比
  if (/16[:：]9/.test(content)) {
    result.aspect_ratio = "16:9";
  } else if (/9[:：]16/.test(content)) {
    result.aspect_ratio = "9:16";
  } else if (/1[:：]1/.test(content)) {
    result.aspect_ratio = "1:1";
  } else if (/4[:：]3/.test(content)) {
    result.aspect_ratio = "4:3";
  } else if (/3[:：]4/.test(content)) {
    result.aspect_ratio = "3:4";
  } else if (/3[:：]2/.test(content)) {
    result.aspect_ratio = "3:2";
  } else if (/2[:：]3/.test(content)) {
    result.aspect_ratio = "2:3";
  } else if (/横(屏|版|图)|landscape|widescreen|宽屏/i.test(content)) {
    result.aspect_ratio = "16:9";
  } else if (/竖(屏|版|图)|portrait|vertical|手机壁纸/i.test(content)) {
    result.aspect_ratio = "9:16";
  } else if (/方(形|图)|square|正方/i.test(content)) {
    result.aspect_ratio = "1:1";
  }

  return result;
}

/**
 * 应用智能 image_config
 */
function applySmartImageConfig(body) {
  const modelLower = (body.model || "").toLowerCase();
  const shouldApply = SMART_IMAGE_CONFIG_MODELS.some(m => m.toLowerCase() === modelLower);

  if (!shouldApply) {
    return body;
  }

  const promptConfig = parseImageConfigFromPrompt(body.messages);

  const finalConfig = {
    image_size: promptConfig.image_size || body.image_config?.image_size || IMAGE_MODEL_DEFAULTS.image_size,
    aspect_ratio: promptConfig.aspect_ratio || body.image_config?.aspect_ratio || IMAGE_MODEL_DEFAULTS.aspect_ratio,
  };

  body.image_config = finalConfig;
  return body;
}

/**
 * 转换图像生成响应为 Markdown 格式
 */
function transformImageResponse(data) {
  if (!data?.choices?.length) return data;

  for (const choice of data.choices) {
    const message = choice.message;
    if (!message?.images?.length) continue;

    let content = "";

    if (message.content && typeof message.content === 'string' && message.content.trim()) {
      content = message.content.trim() + "\n\n";
    }

    const img = message.images[0];
    const url = img?.image_url?.url || img?.image_url;
    if (url) {
      content += `![Generated Image](${url})`;
    }

    message.content = content.trim();
    delete message.images;
  }

  return data;
}

// ==================== 定价和缓存估算 ====================

/**
 * 从 OpenRouter API 获取模型定价
 */
async function fetchModelPricing() {
  if (modelPricingCache && Date.now() - pricingCacheTime < PRICING_CACHE_TTL) {
    return modelPricingCache;
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pricing = {};

    for (const model of (data.data || [])) {
      if (model.pricing) {
        pricing[model.id] = {
          input: parseFloat(model.pricing.prompt) * 1_000_000 || 0,
          output: parseFloat(model.pricing.completion) * 1_000_000 || 0,
          cacheRead: parseFloat(model.pricing.input_cache_read) * 1_000_000 || 0,
          cacheWrite: parseFloat(model.pricing.input_cache_write) * 1_000_000 || 0,
        };
      }
    }

    modelPricingCache = pricing;
    pricingCacheTime = Date.now();
    return pricing;
  } catch (e) {
    return null;
  }
}

/**
 * 获取模型定价
 */
async function getModelPricing(model) {
  const dynamicPricing = await fetchModelPricing();
  if (dynamicPricing && dynamicPricing[model]) {
    return dynamicPricing[model];
  }

  const fallback = MODEL_PRICING_FALLBACK[model] || MODEL_PRICING_FALLBACK[model?.toLowerCase()];
  if (fallback) {
    return {
      input: fallback.input,
      output: fallback.output,
      cacheRead: fallback.input * 0.1,
      cacheWrite: fallback.input * 1.25,
    };
  }

  return null;
}

/**
 * 从 cost 反推缓存 tokens
 */
async function estimateCacheTokensFromCost(promptTokens, completionTokens, totalCost, model, cachedTokens = 0) {
  if (promptTokens <= 0 || totalCost <= 0) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  const pricing = await getModelPricing(model);
  if (!pricing) {
    return { cacheReadTokens: cachedTokens, cacheCreationTokens: 0 };
  }

  const inputPrice = pricing.input / 1_000_000;
  const outputPrice = pricing.output / 1_000_000;
  const cacheReadPrice = pricing.cacheRead / 1_000_000;
  const cacheWritePrice = pricing.cacheWrite / 1_000_000;

  const cacheReadDiscount = inputPrice > 0 ? 1 - (cacheReadPrice / inputPrice) : 0.9;
  const cacheWriteExtra = inputPrice > 0 ? (cacheWritePrice / inputPrice) - 1 : 0.25;

  const normalCost = promptTokens * inputPrice + completionTokens * outputPrice;

  if (cachedTokens > 0) {
    const cacheSavings = cachedTokens * inputPrice * cacheReadDiscount;
    const expectedCost = normalCost - cacheSavings;
    const extraCost = totalCost - expectedCost;

    let cacheWrite = 0;
    if (extraCost > inputPrice * 0.1 && cacheWriteExtra > 0) {
      cacheWrite = Math.round(extraCost / (inputPrice * cacheWriteExtra));
      cacheWrite = Math.max(0, Math.min(cacheWrite, promptTokens - cachedTokens));
    }

    return { cacheReadTokens: cachedTokens, cacheCreationTokens: cacheWrite };
  }

  const costDiff = totalCost - normalCost;
  const tolerance = inputPrice * 10;

  if (Math.abs(costDiff) < tolerance) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  if (costDiff > 0 && cacheWriteExtra > 0) {
    const cacheWrite = Math.round(costDiff / (inputPrice * cacheWriteExtra));
    if (cacheWrite > 0 && cacheWrite <= promptTokens) {
      return { cacheReadTokens: 0, cacheCreationTokens: cacheWrite };
    }
  } else if (costDiff < 0 && cacheReadDiscount > 0) {
    const savedCost = -costDiff;
    const cacheRead = Math.round(savedCost / (inputPrice * cacheReadDiscount));
    if (cacheRead > 0 && cacheRead <= promptTokens) {
      return { cacheReadTokens: cacheRead, cacheCreationTokens: 0 };
    }
  }

  return { cacheReadTokens: 0, cacheCreationTokens: 0 };
}

/**
 * 同步版本的缓存计算
 */
function estimateCacheTokensFromCostSync(promptTokens, completionTokens, totalCost, pricing, cachedTokens = 0) {
  if (promptTokens <= 0 || totalCost <= 0 || !pricing) {
    return { cacheReadTokens: cachedTokens, cacheCreationTokens: 0 };
  }

  const inputPrice = pricing.input / 1_000_000;
  const outputPrice = pricing.output / 1_000_000;
  const cacheReadPrice = pricing.cacheRead / 1_000_000;
  const cacheWritePrice = pricing.cacheWrite / 1_000_000;

  const cacheReadDiscount = inputPrice > 0 ? 1 - (cacheReadPrice / inputPrice) : 0.9;
  const cacheWriteExtra = inputPrice > 0 ? (cacheWritePrice / inputPrice) - 1 : 0.25;

  const normalCost = promptTokens * inputPrice + completionTokens * outputPrice;

  if (cachedTokens > 0) {
    const cacheSavings = cachedTokens * inputPrice * cacheReadDiscount;
    const expectedCost = normalCost - cacheSavings;
    const extraCost = totalCost - expectedCost;

    let cacheWrite = 0;
    if (extraCost > inputPrice * 0.1 && cacheWriteExtra > 0) {
      cacheWrite = Math.round(extraCost / (inputPrice * cacheWriteExtra));
      cacheWrite = Math.max(0, Math.min(cacheWrite, promptTokens - cachedTokens));
    }

    return { cacheReadTokens: cachedTokens, cacheCreationTokens: cacheWrite };
  }

  const costDiff = totalCost - normalCost;
  const tolerance = inputPrice * 10;

  if (Math.abs(costDiff) < tolerance) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  if (costDiff > 0 && cacheWriteExtra > 0) {
    const cacheWrite = Math.round(costDiff / (inputPrice * cacheWriteExtra));
    if (cacheWrite > 0 && cacheWrite <= promptTokens) {
      return { cacheReadTokens: 0, cacheCreationTokens: cacheWrite };
    }
  } else if (costDiff < 0 && cacheReadDiscount > 0) {
    const savedCost = -costDiff;
    const cacheRead = Math.round(savedCost / (inputPrice * cacheReadDiscount));
    if (cacheRead > 0 && cacheRead <= promptTokens) {
      return { cacheReadTokens: cacheRead, cacheCreationTokens: 0 };
    }
  }

  return { cacheReadTokens: 0, cacheCreationTokens: 0 };
}
