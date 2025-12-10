"""
测试脚本：测试后端 API
"""
import requests
import os
from pathlib import Path

# API 地址
API_URL = "http://localhost:8000/generate-chart"

# 测试数据
EXCEL_FILE = "../example/机构成交数据脱敏.xlsx"
PROMPT = "画一个按日期的交易量折线图，显示所有交易类型的总和"

# 从环境变量或配置读取 API Key
API_KEY = os.getenv("ARK_API_KEY", "2a8b921a-5e4b-43f0-82a6-38d270a87852")
MODEL_ID = os.getenv("ARK_MODEL_ID", "deepseek-v3-250324")


def test_generate_chart():
    """测试图表生成 API"""
    print(f"测试 API: {API_URL}")
    print(f"Excel 文件: {EXCEL_FILE}")
    print(f"Prompt: {PROMPT}")
    print("-" * 50)
    
    # 检查文件是否存在
    if not Path(EXCEL_FILE).exists():
        print(f"错误: 文件不存在 {EXCEL_FILE}")
        print("请确保在 backend 目录下运行此脚本，且 example 目录中有测试文件")
        return
    
    try:
        # 准备请求
        with open(EXCEL_FILE, "rb") as f:
            files = {"file": (Path(EXCEL_FILE).name, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
            data = {
                "prompt": PROMPT,
                "api_key": API_KEY,
                "model_id": MODEL_ID
            }
            
            print("发送请求...")
            response = requests.post(API_URL, files=files, data=data, timeout=120)
        
        # 检查响应
        if response.status_code == 200:
            # 保存图片
            output_path = "test_output.png"
            with open(output_path, "wb") as f:
                f.write(response.content)
            print(f"✅ 成功！图表已保存到: {output_path}")
        else:
            print(f"❌ 错误: {response.status_code}")
            print(f"响应内容: {response.text}")
    
    except requests.exceptions.ConnectionError:
        print("❌ 连接失败: 请确保后端服务正在运行")
        print("运行命令: python main.py 或 uvicorn main:app --reload")
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")


if __name__ == "__main__":
    test_generate_chart()


