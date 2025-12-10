"""
FastAPI 后端服务：AI 图表生成 API
"""
import os
import uuid
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from utils import generate_chart

app = FastAPI(title="Smart DA Backend API", version="1.0.0")

# 配置 CORS（允许前端访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制为特定域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建输出目录
CHARTS_DIR = Path("charts")
CHARTS_DIR.mkdir(exist_ok=True)


@app.get("/")
async def root():
    """健康检查端点"""
    return {"message": "Smart DA Backend API is running"}


@app.post("/generate-chart")
async def generate_chart_endpoint(
    file: UploadFile = File(..., description="Excel 文件"),
    prompt: str = Form(..., description="数据分析需求提示词"),
    api_key: str = Form(None, description="火山引擎 API Key（可选，也可从环境变量读取）"),
    model_id: str = Form(None, description="模型 ID（可选，也可从环境变量读取）")
):
    """
    生成统计图表
    
    - **file**: Excel 文件
    - **prompt**: 用户的分析需求，例如："画一个按日期的交易量折线图"
    - **api_key**: 火山引擎 API Key（可选，优先使用环境变量 ARK_API_KEY）
    - **model_id**: 模型 ID（可选，优先使用环境变量 ARK_MODEL_ID）
    
    返回生成的图表图片（PNG 格式）
    """
    # 获取配置
    api_key = api_key or os.getenv('ARK_API_KEY')
    model_id = model_id or os.getenv('ARK_MODEL_ID', 'deepseek-v3-250324')
    
    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 未提供，请通过参数或环境变量 ARK_API_KEY 设置")
    
    # 验证文件类型
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="只支持 Excel 文件 (.xlsx, .xls)")
    
    # 保存上传的文件
    temp_excel_path = None
    output_image_path = None
    
    try:
        # 生成唯一文件名
        file_id = str(uuid.uuid4())
        temp_dir = Path("/tmp") if os.name != 'nt' else Path(os.getenv('TEMP', './tmp'))
        temp_dir.mkdir(exist_ok=True)
        temp_excel_path = temp_dir / f"{file_id}_{file.filename}"
        output_image_path = CHARTS_DIR / f"{file_id}.png"
        
        # 保存上传的文件
        with open(temp_excel_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        # 生成图表
        generate_chart(
            excel_path=temp_excel_path,
            prompt=prompt,
            api_key=api_key,
            model_id=model_id,
            output_path=str(output_image_path)
        )
        
        # 返回图片文件
        if not output_image_path.exists():
            raise HTTPException(status_code=500, detail="图表生成失败")
        
        return FileResponse(
            path=str(output_image_path),
            media_type="image/png",
            filename=f"chart_{file_id}.png"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")
    
    finally:
        # 清理临时文件
        if temp_excel_path and os.path.exists(temp_excel_path):
            try:
                os.remove(temp_excel_path)
            except:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

