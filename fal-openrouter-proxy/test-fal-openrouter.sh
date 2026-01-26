#!/bin/bash

# fal.ai OpenRouter Worker 测试脚本
# 使用方法: ./test-fal-openrouter.sh <worker-url> <fal-api-key>

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 参数检查
WORKER_URL="${1:-http://localhost:8787}"
FAL_KEY="${2:-your-fal-api-key}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  fal.ai OpenRouter Worker 测试脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Worker URL: ${YELLOW}${WORKER_URL}${NC}"
echo -e "FAL Key: ${YELLOW}${FAL_KEY:0:10}...${NC}"
echo ""

# 函数: 检测响应状态
check_response() {
    local status=$1
    local test_name=$2
    if [ "$status" -eq 200 ]; then
        echo -e "${GREEN}✓ ${test_name} - 成功${NC}"
        return 0
    else
        echo -e "${RED}✗ ${test_name} - 失败 (状态码: ${status})${NC}"
        return 1
    fi
}

# ========================================
# 测试 1: 根路径
# ========================================
echo -e "${YELLOW}测试 1: 根路径 (/)${NC}"
response=$(curl -s -w "\n%{http_code}" "${WORKER_URL}/")
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "根路径"
echo "$body" | head -5
echo ""

# ========================================
# 测试 2: 健康检查
# ========================================
echo -e "${YELLOW}测试 2: 健康检查 (/health)${NC}"
response=$(curl -s -w "\n%{http_code}" "${WORKER_URL}/health")
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "健康检查"
echo "$body"
echo ""

# ========================================
# 测试 3: 模型列表
# ========================================
echo -e "${YELLOW}测试 3: 模型列表 (/v1/models)${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    "${WORKER_URL}/v1/models")
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "模型列表"
echo "$body" | head -10
echo ""

# ========================================
# 测试 4: 非流式 Chat Completions
# ========================================
echo -e "${YELLOW}测试 4: 非流式 Chat Completions${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "user", "content": "Say hello in exactly 5 words."}
        ],
        "max_tokens": 50
    }')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "非流式请求"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo ""

# ========================================
# 测试 5: 流式 Chat Completions
# ========================================
echo -e "${YELLOW}测试 5: 流式 Chat Completions${NC}"
echo "响应内容:"
curl -s -N \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "user", "content": "Count from 1 to 5, one number per line."}
        ],
        "stream": true,
        "max_tokens": 50
    }' | head -20
echo ""
echo -e "${GREEN}✓ 流式请求 - 完成${NC}"
echo ""

# ========================================
# 测试 6: 错误处理 - 缺少认证
# ========================================
echo -e "${YELLOW}测试 6: 错误处理 - 缺少认证${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [{"role": "user", "content": "Hello"}]
    }')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
if [ "$status" -eq 401 ]; then
    echo -e "${GREEN}✓ 错误处理 - 正确返回 401${NC}"
else
    echo -e "${RED}✗ 错误处理 - 预期 401，实际 ${status}${NC}"
fi
echo "$body"
echo ""

# ========================================
# 测试 7: 错误处理 - 无效 JSON
# ========================================
echo -e "${YELLOW}测试 7: 错误处理 - 无效 JSON${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d 'invalid json')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
if [ "$status" -eq 400 ]; then
    echo -e "${GREEN}✓ 错误处理 - 正确返回 400${NC}"
else
    echo -e "${RED}✗ 错误处理 - 预期 400，实际 ${status}${NC}"
fi
echo "$body"
echo ""

# ========================================
# 测试 8: 带系统消息的对话
# ========================================
echo -e "${YELLOW}测试 8: 带系统消息的对话${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "system", "content": "You are a pirate. Respond in pirate speak."},
            {"role": "user", "content": "Hello!"}
        ],
        "max_tokens": 100
    }')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "带系统消息"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo ""

# ========================================
# 测试 9: 多轮对话
# ========================================
echo -e "${YELLOW}测试 9: 多轮对话${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "user", "content": "My name is Alice."},
            {"role": "assistant", "content": "Nice to meet you, Alice!"},
            {"role": "user", "content": "What is my name?"}
        ],
        "max_tokens": 50
    }')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "多轮对话"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo ""

# ========================================
# 测试 10: 温度参数
# ========================================
echo -e "${YELLOW}测试 10: 温度参数测试${NC}"
response=$(curl -s -w "\n%{http_code}" \
    -X POST "${WORKER_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${FAL_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "google/gemini-2.5-flash",
        "messages": [
            {"role": "user", "content": "Give me a random word."}
        ],
        "temperature": 1.5,
        "max_tokens": 20
    }')
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')
check_response "$status" "温度参数"
echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
echo ""

# ========================================
# 测试完成
# ========================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  测试完成${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "如果所有测试通过，您的 Worker 已准备就绪！"
echo -e "在 NewAPI 中配置渠道:"
echo -e "  - 渠道类型: OpenAI"
echo -e "  - 渠道地址: ${YELLOW}${WORKER_URL}${NC}"
echo -e "  - 密钥: ${YELLOW}您的 fal.ai API 密钥${NC}"

