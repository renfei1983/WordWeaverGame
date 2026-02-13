
import os
from openai import OpenAI

client = OpenAI(
    api_key="sk-duqswfvepjxdlbthauydvhuajncqzwvmruizkpafmqhypcja",
    base_url="https://api.siliconflow.cn/v1"
)

try:
    response = client.chat.completions.create(
        model="deepseek-ai/DeepSeek-V3",
        messages=[{"role": "user", "content": "Hello"}],
        max_tokens=10
    )
    print("SUCCESS")
    print(response.choices[0].message.content)
except Exception as e:
    print(f"ERROR: {e}")
