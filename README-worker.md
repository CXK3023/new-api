# Cloudflare Worker - fal.ai OpenRouter 代理

此 Cloudflare Worker 脚本用于将 OpenAI 兼容的 API 请求转发到 fal.ai 的 OpenRouter 端点，可与 NewAPI 无缝集成。

## 功能特性

- ✅ 完整的 OpenAI Chat Completions API 兼容
- ✅ 支持流式 (SSE) 和非流式响应
- ✅ 自动认证头转换 (Bearer → Key)
- ✅ 完整的错误处理和 OpenAI 格式错误响应
- ✅ CORS 支持，可在浏览器中直接调用
- ✅ 健康检查端点

## 快速开始

### 1. 部署到 Cloudflare Workers

#### 方法 A: 通过 Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**
4. 给 Worker 命名 (例如: `fal-openrouter-proxy`)
5. 点击 **Deploy**
6. 进入 Worker 编辑页面，将 `cloudflare-worker-fal-openrouter.js` 的内容粘贴进去
7. 点击 **Save and Deploy**

#### 方法 B: 使用 Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 发布 Worker
wrangler deploy cloudflare-worker-fal-openrouter.js --name fal-openrouter-proxy
```

### 2. 获取 fal.ai API 密钥

1. 访问 [fal.ai](https://fal.ai/) 并注册/登录
2. 进入 [API Keys 页面](https://fal.ai/dashboard/keys)
3. 创建新的 API Key
4. 复制密钥 (格式类似: `fal-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### 3. 在 NewAPI 中配置渠道

1. 登录 NewAPI 管理后台
2. 进入 **渠道管理** → **新建渠道**
3. 填写以下信息:

| 字段 | 值 |
|------|-----|
| 渠道名称 | fal.ai OpenRouter (或自定义名称) |
| 渠道类型 | OpenAI |
| 渠道地址 | `https://your-worker.workers.dev` (替换为你的 Worker 地址) |
| 密钥 | 您的 fal.ai API 密钥 |
| 模型 | 添加需要的模型 (见下方模型列表) |

4. 点击 **提交** 保存渠道

### 4. 添加模型

在渠道配置中添加以下模型 (根据需要选择):

```
google/gemini-2.5-flash
google/gemini-2.5-pro
anthropic/claude-sonnet-4
anthropic/claude-3.5-sonnet
anthropic/claude-3-opus
openai/gpt-4.1
openai/gpt-4o
openai/gpt-4-turbo
meta-llama/llama-4-maverick
meta-llama/llama-3.1-405b-instruct
mistralai/mistral-large
deepseek/deepseek-chat
deepseek/deepseek-reasoner
```

> 完整模型列表请参考 [OpenRouter 模型页面](https://openrouter.ai/models)

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | API 信息和文档 |
| `/health` | GET | 健康检查 |
| `/v1/models` | GET | 列出可用模型 |
| `/v1/chat/completions` | POST | Chat Completions (核心功能) |

## 使用示例

### 非流式请求

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }'
```

### 流式请求

```bash
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-fal-api-key" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Write a short poem about coding."}
    ],
    "stream": true
  }'
```

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-worker.workers.dev/v1",
    api_key="your-fal-api-key"
)

# 非流式
response = client.chat.completions.create(
    model="google/gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)

# 流式
stream = client.chat.completions.create(
    model="google/gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Tell me a story."}
    ],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### JavaScript/Node.js 示例

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-worker.workers.dev/v1',
  apiKey: 'your-fal-api-key',
});

// 非流式
const response = await client.chat.completions.create({
  model: 'google/gemini-2.5-flash',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);

// 流式
const stream = await client.chat.completions.create({
  model: 'google/gemini-2.5-flash',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## 认证说明

Worker 支持以下认证格式 (自动转换):

| 输入格式 | 转换为 |
|----------|--------|
| `Bearer fal-key-xxx` | `Key fal-key-xxx` |
| `Key fal-key-xxx` | `Key fal-key-xxx` (保持不变) |
| `fal-key-xxx` | `Key fal-key-xxx` |

## 错误处理

Worker 返回标准的 OpenAI 错误格式:

```json
{
  "error": {
    "message": "错误描述信息",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

### 常见错误

| 状态码 | 错误类型 | 说明 |
|--------|----------|------|
| 400 | invalid_request_error | 请求格式错误 |
| 401 | authentication_error | API 密钥无效或缺失 |
| 403 | permission_error | 无权访问该资源 |
| 404 | not_found_error | 端点或模型不存在 |
| 429 | rate_limit_error | 请求频率过高 |
| 500 | server_error | 服务器内部错误 |

## 故障排查

### 1. 认证失败 (401)

- 检查 fal.ai API 密钥是否正确
- 确保在 NewAPI 中正确配置了密钥
- 检查密钥是否已过期或被禁用

### 2. 模型不存在 (404)

- 确认模型名称拼写正确
- 检查模型是否在 OpenRouter 上可用
- 参考 [OpenRouter 模型列表](https://openrouter.ai/models)

### 3. 流式响应中断

- 检查网络连接稳定性
- 确认 Cloudflare Worker 没有达到 CPU 时间限制
- 考虑将长对话分成多个请求

### 4. 请求超时

- fal.ai 某些模型响应可能较慢
- 尝试减少 `max_tokens` 参数
- 使用流式模式获得更快的首字节响应

## 安全注意事项

1. **API 密钥保护**: Worker 不存储 API 密钥，仅在请求时传递
2. **HTTPS**: 所有通信均通过 HTTPS 加密
3. **CORS**: 默认允许所有来源，生产环境建议限制
4. **速率限制**: 遵循 fal.ai 的速率限制策略

## 更新日志

### v1.0.0

- 初始版本
- 支持 Chat Completions API
- 支持流式和非流式响应
- 完整的错误处理
- CORS 支持

## 相关链接

- [fal.ai 文档](https://docs.fal.ai)
- [OpenRouter 文档](https://openrouter.ai/docs)
- [NewAPI 项目](https://github.com/QuantumNous/new-api)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)

## 许可证

MIT License

