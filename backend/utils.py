"""
工具函数：AI 代码生成和执行
"""
import os
import re
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # 使用非交互式后端
import matplotlib.pyplot as plt
import seaborn as sns
from volcenginesdkarkruntime import Ark
from typing import Dict, Any, Tuple


def call_deepseek_for_code(
    api_key: str,
    model_id: str,
    user_prompt: str,
    df: pd.DataFrame,
    output_path: str
) -> str:
    """
    调用 DeepSeek API 生成绘图代码
    
    Args:
        api_key: 火山引擎 API Key
        model_id: 模型 ID
        user_prompt: 用户的分析需求
        df: pandas DataFrame
        output_path: 图片保存路径
    
    Returns:
        生成的 Python 代码字符串
    """
    client = Ark(
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        api_key=api_key,
    )
    
    # 构建系统提示词
    system_prompt = """你是一个专业的数据可视化专家，擅长使用 Python 的 pandas 和 matplotlib 生成统计图表。

用户会提供：
1. 一个 pandas DataFrame (变量名为 `df`)
2. 一个数据分析需求
3. 一个输出路径 `output_path`

你的任务是：
1. 理解用户的需求
2. 根据数据结构和需求，编写 Python 代码
3. 代码必须使用 matplotlib.pyplot (导入为 `plt`) 或 seaborn (导入为 `sns`) 绘制图表
4. 代码必须将图表保存到 `output_path` (使用 plt.savefig(output_path))
5. 代码必须关闭图形 (使用 plt.close() 或 plt.clf())
6. 只返回 Python 代码，不要包含任何其他文字说明

重要规则：
- 必须使用中文标签和标题
- 确保图表类型适合数据（折线图用于趋势，饼图用于占比，柱状图用于对比等）
- 代码必须可以直接执行，假设 df 已经存在
- 不要使用 print 语句
- 只返回代码，不要用 markdown 代码块包裹"""

    # 获取数据信息
    columns = list(df.columns)
    dtypes = df.dtypes.to_dict()
    sample_data = df.head(10).to_dict('records')
    
    user_message = f"""数据分析需求：{user_prompt}

数据结构信息：
- 列名：{columns}
- 数据类型：{dtypes}
- 数据样本（前10行）：{sample_data}
- 总数据行数：{len(df)}

请根据以上信息和用户需求，生成 Python 绘图代码。
代码必须：
1. 使用 df 作为数据源
2. 使用 plt 或 sns 绘制图表
3. 保存图表到 output_path
4. 关闭图形

只返回 Python 代码，不要包含任何其他文字。"""

    try:
        completion = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        
        code = completion.choices[0].message.content.strip()
        
        # 尝试提取代码块（如果被 markdown 包裹）
        code_match = re.search(r'```(?:python)?\s*([\s\S]*?)\s*```', code)
        if code_match:
            code = code_match.group(1).strip()
        
        return code
        
    except Exception as e:
        raise Exception(f"AI 代码生成失败: {str(e)}")


def execute_plotting_code(code: str, df: pd.DataFrame, output_path: str) -> None:
    """
    执行 AI 生成的绘图代码
    
    Args:
        code: Python 代码字符串
        df: pandas DataFrame
        output_path: 图片保存路径
    
    Raises:
        Exception: 如果代码执行失败
    """
    # 准备执行环境
    import builtins
    
    # 限制可用的内置函数（安全措施）
    allowed_builtins = {
        'len', 'str', 'int', 'float', 'list', 'dict', 'tuple', 'set',
        'range', 'enumerate', 'zip', 'sum', 'max', 'min', 'abs', 'round',
        'sorted', 'reversed', 'any', 'all', 'isinstance', 'type', 'bool'
    }
    
    # 创建一个受限的 __builtins__ 字典
    restricted_builtins = {k: getattr(builtins, k) for k in allowed_builtins if hasattr(builtins, k)}
    
    exec_globals = {
        'df': df,
        'pd': pd,
        'plt': plt,
        'sns': sns,
        'output_path': output_path,
        '__builtins__': restricted_builtins
    }
    
    # 确保输出目录存在
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    
    try:
        # 执行代码
        exec(code, exec_globals)
        
        # 确保图片已保存（如果代码没有保存，尝试保存当前图形）
        if plt.get_fignums():
            plt.savefig(output_path, dpi=150, bbox_inches='tight')
            plt.close('all')
        
    except SyntaxError as e:
        raise Exception(f"代码语法错误: {str(e)}")
    except Exception as e:
        raise Exception(f"代码执行失败: {str(e)}")
    finally:
        # 清理所有图形
        plt.close('all')


def generate_chart(
    excel_path: str,
    prompt: str,
    api_key: str,
    model_id: str,
    output_path: str
) -> str:
    """
    生成图表的完整流程
    
    Args:
        excel_path: Excel 文件路径
        prompt: 用户的分析需求
        api_key: API Key
        model_id: Model ID
        output_path: 输出图片路径
    
    Returns:
        输出图片路径
    """
    # 1. 读取 Excel 文件
    try:
        df = pd.read_excel(excel_path)
    except Exception as e:
        raise Exception(f"Excel 文件读取失败: {str(e)}")
    
    # 2. 调用 AI 生成代码
    code = call_deepseek_for_code(api_key, model_id, prompt, df, output_path)
    
    # 3. 执行代码生成图表
    execute_plotting_code(code, df, output_path)
    
    # 4. 验证文件是否存在
    if not os.path.exists(output_path):
        raise Exception("图表生成失败：文件未创建")
    
    return output_path

