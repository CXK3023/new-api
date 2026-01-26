# fal.ai OpenRouter Worker 测试脚本 (PowerShell)
# 使用方法: .\test-fal-openrouter.ps1 -WorkerUrl "https://your-worker.workers.dev" -FalKey "your-fal-api-key"

param(
    [string]$WorkerUrl = "http://localhost:8787",
    [string]$FalKey = "your-fal-api-key"
)

# 颜色函数
function Write-Success { param($Message) Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "✗ $Message" -ForegroundColor Red }
function Write-Info { param($Message) Write-Host "ℹ $Message" -ForegroundColor Cyan }
function Write-Header { param($Message) Write-Host "`n========== $Message ==========" -ForegroundColor Yellow }

Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  fal.ai OpenRouter Worker 测试脚本" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""
Write-Host "Worker URL: $WorkerUrl" -ForegroundColor Yellow
Write-Host "FAL Key: $($FalKey.Substring(0, [Math]::Min(10, $FalKey.Length)))..." -ForegroundColor Yellow
Write-Host ""

$passed = 0
$failed = 0

# ========================================
# 测试 1: 根路径
# ========================================
Write-Header "测试 1: 根路径 (/)"
try {
    $response = Invoke-RestMethod -Uri "$WorkerUrl/" -Method Get
    Write-Success "根路径返回 API 信息"
    Write-Host "  名称: $($response.name)"
    Write-Host "  版本: $($response.version)"
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 2: 健康检查
# ========================================
Write-Header "测试 2: 健康检查 (/health)"
try {
    $response = Invoke-RestMethod -Uri "$WorkerUrl/health" -Method Get
    Write-Success "健康检查通过"
    Write-Host "  状态: $($response.status)"
    Write-Host "  时间: $($response.timestamp)"
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 3: 模型列表
# ========================================
Write-Header "测试 3: 模型列表 (/v1/models)"
try {
    $headers = @{
        "Authorization" = "Bearer $FalKey"
    }
    $response = Invoke-RestMethod -Uri "$WorkerUrl/v1/models" -Method Get -Headers $headers
    $modelCount = $response.data.Count
    Write-Success "获取到 $modelCount 个模型"
    $response.data | Select-Object -First 5 | ForEach-Object {
        Write-Host "  - $($_.id)"
    }
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 4: 非流式 Chat Completions
# ========================================
Write-Header "测试 4: 非流式 Chat Completions"
try {
    $headers = @{
        "Authorization" = "Bearer $FalKey"
        "Content-Type" = "application/json"
    }
    $body = @{
        model = "google/gemini-2.5-flash"
        messages = @(
            @{
                role = "user"
                content = "Say 'Hello World' and nothing else."
            }
        )
        max_tokens = 20
    } | ConvertTo-Json -Depth 10
    
    $startTime = Get-Date
    $response = Invoke-RestMethod -Uri "$WorkerUrl/v1/chat/completions" -Method Post -Headers $headers -Body $body
    $elapsed = ((Get-Date) - $startTime).TotalSeconds
    
    Write-Success "非流式请求成功 ($([math]::Round($elapsed, 2))s)"
    Write-Host "  模型: $($response.model)"
    Write-Host "  响应: $($response.choices[0].message.content)"
    if ($response.usage) {
        Write-Host "  用量: $($response.usage.prompt_tokens)+$($response.usage.completion_tokens)=$($response.usage.total_tokens) tokens"
    }
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 5: 流式 Chat Completions (基本测试)
# ========================================
Write-Header "测试 5: 流式 Chat Completions"
try {
    $headers = @{
        "Authorization" = "Bearer $FalKey"
        "Content-Type" = "application/json"
    }
    $body = @{
        model = "google/gemini-2.5-flash"
        messages = @(
            @{
                role = "user"
                content = "Count from 1 to 3."
            }
        )
        stream = $true
        max_tokens = 30
    } | ConvertTo-Json -Depth 10
    
    # PowerShell 原生不太支持 SSE，使用简化测试
    $webRequest = [System.Net.WebRequest]::Create("$WorkerUrl/v1/chat/completions")
    $webRequest.Method = "POST"
    $webRequest.ContentType = "application/json"
    $webRequest.Headers.Add("Authorization", "Bearer $FalKey")
    
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $webRequest.ContentLength = $bodyBytes.Length
    $requestStream = $webRequest.GetRequestStream()
    $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
    $requestStream.Close()
    
    $response = $webRequest.GetResponse()
    $responseStream = $response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($responseStream)
    
    Write-Host "  响应: " -NoNewline
    $chunkCount = 0
    while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ($line -match "^data: (.+)$") {
            $chunkCount++
            $data = $matches[1]
            if ($data -ne "[DONE]") {
                try {
                    $json = $data | ConvertFrom-Json
                    if ($json.choices[0].delta.content) {
                        Write-Host $json.choices[0].delta.content -NoNewline
                    }
                } catch {
                    # 忽略解析错误
                }
            }
        }
    }
    Write-Host ""
    $reader.Close()
    $response.Close()
    
    Write-Success "流式请求成功 ($chunkCount chunks)"
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 6: 带系统消息的对话
# ========================================
Write-Header "测试 6: 带系统消息的对话"
try {
    $headers = @{
        "Authorization" = "Bearer $FalKey"
        "Content-Type" = "application/json"
    }
    $body = @{
        model = "google/gemini-2.5-flash"
        messages = @(
            @{
                role = "system"
                content = "You are a pirate. Respond in pirate speak."
            },
            @{
                role = "user"
                content = "Hello!"
            }
        )
        max_tokens = 100
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri "$WorkerUrl/v1/chat/completions" -Method Post -Headers $headers -Body $body
    Write-Success "系统消息测试成功"
    Write-Host "  响应: $($response.choices[0].message.content.Substring(0, [Math]::Min(150, $response.choices[0].message.content.Length)))..."
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试 7: 错误处理 - 缺少认证
# ========================================
Write-Header "测试 7: 错误处理 - 缺少认证"
try {
    $headers = @{
        "Content-Type" = "application/json"
    }
    $body = @{
        model = "google/gemini-2.5-flash"
        messages = @(@{ role = "user"; content = "Hello" })
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-WebRequest -Uri "$WorkerUrl/v1/chat/completions" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Error "预期返回 401，但请求成功了"
    $failed++
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Success "正确返回 401 错误"
        $passed++
    } else {
        Write-Error "预期 401，实际 $statusCode"
        $failed++
    }
}

# ========================================
# 测试 8: 多轮对话
# ========================================
Write-Header "测试 8: 多轮对话"
try {
    $headers = @{
        "Authorization" = "Bearer $FalKey"
        "Content-Type" = "application/json"
    }
    $body = @{
        model = "google/gemini-2.5-flash"
        messages = @(
            @{ role = "user"; content = "My name is Alice." },
            @{ role = "assistant"; content = "Nice to meet you, Alice!" },
            @{ role = "user"; content = "What is my name?" }
        )
        max_tokens = 50
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri "$WorkerUrl/v1/chat/completions" -Method Post -Headers $headers -Body $body
    $content = $response.choices[0].message.content.ToLower()
    if ($content -match "alice") {
        Write-Success "多轮对话测试成功 - 模型记住了名字"
    } else {
        Write-Success "多轮对话测试完成"
    }
    Write-Host "  响应: $($response.choices[0].message.content)"
    $passed++
} catch {
    Write-Error "请求失败: $_"
    $failed++
}

# ========================================
# 测试完成
# ========================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  测试完成" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""
Write-Host "  通过: $passed" -ForegroundColor Green
Write-Host "  失败: $failed" -ForegroundColor Red
Write-Host "  总计: $($passed + $failed)"
Write-Host ""

if ($failed -eq 0) {
    Write-Host "🎉 所有测试通过！您的 Worker 已准备就绪。" -ForegroundColor Green
    Write-Host ""
    Write-Host "在 NewAPI 中配置渠道:" -ForegroundColor Cyan
    Write-Host "  - 渠道类型: OpenAI"
    Write-Host "  - 渠道地址: $WorkerUrl" -ForegroundColor Yellow
    Write-Host "  - 密钥: 您的 fal.ai API 密钥" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  部分测试失败，请检查配置。" -ForegroundColor Yellow
}

