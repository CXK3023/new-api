# Cloudflare Worker - fal.ai OpenRouter 代理

此 Cloudflare Worker 脚本用于将 OpenAI/Anthropic 兼容的 API 请求转发到 fal.ai 的 OpenRouter 端点，可与 NewAPI 无缝集成。

## 功能特性

### 核心功能
- ✅ OpenAI Chat Completions API 完整兼容
- ✅ Anthropic Messages API 自动转换 (`/v1/messages`)
- ✅ 支持流式 (SSE) 和非流式响应
- ✅ 自动认证头转换 (`Bearer` → `Key`)
- ✅ 完整的错误处理

### 智能特性
- ✅ **思考模型自动路由**：`xxx-thinking` → `xxx` + `reasoning.enabled`
- ✅ **图像模型智能处理**：自动添加 `modalities` 参数
- ✅ **智能 image_config**：从提示词解析分辨率和宽高比
- ✅ **图像响应转换**：自动转换为 Markdown 图片格式

### 附加功能
- ✅ 动态模型列表（从 OpenRouter 获取，含图像模型）
- ✅ 余额查询（OpenAI 兼容格式）
- ✅ 通用 CORS 代理 (`/proxy?url=xxx`)
- ✅ 缓存 tokens 估算（从 cost 反推）

## 快速开始

### 1. 部署到 Cloudflare Workers

#### 方法 A: 通过 Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create Application** → **Create Worker**
3. 给 Worker 命名 (例如: `fal-openrouter-proxy`)
4. 点击 **Deploy**
5. 进入 Worker 编辑页面，粘贴 `cloudflare-worker-fal-openrouter.js` 内容
6. 点击 **Save and Deploy**

#### 方法 B: 使用 Wrangler CLI

```bash
npm install -g wrangler
wrangler login
wrangler deploy cloudflare-worker-fal-openrouter.js --name fal-openrouter-proxy
```

### 2. 获取 fal.ai API 密钥

1. 访问 [fal.ai](https://fal.ai/)
2. 进入 [API Keys 页面](https://fal.ai/dashboard/keys)
3. 创建新的 API Key

### 3. 在 NewAPI 中配置渠道

| 字段 | 值 |
|------|-----|
| 渠道名称 | fal.ai OpenRouter |
| 渠道类型 | OpenAI |
| 渠道地址 | `https://your-worker.workers.dev` |
| 密钥 | 您的 fal.ai API 密钥 |

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | API 信息和文档 |
| `/health` | GET | 健康检查 |
| `/v1/models` | GET | 模型列表（动态获取） |
| `/v1/chat/completions` | POST | OpenAI Chat Completions |
| `/v1/messages` | POST | Anthropic Messages（自动转换） |
| `/v1/messages/debug` | POST | 调试：查看转换结果 |
| `/v1/embeddings` | POST | 嵌入向量（透传） |
| `/v1/dashboard/billing/subscription` | GET | 余额查询 |
| `/v1/dashboard/billing/credit_grants` | GET | 额度查询 |
| `/proxy?url=xxx` | ALL | 通用 CORS 代理 |

## 智能特性详解

### 思考模型自动路由

请求带 `-thinking` 后缀的模型会自动处理：

```json
// 请求
{ "model": "deepseek/deepseek-v3.2-thinking", ... }

// 自动转换为
{ "model": "deepseek/deepseek-v3.2", "reasoning": { "enabled": true }, ... }
```

**预定义映射：**
| 虚拟模型 | 实际模型 |
|---------|---------|
| `deepseek/deepseek-v3.2-thinking` | `deepseek/deepseek-v3.2` |
| `deepseek/deepseek-chat-v3.1-thinking` | `deepseek/deepseek-chat-v3.1:free` |
| `deepseek/deepseek-r1-thinking` | `deepseek/deepseek-r1` |

### 图像模型智能处理

对于图像生成模型，自动添加 `modalities` 参数：

```json
{ "model": "google/gemini-2.5-flash-image-preview", ... }
// 自动添加
{ "modalities": ["image", "text"], ... }
```

**智能 image_config**（仅对 Gemini/Seedream 生效）：

| 优先级 | 来源 |
|--------|------|
| 1 | 提示词关键词 |
| 2 | 请求参数 |
| 3 | 默认值 (4K, 1:1) |

**支持的提示词关键词：**
| 类型 | 关键词 |
|------|--------|
| 分辨率 | `1K`, `2K`, `4K` |
| 宽高比 | `16:9`, `9:16`, `1:1`, `4:3`, `3:4` |
| 语义 | `横屏`, `竖屏`, `方形`, `landscape`, `portrait`, `square` |

### Anthropic 格式兼容

`/v1/messages` 端点支持 Anthropic 格式，自动双向转换：

**请求转换：**
- `max_tokens` → `max_tokens`
- `stop_sequences` → `stop`
- `tools` (input_schema) → `tools` (parameters)
- 保留 `cache_control` 支持 Prompt Caching

**响应转换：**
- `finish_reason="stop"` → `stop_reason="end_turn"`
- `finish_reason="tool_calls"` → `stop_reason="tool_use"`
- 包含缓存信息 (`cache_read_input_tokens`, `cache_creation_input_tokens`)

## 使用示例

### OpenAI 格式 (非流式)

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 1000
  }'
```

### OpenAI 格式 (流式)

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Anthropic 格式

```bash
curl -X POST https://your-worker.workers.dev/v1/messages \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 思考模型

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-v3.2-thinking",
    "messages": [{"role": "user", "content": "Solve this math problem..."}]
  }'
```

### 图像生成

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-flash-image-preview",
    "messages": [{"role": "user", "content": "画一只可爱的猫咪，4K 横屏"}]
  }'
```

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-worker.workers.dev/v1",
    api_key="your-fal-api-key"
)

# 普通对话
response = client.chat.completions.create(
    model="google/gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# 流式对话
stream = client.chat.completions.create(
    model="google/gemini-2.5-flash",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")

# 思考模型
response = client.chat.completions.create(
    model="deepseek/deepseek-v3.2-thinking",
    messages=[{"role": "user", "content": "Analyze this problem..."}]
)
```

### Anthropic SDK 示例

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://your-worker.workers.dev",
    api_key="your-fal-api-key"
)

message = client.messages.create(
    model="anthropic/claude-3.5-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(message.content[0].text)
```

## 支持的模型

### 文本模型（部分）
- `google/gemini-2.5-flash`, `google/gemini-2.5-pro`
- `anthropic/claude-3.5-sonnet`, `anthropic/claude-3-opus`
- `openai/gpt-4o`, `openai/gpt-4-turbo`
- `deepseek/deepseek-v3.2`, `deepseek/deepseek-r1`
- `meta-llama/llama-3.1-405b-instruct`

### 图像模型
- `google/gemini-3-pro-image-preview`
- `google/gemini-2.5-flash-image-preview`
- `bytedance-seed/seedream-4.5`
- `openai/gpt-5-image`, `openai/gpt-image-1`
- `black-forest-labs/flux.2-*`

> 完整列表请访问 [OpenRouter Models](https://openrouter.ai/models)

## 认证格式

Worker 支持以下认证格式（自动转换）：

| 输入格式 | 转换为 |
|----------|--------|
| `Authorization: Bearer xxx` | `Key xxx` |
| `Authorization: Key xxx` | `Key xxx` |
| `x-api-key: xxx` | `Key xxx` |

## 错误处理

返回标准 OpenAI 错误格式：

```json
{
  "error": {
    "message": "错误描述",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

## 故障排查

### 认证失败 (401)
- 检查 fal.ai API 密钥是否正确
- 确保密钥未过期

### 模型不存在 (404)
- 确认模型名称拼写正确
- 检查模型是否在 [OpenRouter](https://openrouter.ai/models) 上可用

### 图像生成超时
- Gemini 4K 可能因 CF Worker 超时（100s）失败
- seedream-4.5 4K 正常工作（约 15s）
- 建议使用 2K 分辨率

### 流式响应中断
- 检查网络连接稳定性
- 尝试减少 `max_tokens`

## 更新日志

### v2.0.0
- 整合思考模型自动路由
- 添加 Anthropic 格式完整支持
- 添加图像模型智能处理
- 添加余额查询端点
- 添加通用 CORS 代理
- 添加缓存 tokens 估算
- 动态获取模型列表

### v1.0.0
- 初始版本
- 基础 Chat Completions 支持

## 相关链接

- [fal.ai 文档](https://docs.fal.ai)
- [OpenRouter 文档](https://openrouter.ai/docs)
- [NewAPI 项目](https://github.com/QuantumNous/new-api)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)

## 许可证

MIT License
