/**
 * fal OpenRouter -> OpenAI 兼容代理
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
 * - 通用 CORS 代理（/proxy?url=xxx）：转发任意请求并添加 CORS 头
 * 
 * 智能 image_config（仅 Gemini/Seedream）优先级：提示词 > 请求参数 > 默认值(4K, 1:1)
 * 支持的提示词关键词：1K/2K/4K, 16:9/9:16/1:1, 横屏/竖屏/方形
 * 其他图像模型不会自动添加 image_config，需手动指定
 * 
 * 部署步骤：
 * 1. 登录 Cloudflare Dashboard
 * 2. 创建 Workers & Pages -> Create Worker
 * 3. 粘贴此代码并 Deploy
 * 4. 获取 Worker URL 使用
 */

const FAL_BASE_URL = "https://fal.run/openrouter/router/openai/v1";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_IMAGE_MODELS_URL = "https://openrouter.ai/api/frontend/models/find?output_modalities=image";
const FAL_BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";

// Anthropic 格式支持
const ANTHROPIC_ENDPOINT = "/v1/messages";

// 图像生成模型默认配置
const IMAGE_MODEL_DEFAULTS = {
  image_size: "4K",
  aspect_ratio: "1:1",
};

// 需要应用智能 image_config 的模型（已测试过）
const SMART_IMAGE_CONFIG_MODELS = [
  "google/gemini-3-pro-image-preview",
  "bytedance-seed/seedream-4.5",
];

// 已知的图像生成模型列表（用于判断是否需要添加 modalities）
const KNOWN_IMAGE_MODELS = [
  "google/gemini-3-pro-image-preview",
  "google/gemini-2.5-flash-image",
  "google/gemini-2.5-flash-image-preview",
  "bytedance-seed/seedream-4.5",
  "openai/gpt-5-image",
  "openai/gpt-5-image-mini",
  "black-forest-labs/flux.2-max",
  "black-forest-labs/flux.2-flex",
  "black-forest-labs/flux.2-pro",
  "sourceful/riverflow-v2-max-preview",
  "sourceful/riverflow-v2-standard-preview",
  "sourceful/riverflow-v2-fast-preview",
];

// 思考模型映射配置
// 格式: "虚拟模型名" -> "实际模型名"
// 当请求虚拟模型时，自动路由到实际模型并开启 reasoning
const THINKING_MODEL_MAPPINGS = {
  "deepseek/deepseek-v3.2-thinking": "deepseek/deepseek-v3.2",
  "deepseek/deepseek-chat-v3.1-thinking": "deepseek/deepseek-chat-v3.1:free",
  // 可以继续添加更多映射
};

// CORS 响应头
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 首页显示使用说明
    if (url.pathname === "/" || url.pathname === "") {
      return jsonResponse({
        service: "fal OpenRouter Proxy",
        version: "1.14.0",
        usage: {
          base_url: `${url.origin}/v1`,
          api_key: "your-fal-api-key",
          example: "client = OpenAI(base_url='此URL/v1', api_key='your-fal-key')",
        },
        endpoints: [
          "/v1/chat/completions",
          "/v1/messages (Anthropic 格式，自动转换)",
          "/v1/embeddings",
          "/v1/models",
          "/v1/responses",
          "/v1/dashboard/billing/subscription",
          "/v1/dashboard/billing/credit_grants",
          "/proxy?url=<target_url> (通用 CORS 代理)",
        ],
        features: [
          "Anthropic 格式自动转换（/v1/messages → OpenAI，保留 cache_control）",
          "思考模型自动路由（xxx-thinking -> xxx + reasoning.enabled，不区分大小写）",
          "图像生成模型自动添加 modalities 参数",
          "智能 image_config（仅 Gemini/Seedream）：默认 4K 1:1，支持从提示词解析",
          "图像生成响应自动转换为 Markdown 图片格式（只返回第一张）",
          "模型列表合并 frontend API，包含完整图像模型",
          "通用 CORS 代理：/proxy?url=xxx 转发请求并添加 CORS 头",
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
        proxy: {
          endpoint: "/proxy?url=<encoded_url>",
          description: "通用 CORS 代理，转发请求并添加 CORS 头",
          example: `${url.origin}/proxy?url=${encodeURIComponent("https://api.fal.ai/v1/models/usage")}`,
          supported_methods: ["GET", "POST", "PUT", "DELETE"],
          note: "请求头会被透传，响应会添加 CORS 头",
        },
        limitations: [
          "Gemini 4K 可能因 CF Worker 超时（100s）失败",
          "seedream-4.5 4K 正常工作（约 15s）",
        ],
        docs: "https://fal.ai/models/openrouter/router",
      });
    }

    // 通用 CORS 代理端点
    if (url.pathname === "/proxy") {
      return await handleProxyRequest(request, url);
    }

    // /v1/models 端点 - 从 OpenRouter 官方获取模型列表
    if (url.pathname === "/v1/models" || url.pathname === "/models") {
      return await fetchOpenRouterModels();
    }

    // Anthropic 格式端点 - /v1/messages
    if (url.pathname === ANTHROPIC_ENDPOINT || url.pathname === "/messages") {
      return await handleAnthropicRequest(request, env);
    }

    // 调试端点 - 查看转换后的请求（不实际发送）
    if (url.pathname === "/v1/messages/debug" || url.pathname === "/messages/debug") {
      return await debugAnthropicRequest(request);
    }

    // OpenAI 兼容的余额查询端点（供 NewAPI 等工具使用）
    if (
      url.pathname === "/v1/dashboard/billing/subscription" ||
      url.pathname === "/dashboard/billing/subscription"
    ) {
      const falKey = extractApiKey(request, env);
      if (!falKey) {
        return jsonResponse({ error: { message: "Unauthorized", type: "authentication_error" } }, 401);
      }
      return await fetchFalBalanceOpenAIFormat(falKey, "subscription");
    }

    if (
      url.pathname === "/v1/dashboard/billing/credit_grants" ||
      url.pathname === "/dashboard/billing/credit_grants"
    ) {
      const falKey = extractApiKey(request, env);
      if (!falKey) {
        return jsonResponse({ error: { message: "Unauthorized", type: "authentication_error" } }, 401);
      }
      return await fetchFalBalanceOpenAIFormat(falKey, "credit_grants");
    }

    if (
      url.pathname === "/v1/dashboard/billing/usage" ||
      url.pathname === "/dashboard/billing/usage"
    ) {
      const falKey = extractApiKey(request, env);
      if (!falKey) {
        return jsonResponse({ error: { message: "Unauthorized", type: "authentication_error" } }, 401);
      }
      return await fetchFalBalanceOpenAIFormat(falKey, "usage");
    }

    // 获取 API Key
    const falKey = extractApiKey(request, env);
    if (!falKey) {
      return jsonResponse(
        {
          error: {
            message: "Missing API key. Provide 'Authorization: Bearer YOUR_FAL_KEY' header",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        },
        401
      );
    }

    // 构建目标 URL
    let targetPath = url.pathname;
    if (targetPath.startsWith("/v1")) {
      targetPath = targetPath.slice(3);
    }
    const targetUrl = `${FAL_BASE_URL}${targetPath}${url.search}`;

    // 构建请求 headers
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
          // 应用智能 image_config（提示词 > 请求参数 > 默认 4K 1:1）
          body = applySmartImageConfig(body);
        }

        fetchOptions.body = JSON.stringify(body);
      } catch (e) {
        // JSON 解析失败，使用原始请求
        fetchOptions.body = request.body;
      }
    }

    try {
      const response = await fetch(targetUrl, fetchOptions);
      const contentType = response.headers.get("Content-Type") || "";

      // 构建响应 headers
      const responseHeaders = new Headers(CORS_HEADERS);
      if (contentType) {
        responseHeaders.set("Content-Type", contentType);
      }

      // 透传 Rate Limit headers
      const rateLimitHeaders = [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
      ];
      for (const h of rateLimitHeaders) {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      // 流式响应：直接透传 body
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
      return jsonResponse(
        {
          error: {
            message: `Proxy error: ${error.message}`,
            type: "proxy_error",
            code: "upstream_error",
          },
        },
        502
      );
    }
  },
};

/**
 * 处理思考模型路由
 * 将 xxx-thinking 模型路由到实际模型并开启 reasoning
 */
function applyThinkingModelRouting(body) {
  const model = body.model;

  // 检查是否在映射表中
  if (THINKING_MODEL_MAPPINGS[model]) {
    body.model = THINKING_MODEL_MAPPINGS[model];
    body.reasoning = { enabled: true };
    return body;
  }

  // 通用规则：如果模型名以 -thinking 结尾（不区分大小写），自动处理
  const thinkingMatch = model.match(/-thinking$/i);
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
  // 检查已知图像模型列表
  if (KNOWN_IMAGE_MODELS.some(m => m.toLowerCase() === modelLower)) {
    return true;
  }
  // 通用规则：模型名包含 image 或 seedream 或 flux 或 riverflow
  return modelLower.includes("-image") || modelLower.includes("image-") ||
    modelLower.includes("seedream") || modelLower.includes("flux") ||
    modelLower.includes("riverflow");
}

/**
 * 从提示词中解析 image_config 参数
 * 返回 { image_size, aspect_ratio } 或 null
 */
function parseImageConfigFromPrompt(messages) {
  if (!messages || !Array.isArray(messages)) return {};

  // 获取最后一条用户消息
  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length === 0) return {};

  const lastMessage = userMessages[userMessages.length - 1];
  const content = typeof lastMessage.content === "string"
    ? lastMessage.content
    : (lastMessage.content?.find?.(c => c.type === "text")?.text || "");

  const contentLower = content.toLowerCase();
  const result = {};

  // 检测分辨率关键词
  if (/\b4k\b/i.test(content)) {
    result.image_size = "4K";
  } else if (/\b2k\b/i.test(content)) {
    result.image_size = "2K";
  } else if (/\b1k\b/i.test(content)) {
    result.image_size = "1K";
  }

  // 检测宽高比关键词
  // 精确比例
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
  }
  // 语义关键词
  else if (/横(屏|版|图)|landscape|widescreen|宽屏/i.test(content)) {
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
 * 仅对 SMART_IMAGE_CONFIG_MODELS 中的模型生效
 * 优先级: 提示词 > 请求参数 > 默认值
 */
function applySmartImageConfig(body) {
  // 只对已测试的模型应用智能配置
  const modelLower = (body.model || "").toLowerCase();
  const shouldApply = SMART_IMAGE_CONFIG_MODELS.some(m => m.toLowerCase() === modelLower);

  if (!shouldApply) {
    return body;
  }

  // 从提示词解析配置
  const promptConfig = parseImageConfigFromPrompt(body.messages);

  // 合并配置（优先级: 提示词 > 请求参数 > 默认值）
  const finalConfig = {
    image_size: promptConfig.image_size || body.image_config?.image_size || IMAGE_MODEL_DEFAULTS.image_size,
    aspect_ratio: promptConfig.aspect_ratio || body.image_config?.aspect_ratio || IMAGE_MODEL_DEFAULTS.aspect_ratio,
  };

  body.image_config = finalConfig;
  return body;
}

/**
 * 转换图像生成响应
 * 将非标准的 images 字段转换为 Markdown 图片格式
 * 只返回第一张图片，避免重复
 */
function transformImageResponse(data) {
  if (!data?.choices?.length) return data;

  for (const choice of data.choices) {
    const message = choice.message;
    if (!message?.images?.length) continue;

    // 构建 Markdown 格式的内容
    let content = "";

    // 保留原有文本
    if (message.content && typeof message.content === 'string' && message.content.trim()) {
      content = message.content.trim() + "\n\n";
    }

    // 只取第一张图片
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

/**
 * 查询 fal.ai 账户余额（OpenAI 兼容格式，供 NewAPI 等工具使用）
 */
async function fetchFalBalanceOpenAIFormat(apiKey, format = "subscription") {
  try {
    const response = await fetch(FAL_BALANCE_URL, {
      headers: {
        "Authorization": `Key ${apiKey}`,
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

    // 保留两位小数
    const balance = Math.round(rawBalance * 100) / 100;

    // 根据请求的格式返回不同的响应结构
    if (format === "subscription") {
      // /dashboard/billing/subscription 格式
      return jsonResponse({
        object: "billing_subscription",
        has_payment_method: true,
        soft_limit_usd: balance,
        hard_limit_usd: balance,
        system_hard_limit_usd: balance,
        access_until: Math.floor(Date.now() / 1000) + 86400 * 365, // 1年后
      });
    }

    if (format === "credit_grants") {
      // /dashboard/billing/credit_grants 格式
      const balanceCents = Math.round(balance * 100);
      return jsonResponse({
        object: "credit_summary",
        total_granted: balanceCents,
        total_used: 0,
        total_available: balanceCents,
        grants: {
          object: "list",
          data: [
            {
              object: "credit_grant",
              id: "fal-balance",
              grant_amount: balanceCents,
              used_amount: 0,
              effective_at: Math.floor(Date.now() / 1000),
              expires_at: null,
            },
          ],
        },
      });
    }

    if (format === "usage") {
      // /dashboard/billing/usage 格式
      return jsonResponse({
        object: "billing_usage",
        total_usage: 0,
        daily_costs: [],
      });
    }

    return jsonResponse({ balance: balance, currency: "USD" });
  } catch (error) {
    return jsonResponse(
      { error: { message: `Failed to fetch balance: ${error.message}`, type: "upstream_error" } },
      502
    );
  }
}

/**
 * 从 OpenRouter 获取模型列表（合并 frontend API 的图像模型）
 */
async function fetchOpenRouterModels() {
  try {
    // 并行获取两个 API 的数据
    const [modelsResponse, imageModelsResponse] = await Promise.all([
      fetch(OPENROUTER_MODELS_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "fal-openai-proxy/1.12.0",
        },
      }),
      fetch(OPENROUTER_IMAGE_MODELS_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "fal-openai-proxy/1.12.0",
        },
      }),
    ]);

    if (!modelsResponse.ok) {
      return jsonResponse(
        { error: { message: `Failed to fetch models: ${modelsResponse.status}`, type: "upstream_error" } },
        modelsResponse.status
      );
    }

    const modelsData = await modelsResponse.json();
    const existingModels = modelsData.data || [];
    const existingIds = new Set(existingModels.map(m => m.id));

    // 尝试获取图像模型并合并
    if (imageModelsResponse.ok) {
      try {
        const imageData = await imageModelsResponse.json();
        const imageModels = imageData?.data?.models || [];

        // 将缺失的图像模型添加到列表中
        for (const imgModel of imageModels) {
          const modelId = imgModel.slug;
          if (modelId && !existingIds.has(modelId)) {
            // 转换为标准格式
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
              top_provider: {
                context_length: imgModel.context_length || 4096,
                is_moderated: false,
              },
            });
            existingIds.add(modelId);
          } else if (modelId && existingIds.has(modelId)) {
            // 更新已存在模型的 output_modalities
            const existing = existingModels.find(m => m.id === modelId);
            if (existing && existing.architecture) {
              if (!existing.architecture.output_modalities?.includes("image")) {
                existing.architecture.output_modalities = imgModel.output_modalities || ["image"];
              }
            }
          }
        }
      } catch (e) {
        // 忽略图像模型获取失败
      }
    }

    return jsonResponse({ object: "list", data: existingModels });
  } catch (error) {
    return jsonResponse(
      { error: { message: `Failed to fetch models: ${error.message}`, type: "upstream_error" } },
      502
    );
  }
}

/**
 * 从请求中提取 API Key
 * 支持 Authorization: Bearer xxx, Authorization: Key xxx, x-api-key: xxx
 */
function extractApiKey(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  if (authHeader.startsWith("Key ")) return authHeader.slice(4);
  // 支持 Anthropic 风格的 x-api-key
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  return env.FAL_KEY || "";
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
 * 通用 CORS 代理
 * 转发请求到目标 URL 并添加 CORS 头
 */
async function handleProxyRequest(request, url) {
  // 获取目标 URL
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

  // 验证 URL 格式
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

  // 构建请求头（透传原始请求头，但排除一些不应透传的头）
  const headers = new Headers();
  const excludeHeaders = ["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-for", "x-forwarded-proto", "x-real-ip"];

  for (const [key, value] of request.headers.entries()) {
    if (!excludeHeaders.includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // 构建 fetch 选项
  const fetchOptions = {
    method: request.method,
    headers: headers,
  };

  // 对于 POST/PUT 请求，透传请求体
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    fetchOptions.body = request.body;
  }

  try {
    // 发起请求到目标服务器
    const response = await fetch(targetUrl, fetchOptions);

    // 构建响应头（添加 CORS 头）
    const responseHeaders = new Headers(CORS_HEADERS);

    // 透传响应的 Content-Type
    const contentType = response.headers.get("Content-Type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    // 透传一些有用的响应头
    const passHeaders = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-request-id"];
    for (const h of passHeaders) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    // 返回响应
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
 * 处理 Anthropic 格式请求 (/v1/messages)
 * 1. 将 Anthropic 格式转换为 OpenAI 格式
 * 2. 发送到上游 fal-openrouter
 * 3. 将响应从 OpenAI 格式转换回 Anthropic 格式
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

  // 调试：记录原始 Anthropic 请求（检查 cache_control）
  console.log("[Anthropic] Original system:", JSON.stringify(anthropicBody.system)?.slice(0, 500));

  // 检查是否是流式请求
  const isStream = anthropicBody.stream === true;

  // 转换为 OpenAI 格式
  const openaiBody = convertAnthropicToOpenAI(anthropicBody);

  // 构建请求头
  const headers = new Headers();
  headers.set("Authorization", `Key ${falKey}`);
  headers.set("Content-Type", "application/json");
  if (isStream) {
    headers.set("Accept", "text/event-stream");
  }

  const targetUrl = `${FAL_BASE_URL}/chat/completions`;

  // 调试：记录转换后的请求
  console.log("[Anthropic->OpenAI] Request:", JSON.stringify(openaiBody).slice(0, 500));

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

      // 预加载模型定价（用于流式响应中的缓存计算）
      const pricing = await getModelPricing(anthropicBody.model);
      
      // 创建转换流
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
      // 返回 Anthropic 格式的流式错误
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
    
    // 调试：记录上游响应的 usage
    console.log("[Anthropic] Upstream usage:", JSON.stringify(openaiResponse.usage));
    
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
 * 将 Anthropic 请求格式转换为 OpenAI 格式
 * 保留 cache_control 以支持 Prompt Caching
 */
function convertAnthropicToOpenAI(anthropicBody) {
  const openaiBody = {
    model: anthropicBody.model,
    stream: anthropicBody.stream || false,
    messages: [],
  };

  // 转换 max_tokens
  if (anthropicBody.max_tokens) {
    openaiBody.max_tokens = anthropicBody.max_tokens;
  }

  // 转换 temperature
  if (anthropicBody.temperature !== undefined) {
    openaiBody.temperature = anthropicBody.temperature;
  }

  // 转换 top_p
  if (anthropicBody.top_p !== undefined) {
    openaiBody.top_p = anthropicBody.top_p;
  }

  // 转换 stop_sequences -> stop
  if (anthropicBody.stop_sequences) {
    openaiBody.stop = anthropicBody.stop_sequences;
  }

  // 转换 top_k（部分 OpenAI 兼容 API 支持）
  if (anthropicBody.top_k !== undefined) {
    openaiBody.top_k = anthropicBody.top_k;
  }

  // 如果是流式请求，添加 stream_options 以获取 usage
  if (anthropicBody.stream) {
    openaiBody.stream_options = { include_usage: true };
  }

  // 添加 usage.include 以获取详细的 token 统计（包括缓存）
  openaiBody.usage = { include: true };

  // 1. 转换 system prompt（保留 cache_control）
  if (anthropicBody.system) {
    if (typeof anthropicBody.system === "string") {
      // 简单字符串格式
      openaiBody.messages.push({
        role: "system",
        content: anthropicBody.system,
      });
    } else if (Array.isArray(anthropicBody.system)) {
      // 数组格式（带 cache_control）- 直接保留结构
      openaiBody.messages.push({
        role: "system",
        content: anthropicBody.system,
      });
    }
  }

  // 2. 转换 messages（保留 cache_control）
  if (anthropicBody.messages) {
    for (const msg of anthropicBody.messages) {
      const convertedMsg = convertAnthropicMessage(msg);
      // 处理多个 tool_result 拆分的情况
      if (convertedMsg.__isToolResults) {
        openaiBody.messages.push(...convertedMsg.toolResults);
        // 如果有额外的用户消息（混合内容），也要添加
        if (convertedMsg.additionalMessage) {
          openaiBody.messages.push(convertedMsg.additionalMessage);
        }
      } else {
        openaiBody.messages.push(convertedMsg);
      }
    }
  }

  // 3. 转换 tools（input_schema -> parameters，保留 cache_control）
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
      // 保留 cache_control（OpenRouter 支持）
      if (tool.cache_control) {
        converted.cache_control = tool.cache_control;
      }
      return converted;
    });
  }

  // 4. 转换 tool_choice
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

  // 应用思考模型路由
  return applyThinkingModelRouting(openaiBody);
}

/**
 * 转换单条 Anthropic 消息为 OpenAI 格式
 * 注意：多个 tool_result 需要拆分为多条 tool 消息
 */
function convertAnthropicMessage(msg) {
  const converted = { role: msg.role };

  // 处理 content
  if (typeof msg.content === "string") {
    converted.content = msg.content;
  } else if (Array.isArray(msg.content)) {
    // 检查是否需要保持数组格式（有 cache_control 或 image 时需要）
    const hasSpecialBlocks = msg.content.some(b => 
      b.cache_control || b.type === "image" || b.type === "image_url"
    );
    
    // 转换 content 数组
    const convertedContent = msg.content.map(block => {
      if (block.type === "text") {
        const textBlock = { type: "text", text: block.text };
        // 保留 cache_control
        if (block.cache_control) {
          textBlock.cache_control = block.cache_control;
        }
        return textBlock;
      } else if (block.type === "image") {
        // Anthropic image -> OpenAI image_url
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
      } else if (block.type === "tool_use") {
        // tool_use 在 assistant 消息中，保留原样（后面会特殊处理）
        return block;
      } else if (block.type === "tool_result") {
        // tool_result 在 user 消息中，保留原样（后面会特殊处理）
        return block;
      }
      return block;
    });
    
    // 如果只有纯文本且没有特殊块，简化为字符串
    const textOnlyBlocks = convertedContent.filter(b => b.type === "text" && !b.cache_control);
    if (!hasSpecialBlocks && textOnlyBlocks.length === convertedContent.length) {
      converted.content = textOnlyBlocks.map(b => b.text).join("\n");
    } else {
      converted.content = convertedContent;
    }
  }

  // 处理 tool_calls（assistant 消息中的工具调用）
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
      // 提取纯文本内容
      const textBlocks = msg.content.filter(b => b.type === "text");
      if (textBlocks.length > 0) {
        converted.content = textBlocks.map(b => b.text).join("\n");
      } else {
        converted.content = null;
      }
    }
  }

  // 处理 tool_result（user 消息中的工具结果）
  // 注意：这里返回的是单条消息，多个 tool_result 需要在上层处理
  if (msg.role === "user" && Array.isArray(msg.content)) {
    const toolResults = msg.content.filter(b => b.type === "tool_result");
    const otherBlocks = msg.content.filter(b => b.type !== "tool_result");
    
    if (toolResults.length > 0) {
      // 有 tool_result，需要拆分
      const result = {
        __isToolResults: true,
        toolResults: toolResults.map(tr => {
          const toolMsg = {
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: formatToolResultContent(tr.content),
          };
          // 如果是错误结果，在内容前加上错误标记（OpenAI 没有 is_error 字段）
          if (tr.is_error) {
            toolMsg.content = `[ERROR] ${toolMsg.content}`;
          }
          return toolMsg;
        }),
      };
      
      // 如果还有其他内容（如 text），也要保留
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
 * Anthropic 的 content 可以是字符串或 content block 数组
 */
function formatToolResultContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    // 提取文本内容
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

  // 转换文本内容
  if (message.content) {
    content.push({
      type: "text",
      text: message.content,
    });
  }

  // 转换 tool_calls -> tool_use
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

  // 确定 stop_reason
  let stopReason = "end_turn";
  // OpenAI 可能返回 "tool_calls" 或 "function_call"
  if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") {
    stopReason = "tool_use";
  } else if (choice.finish_reason === "length") {
    stopReason = "max_tokens";
  } else if (choice.finish_reason === "stop") {
    stopReason = "end_turn";
  } else if (choice.finish_reason === "content_filter") {
    stopReason = "end_turn"; // Anthropic 没有对应的，用 end_turn
  }

  // 构建 usage
  const totalPromptTokens = openaiResponse.usage?.prompt_tokens || 0;
  const outputTokens = openaiResponse.usage?.completion_tokens || 0;
  
  // 尝试从上游获取缓存信息
  let upstreamCachedTokens = openaiResponse.usage?.prompt_tokens_details?.cached_tokens || 
                              openaiResponse.usage?.cache_read_input_tokens || 0;
  let upstreamCacheCreation = openaiResponse.usage?.cache_creation_input_tokens || 0;
  
  let cacheReadTokens = upstreamCachedTokens;
  let cacheCreationTokens = upstreamCacheCreation;

  // 如果有 cost，用 cost 反推/验证缓存 tokens
  if (openaiResponse.usage?.cost) {
    const estimated = await estimateCacheTokensFromCost(
      totalPromptTokens, 
      outputTokens, 
      openaiResponse.usage.cost, 
      model,
      upstreamCachedTokens  // 传入上游返回的 cached_tokens
    );
    cacheReadTokens = estimated.cacheReadTokens;
    cacheCreationTokens = estimated.cacheCreationTokens;
  }

  // input_tokens = 总 prompt - 缓存读取 - 缓存创建（Anthropic 格式）
  const inputTokens = Math.max(0, totalPromptTokens - cacheReadTokens - cacheCreationTokens);

  // 构建 Anthropic 响应
  const anthropicResponse = {
    id: openaiResponse.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: model || openaiResponse.model,
    content: content.length > 0 ? content : [{ type: "text", text: "" }], // 确保至少有一个 content block
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  };

  return anthropicResponse;
}

/**
 * 创建流式响应转换器
 * 将 OpenAI SSE 格式转换为 Anthropic SSE 格式
 * @param {string} model - 模型名称
 * @param {object} pricing - 预加载的模型定价
 */
function createStreamTransformer(model, pricing) {
  let buffer = "";
  let messageId = `msg_${Date.now()}`;
  let totalPromptTokens = 0;  // OpenRouter 返回的总 prompt tokens
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let totalCost = 0;  // 用于从 cost 反推缓存
  let sentStart = false;
  let textBlockStarted = false;
  let toolCallsStarted = new Map(); // id -> { index, name }
  let toolCallNames = new Map(); // index -> name (用于累积 name)
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
        // 用 cost 反推/验证缓存 tokens（使用预加载的定价）
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
        
        // input_tokens = 总 prompt - 缓存读取 - 缓存创建（Anthropic 格式）
        const inputTokens = Math.max(0, totalPromptTokens - cacheReadTokens - cacheCreationTokens);
        
        console.log("[Stream] DONE - Final usage: input=", inputTokens, "output=", outputTokens, "cacheRead=", cacheReadTokens, "cacheWrite=", cacheCreationTokens);
        // 如果还没发送过 message_start，说明是空响应
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
          // 发送空的 text block
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
        
        // 发送 message_delta（包含最终的 usage）
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
        
        // 发送 message_stop 事件
        controller.enqueue(encodeSSE("message_stop", { type: "message_stop" }));
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        const finishReason = parsed.choices?.[0]?.finish_reason;

        // 更新 usage（OpenAI 流式中 usage 可能在任何 chunk 中，但通常在最后）
        if (parsed.usage) {
          console.log("[Stream] Received usage:", JSON.stringify(parsed.usage));
          totalPromptTokens = parsed.usage.prompt_tokens || totalPromptTokens;
          outputTokens = parsed.usage.completion_tokens || outputTokens;
          
          // 获取 cost 用于反推缓存
          if (parsed.usage.cost) {
            totalCost = parsed.usage.cost;
          }
          
          // OpenRouter 返回 cached_tokens 在 prompt_tokens_details 中
          if (parsed.usage.prompt_tokens_details?.cached_tokens) {
            cacheReadTokens = parsed.usage.prompt_tokens_details.cached_tokens;
          }
          // 如果有 cache_read_input_tokens 直接用
          else if (parsed.usage.cache_read_input_tokens) {
            cacheReadTokens = parsed.usage.cache_read_input_tokens;
          }
          
          // OpenRouter 目前不支持返回 cache_creation_input_tokens
          if (parsed.usage.cache_creation_input_tokens) {
            cacheCreationTokens = parsed.usage.cache_creation_input_tokens;
          }
        }
        
        // 处理 OpenAI 的 usage-only chunk（choices 为空，只有 usage）
        if (!parsed.choices || parsed.choices.length === 0) {
          continue;
        }

        // 发送 message_start（只发一次）
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

        // 处理文本内容
        if (delta?.content) {
          // 发送 content_block_start（第一次有内容时）
          if (!textBlockStarted) {
            textBlockStarted = true;
            controller.enqueue(encodeSSE("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }));
          }
          // 发送 content_block_delta
          controller.enqueue(encodeSSE("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: delta.content },
          }));
        }

        // 处理 tool_calls
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

        // 处理结束（发送 content_block_stop，但不发送 message_delta）
        if (finishReason && !contentBlocksStopped) {
          contentBlocksStopped = true;
          
          // 记录 stop_reason
          if (finishReason === "tool_calls" || finishReason === "function_call") {
            finalStopReason = "tool_use";
          } else if (finishReason === "length") {
            finalStopReason = "max_tokens";
          }
          
          // 如果没有任何 content block，发送一个空的 text block
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
          // 注意：message_delta 延迟到 [DONE] 时发送，以确保 usage 正确
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


/**
 * 从 cost 反推缓存 tokens
 * 
 * 原理：
 * - 已知：prompt_tokens, completion_tokens, cost, cached_tokens（如果上游返回）
 * - 从 OpenRouter API 动态获取缓存定价
 * 
 * 公式推导：
 * cost = normal_input × price + cache_read × cache_read_price + cache_write × cache_write_price + output × output_price
 * 其中 normal_input = prompt_tokens - cache_read - cache_write
 */

// 静态定价表（$/M tokens）- 作为 fallback
const MODEL_PRICING_FALLBACK = {
  // Claude 4.x 系列
  "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "anthropic/claude-opus-4.5": { input: 5, output: 25 },
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-opus-4": { input: 15, output: 75 },
  "anthropic/claude-opus-4.1": { input: 15, output: 75 },
  // Claude 3.x 系列
  "anthropic/claude-3.7-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3.5-sonnet-20240620": { input: 3, output: 15 },
  "anthropic/claude-3-opus": { input: 15, output: 75 },
  "anthropic/claude-3-sonnet": { input: 3, output: 15 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
  "anthropic/claude-3.5-haiku": { input: 0.8, output: 4 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
};

// 动态定价缓存
let modelPricingCache = null;
let pricingCacheTime = 0;
const PRICING_CACHE_TTL = 7 * 24 * 3600 * 1000; // 1 周缓存

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
      console.log(`[Pricing] Failed to fetch: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const pricing = {};
    
    for (const model of (data.data || [])) {
      if (model.pricing) {
        // OpenRouter 返回的是每 token 价格，转换为 $/M tokens
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
    console.log(`[Pricing] Cached ${Object.keys(pricing).length} models`);
    return pricing;
  } catch (e) {
    console.log(`[Pricing] Error: ${e.message}`);
    return null;
  }
}

/**
 * 获取模型定价（优先动态，fallback 静态）
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
 * @param {number} promptTokens - 总输入 tokens
 * @param {number} completionTokens - 输出 tokens
 * @param {number} totalCost - 实际费用
 * @param {string} model - 模型名称
 * @param {number} cachedTokens - 上游返回的缓存读取 tokens（如果有）
 */
async function estimateCacheTokensFromCost(promptTokens, completionTokens, totalCost, model, cachedTokens = 0) {
  if (promptTokens <= 0 || totalCost <= 0) {
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }
  
  const pricing = await getModelPricing(model);
  if (!pricing) {
    console.log(`[CacheEstimate] Unknown model pricing: ${model}, skipping`);
    return { cacheReadTokens: cachedTokens, cacheCreationTokens: 0 };
  }
  
  const inputPrice = pricing.input / 1_000_000;
  const outputPrice = pricing.output / 1_000_000;
  const cacheReadPrice = pricing.cacheRead / 1_000_000;
  const cacheWritePrice = pricing.cacheWrite / 1_000_000;
  
  // 计算缓存折扣/加价比例
  const cacheReadDiscount = inputPrice > 0 ? 1 - (cacheReadPrice / inputPrice) : 0.9;
  const cacheWriteExtra = inputPrice > 0 ? (cacheWritePrice / inputPrice) - 1 : 0.25;
  
  const normalCost = promptTokens * inputPrice + completionTokens * outputPrice;
  
  // 如果上游已返回 cached_tokens，用它来计算 cache_write
  if (cachedTokens > 0) {
    const cacheSavings = cachedTokens * inputPrice * cacheReadDiscount;
    const expectedCost = normalCost - cacheSavings;
    const extraCost = totalCost - expectedCost;
    
    let cacheWrite = 0;
    if (extraCost > inputPrice * 0.1 && cacheWriteExtra > 0) {
      cacheWrite = Math.round(extraCost / (inputPrice * cacheWriteExtra));
      cacheWrite = Math.max(0, Math.min(cacheWrite, promptTokens - cachedTokens));
    }
    
    console.log(`[CacheEstimate] With upstream cached_tokens=${cachedTokens}, cache_write=${cacheWrite}`);
    return { cacheReadTokens: cachedTokens, cacheCreationTokens: cacheWrite };
  }
  
  // 上游没有返回 cached_tokens，纯靠 cost 反推
  const costDiff = totalCost - normalCost;
  
  console.log(`[CacheEstimate] model=${model}, prompt=${promptTokens}, completion=${completionTokens}`);
  console.log(`[CacheEstimate] actualCost=${totalCost.toFixed(6)}, normalCost=${normalCost.toFixed(6)}, diff=${costDiff.toFixed(6)}`);
  
  const tolerance = inputPrice * 10;
  
  if (Math.abs(costDiff) < tolerance) {
    console.log(`[CacheEstimate] No cache detected (diff within tolerance)`);
    return { cacheReadTokens: 0, cacheCreationTokens: 0 };
  }
  
  if (costDiff > 0 && cacheWriteExtra > 0) {
    const cacheWrite = Math.round(costDiff / (inputPrice * cacheWriteExtra));
    if (cacheWrite > 0 && cacheWrite <= promptTokens) {
      console.log(`[CacheEstimate] Detected cache WRITE: ${cacheWrite} tokens`);
      return { cacheReadTokens: 0, cacheCreationTokens: cacheWrite };
    }
  } else if (costDiff < 0 && cacheReadDiscount > 0) {
    const savedCost = -costDiff;
    const cacheRead = Math.round(savedCost / (inputPrice * cacheReadDiscount));
    if (cacheRead > 0 && cacheRead <= promptTokens) {
      console.log(`[CacheEstimate] Detected cache READ: ${cacheRead} tokens`);
      return { cacheReadTokens: cacheRead, cacheCreationTokens: 0 };
    }
  }
  
  console.log(`[CacheEstimate] Invalid calculation, returning 0`);
  return { cacheReadTokens: 0, cacheCreationTokens: 0 };
}

/**
 * 同步版本的缓存计算（用于流式处理，使用预加载的定价）
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

