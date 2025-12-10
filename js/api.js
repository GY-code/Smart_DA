/**
 * DeepSeek API 调用函数
 * @param {string} apiKey - 火山引擎 API Key
 * @param {string} modelId - 火山引擎 Model ID
 * @param {string} userQuery - 用户的分析需求
 * @param {Array} columns - 数据列名
 * @param {Array} sampleData - 数据样本（前10行）
 * @param {Array} fullData - 完整数据集
 * @returns {Promise<Object>} ECharts 配置对象
 */
async function callDeepSeekAPI(apiKey, modelId, userQuery, columns, sampleData, fullData) {
    const baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
    const model = modelId || 'doubao-seed-1-6-251015'; // 使用配置的ID或默认值
    
    // 构建系统提示词
    const systemPrompt = `你是一个专业的数据可视化专家，擅长使用 ECharts 生成图表。

用户会提供：
1. 数据列名列表
2. 数据样本（前10行）
3. 完整数据集（用于实际计算）
4. 一个数据分析需求

你的任务是：
1. 理解用户的需求
2. 根据数据结构和需求，分析完整数据集，计算所需的数据
3. 生成一个完整的 ECharts 配置对象（option），包含实际计算好的数据
4. 只返回有效的 JSON 格式的 ECharts option，不要包含任何其他文字说明

重要规则：
- 必须返回纯 JSON 格式，可以直接被 JSON.parse() 解析
- 不要使用 markdown 代码块包裹
- 确保图表类型适合数据（折线图用于趋势，饼图用于占比，柱状图用于对比等）
- 使用中文标签和标题
- 确保数据字段名称与提供的列名完全匹配
- 必须基于完整数据集进行数据聚合和计算，不要只使用样本数据
- 如果用户要求趋势图，需要按日期排序数据
- 如果用户要求占比图，需要计算各部分的数值和百分比`;

    // 为了减少token使用，我们只发送前100行数据给AI（如果数据太多）
    const dataForAI = fullData.length > 100 ? fullData.slice(0, 100) : fullData;
    
    const userMessage = `数据分析需求：${userQuery}

数据结构信息：
- 列名：${JSON.stringify(columns)}
- 数据样本（前10行，用于了解结构）：${JSON.stringify(sampleData)}
- 用于计算的数据（${dataForAI.length}行）：${JSON.stringify(dataForAI)}
- 总数据行数：${fullData.length}

请根据以上信息和用户需求：
1. 分析完整数据集
2. 进行必要的数据聚合、分组、计算
3. 生成一个包含实际数据的完整 ECharts 配置对象

只返回 JSON 格式的 ECharts option 对象，不要包含任何其他文字。确保 option 中的 series.data 包含实际计算好的数据。`;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: userMessage
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content.trim();
        
        // 尝试解析 JSON（可能被 markdown 代码块包裹）
        let chartOption;
        
        // 尝试直接解析
        try {
            chartOption = JSON.parse(content);
        } catch (e) {
            // 如果失败，尝试提取 JSON 代码块
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                chartOption = JSON.parse(jsonMatch[1]);
            } else {
                // 尝试提取第一个 { ... } 块
                const braceMatch = content.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    chartOption = JSON.parse(braceMatch[0]);
                } else {
                    throw new Error('无法从响应中提取 JSON 配置');
                }
            }
        }
        
        // 验证是否是有效的 ECharts option
        if (!chartOption || typeof chartOption !== 'object') {
            throw new Error('返回的不是有效的配置对象');
        }
        
        // 如果AI返回的配置中数据不完整，尝试基于用户查询智能填充数据
        // 这里可以进一步优化，但先返回AI生成的配置
        return chartOption;
        
    } catch (error) {
        console.error('DeepSeek API Error:', error);
        throw error;
    }
}

