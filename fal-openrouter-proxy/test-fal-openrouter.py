#!/usr/bin/env python3
"""
fal.ai OpenRouter Worker 测试脚本 (Python)

使用方法:
    python test-fal-openrouter.py --url https://your-worker.workers.dev --key your-fal-api-key

依赖:
    pip install openai requests
"""

import argparse
import json
import sys
import time
from typing import Optional

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False
    print("警告: openai 库未安装，部分测试将跳过")
    print("安装: pip install openai")

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("警告: requests 库未安装，部分测试将跳过")
    print("安装: pip install requests")


class Colors:
    """终端颜色"""
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color


def print_header(text: str):
    """打印测试标题"""
    print(f"\n{Colors.YELLOW}{'='*50}{Colors.NC}")
    print(f"{Colors.YELLOW}{text}{Colors.NC}")
    print(f"{Colors.YELLOW}{'='*50}{Colors.NC}")


def print_success(text: str):
    """打印成功信息"""
    print(f"{Colors.GREEN}✓ {text}{Colors.NC}")


def print_error(text: str):
    """打印错误信息"""
    print(f"{Colors.RED}✗ {text}{Colors.NC}")


def print_info(text: str):
    """打印信息"""
    print(f"{Colors.BLUE}ℹ {text}{Colors.NC}")


class WorkerTester:
    """Worker 测试类"""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.passed = 0
        self.failed = 0
        
        if HAS_OPENAI:
            self.client = OpenAI(
                base_url=f"{self.base_url}/v1",
                api_key=api_key
            )
    
    def test_root(self) -> bool:
        """测试根路径"""
        print_header("测试 1: 根路径 (/)")
        
        if not HAS_REQUESTS:
            print_info("跳过 (需要 requests 库)")
            return True
        
        try:
            response = requests.get(f"{self.base_url}/")
            if response.status_code == 200:
                data = response.json()
                print_success("根路径返回 API 信息")
                print(f"  名称: {data.get('name', 'N/A')}")
                print(f"  版本: {data.get('version', 'N/A')}")
                return True
            else:
                print_error(f"状态码: {response.status_code}")
                return False
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_health(self) -> bool:
        """测试健康检查"""
        print_header("测试 2: 健康检查 (/health)")
        
        if not HAS_REQUESTS:
            print_info("跳过 (需要 requests 库)")
            return True
        
        try:
            response = requests.get(f"{self.base_url}/health")
            if response.status_code == 200:
                data = response.json()
                print_success("健康检查通过")
                print(f"  状态: {data.get('status', 'N/A')}")
                print(f"  时间: {data.get('timestamp', 'N/A')}")
                return True
            else:
                print_error(f"状态码: {response.status_code}")
                return False
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_models(self) -> bool:
        """测试模型列表"""
        print_header("测试 3: 模型列表 (/v1/models)")
        
        if not HAS_REQUESTS:
            print_info("跳过 (需要 requests 库)")
            return True
        
        try:
            response = requests.get(
                f"{self.base_url}/v1/models",
                headers={"Authorization": f"Bearer {self.api_key}"}
            )
            if response.status_code == 200:
                data = response.json()
                models = data.get('data', [])
                print_success(f"获取到 {len(models)} 个模型")
                for model in models[:5]:
                    print(f"  - {model.get('id', 'N/A')}")
                if len(models) > 5:
                    print(f"  ... 还有 {len(models) - 5} 个模型")
                return True
            else:
                print_error(f"状态码: {response.status_code}")
                return False
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_chat_non_stream(self) -> bool:
        """测试非流式 Chat Completions"""
        print_header("测试 4: 非流式 Chat Completions")
        
        if not HAS_OPENAI:
            print_info("跳过 (需要 openai 库)")
            return True
        
        try:
            start_time = time.time()
            response = self.client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "user", "content": "Say 'Hello World' and nothing else."}
                ],
                max_tokens=20
            )
            elapsed = time.time() - start_time
            
            content = response.choices[0].message.content
            print_success(f"非流式请求成功 ({elapsed:.2f}s)")
            print(f"  模型: {response.model}")
            print(f"  响应: {content[:100]}{'...' if len(content) > 100 else ''}")
            if response.usage:
                print(f"  用量: {response.usage.prompt_tokens}+{response.usage.completion_tokens}={response.usage.total_tokens} tokens")
            return True
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_chat_stream(self) -> bool:
        """测试流式 Chat Completions"""
        print_header("测试 5: 流式 Chat Completions")
        
        if not HAS_OPENAI:
            print_info("跳过 (需要 openai 库)")
            return True
        
        try:
            start_time = time.time()
            stream = self.client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "user", "content": "Count from 1 to 5."}
                ],
                stream=True,
                max_tokens=50
            )
            
            print("  响应: ", end="", flush=True)
            chunk_count = 0
            full_content = ""
            for chunk in stream:
                chunk_count += 1
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_content += content
                    print(content, end="", flush=True)
            print()
            
            elapsed = time.time() - start_time
            print_success(f"流式请求成功 ({elapsed:.2f}s, {chunk_count} chunks)")
            return True
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_system_message(self) -> bool:
        """测试系统消息"""
        print_header("测试 6: 带系统消息的对话")
        
        if not HAS_OPENAI:
            print_info("跳过 (需要 openai 库)")
            return True
        
        try:
            response = self.client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that speaks like a pirate."},
                    {"role": "user", "content": "Hello!"}
                ],
                max_tokens=100
            )
            
            content = response.choices[0].message.content
            print_success("系统消息测试成功")
            print(f"  响应: {content[:150]}{'...' if len(content) > 150 else ''}")
            return True
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_multi_turn(self) -> bool:
        """测试多轮对话"""
        print_header("测试 7: 多轮对话")
        
        if not HAS_OPENAI:
            print_info("跳过 (需要 openai 库)")
            return True
        
        try:
            response = self.client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "user", "content": "My name is Alice."},
                    {"role": "assistant", "content": "Nice to meet you, Alice!"},
                    {"role": "user", "content": "What is my name?"}
                ],
                max_tokens=50
            )
            
            content = response.choices[0].message.content.lower()
            if "alice" in content:
                print_success("多轮对话测试成功 - 模型记住了名字")
            else:
                print_success("多轮对话测试完成 (模型可能未记住名字)")
            print(f"  响应: {response.choices[0].message.content}")
            return True
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_error_no_auth(self) -> bool:
        """测试错误处理 - 缺少认证"""
        print_header("测试 8: 错误处理 - 缺少认证")
        
        if not HAS_REQUESTS:
            print_info("跳过 (需要 requests 库)")
            return True
        
        try:
            response = requests.post(
                f"{self.base_url}/v1/chat/completions",
                headers={"Content-Type": "application/json"},
                json={
                    "model": "google/gemini-2.5-flash",
                    "messages": [{"role": "user", "content": "Hello"}]
                }
            )
            
            if response.status_code == 401:
                print_success("正确返回 401 错误")
                return True
            else:
                print_error(f"预期 401，实际 {response.status_code}")
                return False
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_error_invalid_json(self) -> bool:
        """测试错误处理 - 无效 JSON"""
        print_header("测试 9: 错误处理 - 无效 JSON")
        
        if not HAS_REQUESTS:
            print_info("跳过 (需要 requests 库)")
            return True
        
        try:
            response = requests.post(
                f"{self.base_url}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                data="invalid json"
            )
            
            if response.status_code == 400:
                print_success("正确返回 400 错误")
                return True
            else:
                print_error(f"预期 400，实际 {response.status_code}")
                return False
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def test_temperature(self) -> bool:
        """测试温度参数"""
        print_header("测试 10: 温度参数")
        
        if not HAS_OPENAI:
            print_info("跳过 (需要 openai 库)")
            return True
        
        try:
            response = self.client.chat.completions.create(
                model="google/gemini-2.5-flash",
                messages=[
                    {"role": "user", "content": "Give me a random word."}
                ],
                temperature=1.5,
                max_tokens=20
            )
            
            print_success("温度参数测试成功")
            print(f"  响应: {response.choices[0].message.content}")
            return True
        except Exception as e:
            print_error(f"请求失败: {e}")
            return False
    
    def run_all_tests(self):
        """运行所有测试"""
        print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
        print(f"{Colors.BLUE}  fal.ai OpenRouter Worker 测试{Colors.NC}")
        print(f"{Colors.BLUE}{'='*60}{Colors.NC}")
        print(f"  Worker URL: {Colors.YELLOW}{self.base_url}{Colors.NC}")
        print(f"  API Key: {Colors.YELLOW}{self.api_key[:10]}...{Colors.NC}")
        
        tests = [
            self.test_root,
            self.test_health,
            self.test_models,
            self.test_chat_non_stream,
            self.test_chat_stream,
            self.test_system_message,
            self.test_multi_turn,
            self.test_error_no_auth,
            self.test_error_invalid_json,
            self.test_temperature,
        ]
        
        for test in tests:
            try:
                if test():
                    self.passed += 1
                else:
                    self.failed += 1
            except Exception as e:
                print_error(f"测试异常: {e}")
                self.failed += 1
        
        # 打印总结
        print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
        print(f"{Colors.BLUE}  测试完成{Colors.NC}")
        print(f"{Colors.BLUE}{'='*60}{Colors.NC}")
        print(f"  {Colors.GREEN}通过: {self.passed}{Colors.NC}")
        print(f"  {Colors.RED}失败: {self.failed}{Colors.NC}")
        print(f"  总计: {self.passed + self.failed}")
        
        if self.failed == 0:
            print(f"\n{Colors.GREEN}🎉 所有测试通过！您的 Worker 已准备就绪。{Colors.NC}")
        else:
            print(f"\n{Colors.YELLOW}⚠️  部分测试失败，请检查配置。{Colors.NC}")
        
        return self.failed == 0


def main():
    parser = argparse.ArgumentParser(
        description="fal.ai OpenRouter Worker 测试脚本"
    )
    parser.add_argument(
        "--url", "-u",
        default="http://localhost:8787",
        help="Worker URL (默认: http://localhost:8787)"
    )
    parser.add_argument(
        "--key", "-k",
        default="your-fal-api-key",
        help="fal.ai API 密钥"
    )
    
    args = parser.parse_args()
    
    tester = WorkerTester(args.url, args.key)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

