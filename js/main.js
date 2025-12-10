const { createApp } = Vue;

createApp({
    data() {
        return {
            activeTab: 'dashboard',
            rawData: [],
            filters: {
                startDate: '',
                endDate: '',
                institutionType: '',
                term: '',
                direction: '',
                transactionType: ''
            },
            pieChartDimension: '机构类型', // 新增：饼图统计维度
            apiKey: null,
            modelId: null,
            aiQuery: '',
            aiChartData: null,
            aiError: null,
            isLoadingAI: false,
            lineChart: null,
            pieChart: null,
            aiChart: null
        };
    },
    computed: {
        uniqueInstitutionTypes() {
            if (!this.rawData.length) return [];
            const types = new Set(this.rawData.map(row => row['机构类型'] || '').filter(Boolean));
            return Array.from(types).sort();
        },
        uniqueTerms() {
            if (!this.rawData.length) return [];
            const terms = new Set(this.rawData.map(row => row['期限'] || '').filter(Boolean));
            return Array.from(terms).sort();
        },
        uniqueDirections() {
            if (!this.rawData.length) return [];
            // 支持 "方向" 或 "交易方向"
            const colName = this.rawData[0].hasOwnProperty('方向') ? '方向' : '交易方向';
            const directions = new Set(this.rawData.map(row => row[colName] || '').filter(Boolean));
            return Array.from(directions).sort();
        },
        transactionTypes() {
            if (!this.rawData.length) return [];
            // 从数据中提取所有可能的交易类型列（排除日期、机构类型、期限、方向/交易方向等元数据列）
            const metaColumns = ['日期', '机构类型', '期限', '交易方向', '方向'];
            const allColumns = Object.keys(this.rawData[0] || {});
            return allColumns.filter(col => !metaColumns.includes(col));
        },
        filteredData() {
            let data = [...this.rawData];
            
            // 确定方向列名
            const directionCol = this.rawData.length > 0 && this.rawData[0].hasOwnProperty('方向') ? '方向' : '交易方向';

            // 日期过滤
            if (this.filters.startDate) {
                data = data.filter(row => {
                    const rowDate = this.parseDate(row['日期']);
                    return rowDate >= new Date(this.filters.startDate);
                });
            }
            if (this.filters.endDate) {
                data = data.filter(row => {
                    const rowDate = this.parseDate(row['日期']);
                    return rowDate <= new Date(this.filters.endDate);
                });
            }
            
            // 机构类型过滤
            if (this.filters.institutionType) {
                data = data.filter(row => row['机构类型'] === this.filters.institutionType);
            }
            
            // 期限过滤
            if (this.filters.term) {
                data = data.filter(row => row['期限'] === this.filters.term);
            }
            
            // 交易方向过滤
            if (this.filters.direction) {
                data = data.filter(row => row[directionCol] === this.filters.direction);
            }
            
            return data;
        }
    },
    watch: {
        filteredData: {
            handler() {
                this.updateCharts();
            },
            deep: true
        },
        'filters.transactionType'() {
            this.updateCharts();
        },
        pieChartDimension() { // 监听饼图维度变化
            this.updatePieChart();
        }
    },
    mounted() {
        this.loadConfig();
        this.loadCachedData(); // 尝试加载缓存的数据
        this.$nextTick(() => {
            this.initCharts();
        });
    },
    methods: {
        // IndexedDB 相关操作
        async openDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('SmartDA_DB', 1);
                request.onerror = () => reject('无法打开数据库');
                request.onsuccess = (e) => resolve(e.target.result);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('files')) {
                        db.createObjectStore('files');
                    }
                };
            });
        },

        async cacheFile(fileData) {
            try {
                const db = await this.openDB();
                const tx = db.transaction('files', 'readwrite');
                const store = tx.objectStore('files');
                store.put(fileData, 'lastFile');
            } catch (e) {
                console.warn('缓存文件失败:', e);
            }
        },

        async loadCachedData() {
            try {
                const db = await this.openDB();
                const tx = db.transaction('files', 'readonly');
                const store = tx.objectStore('files');
                const request = store.get('lastFile');
                
                request.onsuccess = () => {
                    const data = request.result;
                    if (data) {
                        this.processExcelData(data);
                        console.log('已加载缓存的文件数据');
                    }
                };
            } catch (e) {
                console.warn('加载缓存失败:', e);
            }
        },

        async loadConfig() {
            // 优先从全局配置对象读取 (config.js)
            if (window.SmartDAConfig) {
                this.apiKey = window.SmartDAConfig.ARK_API_KEY || null;
                this.modelId = window.SmartDAConfig.ARK_MODEL_ID || null;
            }

            if (!this.apiKey) {
                console.warn('未检测到 API Key，请在 js/config.js 中配置');
            }
        },
        handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                // 缓存文件数据
                this.cacheFile(data);
                this.processExcelData(data);
            };
            reader.readAsArrayBuffer(file);
        },
        processExcelData(data) {
            try {
                const workbook = XLSX.read(data, { type: 'array' });
                
                // 读取第一个工作表
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // 转换为JSON
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                // 处理日期格式
                this.rawData = jsonData.map(row => {
                    if (row['日期']) {
                        // 尝试解析日期
                        const date = this.parseDate(row['日期']);
                        if (date) {
                            row['日期'] = date.toISOString().split('T')[0];
                        }
                    }
                    return row;
                });
                
                // 设置默认日期范围
                if (this.rawData.length > 0) {
                    const dates = this.rawData.map(row => this.parseDate(row['日期'])).filter(Boolean).sort((a, b) => a - b);
                    if (dates.length > 0) {
                        this.filters.startDate = dates[0].toISOString().split('T')[0];
                        this.filters.endDate = dates[dates.length - 1].toISOString().split('T')[0];
                    }
                }
                
                this.$nextTick(() => {
                    this.updateCharts();
                });
            } catch (error) {
                alert('文件读取失败：' + error.message);
            }
        },
        parseDate(dateValue) {
            if (!dateValue) return null;
            
            // 如果是字符串格式的日期
            if (typeof dateValue === 'string') {
                const parsed = new Date(dateValue);
                if (!isNaN(parsed.getTime())) return parsed;
            }
            
            // 如果是数字（Excel日期序列号）
            if (typeof dateValue === 'number') {
                // Excel日期从1900-01-01开始计算
                const excelEpoch = new Date(1899, 11, 30);
                const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
                return date;
            }
            
            // 如果是Date对象
            if (dateValue instanceof Date) {
                return dateValue;
            }
            
            return null;
        },
        initCharts() {
            // 初始化折线图
            const lineChartDom = document.getElementById('lineChart');
            if (lineChartDom) {
                this.lineChart = echarts.init(lineChartDom);
                // 响应式调整
                window.addEventListener('resize', () => {
                    if (this.lineChart) {
                        this.lineChart.resize();
                    }
                });
            }
            
            // 初始化饼图
            const pieChartDom = document.getElementById('pieChart');
            if (pieChartDom) {
                this.pieChart = echarts.init(pieChartDom);
                // 响应式调整
                window.addEventListener('resize', () => {
                    if (this.pieChart) {
                        this.pieChart.resize();
                    }
                });
            }
            
            // 初始化AI图表（延迟初始化，因为它在AI标签页中）
            // 将在需要时初始化
        },
        updateCharts() {
            if (!this.lineChart || !this.pieChart) {
                this.$nextTick(() => {
                    this.initCharts();
                    this.updateCharts();
                });
                return;
            }
            
            this.updateLineChart();
            this.updatePieChart();
        },
        updateLineChart() {
            // 如果没有数据，显示提示
            if (this.filteredData.length === 0) {
                this.lineChart.setOption({
                    title: {
                        text: '暂无数据',
                        left: 'center',
                        top: 'middle',
                        textStyle: { color: '#999' }
                    }
                });
                return;
            }
            
            // 按日期分组并汇总
            const dateMap = {};
            this.filteredData.forEach(row => {
                const date = row['日期'];
                let value = 0;
                
                if (this.filters.transactionType === '全部' || !this.filters.transactionType) {
                    // 如果选了全部或没选，汇总所有交易类型
                    this.transactionTypes.forEach(type => {
                        value += parseFloat(row[type]) || 0;
                    });
                } else {
                    // 否则只取选定的交易类型
                    value = parseFloat(row[this.filters.transactionType]) || 0;
                }

                if (date) {
                    if (!dateMap[date]) {
                        dateMap[date] = 0;
                    }
                    dateMap[date] += value;
                }
            });
            
            // 转换为数组并排序
            const dates = Object.keys(dateMap).sort();
            const values = dates.map(date => dateMap[date]);
            
            const titleText = (!this.filters.transactionType || this.filters.transactionType === '全部') 
                ? '总交易量趋势图' 
                : `${this.filters.transactionType} 趋势图`;

            const option = {
                title: {
                    text: titleText,
                    left: 'center',
                    textStyle: { fontSize: 16 }
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'cross' }
                },
                toolbox: { // 添加下载功能
                    feature: {
                        saveAsImage: { title: '下载图片' }
                    },
                    right: 20
                },
                xAxis: {
                    type: 'category',
                    data: dates,
                    axisLabel: { rotate: 45 }
                },
                yAxis: {
                    type: 'value',
                    name: '交易量'
                },
                series: [{
                    name: '交易量',
                    type: 'line',
                    data: values,
                    smooth: true,
                    itemStyle: { color: '#3b82f6' },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                                { offset: 1, color: 'rgba(59, 130, 246, 0.1)' }
                            ]
                        }
                    }
                }],
                grid: {
                    left: '10%',
                    right: '10%',
                    bottom: '15%',
                    top: '15%'
                }
            };
            
            this.lineChart.setOption(option, true); // true 表示不合并，完全重绘
        },
        updatePieChart() {
            if (this.filteredData.length === 0) {
                this.pieChart.setOption({
                    title: {
                        text: '暂无数据',
                        left: 'center',
                        top: 'middle',
                        textStyle: { color: '#999' }
                    }
                });
                return;
            }
            
            // 确定分组列名
            let groupCol = '机构类型';
            let chartTitle = '机构类型交易量占比';
            
            if (this.pieChartDimension === '期限') {
                groupCol = '期限';
                chartTitle = '期限交易量占比';
            } else if (this.pieChartDimension === '交易方向') {
                // 自动检测方向列名
                groupCol = this.rawData.length > 0 && this.rawData[0].hasOwnProperty('方向') ? '方向' : '交易方向';
                chartTitle = '交易方向交易量占比';
            } else if (this.pieChartDimension === '交易类型') {
                groupCol = '交易类型'; // 特殊标记
                chartTitle = '各交易类型总量占比';
            }

            // 按选定维度分组并汇总
            const groupMap = {};
            
            if (groupCol === '交易类型') {
                // 特殊处理：按交易类型汇总（列转行）
                this.transactionTypes.forEach(type => {
                    // 如果有筛选交易类型，且当前类型不是筛选的类型，则跳过
                    if (this.filters.transactionType && this.filters.transactionType !== '全部' && type !== this.filters.transactionType) {
                        return;
                    }
                    groupMap[type] = 0;
                });
                
                this.filteredData.forEach(row => {
                    this.transactionTypes.forEach(type => {
                        // 如果有筛选交易类型，且当前类型不是筛选的类型，则跳过
                        if (this.filters.transactionType && this.filters.transactionType !== '全部' && type !== this.filters.transactionType) {
                            return;
                        }
                        const value = parseFloat(row[type]) || 0;
                        if (groupMap[type] !== undefined) {
                            groupMap[type] += value;
                        }
                    });
                });
            } else {
                // 常规处理：按某一列分组
                this.filteredData.forEach(row => {
                    const key = row[groupCol] || '未知';
                    if (!groupMap[key]) {
                        groupMap[key] = 0;
                    }
                    
                    // 汇总值：如果有筛选交易类型，则只统计该类型；如果是全部，则统计所有类型
                    if (this.filters.transactionType && this.filters.transactionType !== '全部') {
                         groupMap[key] += parseFloat(row[this.filters.transactionType]) || 0;
                    } else {
                        this.transactionTypes.forEach(type => {
                            const value = parseFloat(row[type]) || 0;
                            groupMap[key] += value;
                        });
                    }
                });
            }
            
            const pieData = Object.keys(groupMap).map(key => ({
                name: key,
                value: groupMap[key]
            })).filter(item => item.value > 0);
            
            const option = {
                title: {
                    text: chartTitle,
                    left: 'center',
                    textStyle: { fontSize: 16 }
                },
                tooltip: {
                    trigger: 'item',
                    formatter: '{a} <br/>{b}: {c} ({d}%)'
                },
                toolbox: { // 添加下载功能
                    feature: {
                        saveAsImage: { title: '下载图片' }
                    },
                    right: 20
                },
                legend: {
                    type: 'scroll', // 启用滚动图例，防止重叠
                    orient: 'vertical',
                    left: 'left',
                    top: 'middle',
                    pageIconColor: '#3b82f6',
                    pageTextStyle: { color: '#666' }
                },
                series: [{
                    name: '交易量',
                    type: 'pie',
                    radius: ['40%', '70%'],
                    center: ['60%', '50%'], // 稍微右移，给左侧图例留出空间
                    avoidLabelOverlap: true, // 开启防重叠
                    itemStyle: {
                        borderRadius: 10,
                        borderColor: '#fff',
                        borderWidth: 2
                    },
                    label: {
                        show: true,
                        formatter: '{b}: {d}%'
                    },
                    emphasis: {
                        label: {
                            show: true,
                            fontSize: 16,
                            fontWeight: 'bold'
                        }
                    },
                    data: pieData
                }]
            };
            
            this.pieChart.setOption(option, true);
        },
        async handleAIQuery() {
            if (!this.apiKey) {
                this.aiError = 'API Key 未配置，请检查 js/config.js 文件';
                return;
            }
            
            if (!this.rawData.length) {
                this.aiError = '请先上传数据文件';
                return;
            }
            
            if (!this.aiQuery.trim()) {
                this.aiError = '请输入分析需求';
                return;
            }
            
            this.isLoadingAI = true;
            this.aiError = null;
            this.aiChartData = null;
            
            try {
                // 准备数据样本（前10行，用于展示数据结构）
                const sampleData = this.rawData.slice(0, 10);
                const columns = Object.keys(this.rawData[0] || {});
                
                // 使用完整数据集（如果数据量太大，API会限制，所以使用前500行）
                const dataForAI = this.rawData.length > 500 ? this.rawData.slice(0, 500) : this.rawData;
                
                const chartOption = await callDeepSeekAPI(
                    this.apiKey,
                    this.modelId, // 传入 Model ID
                    this.aiQuery,
                    columns,
                    sampleData,
                    dataForAI
                );
                
                if (chartOption) {
                    this.aiChartData = chartOption;
                    
                    // 强制添加下载功能
                    if (!chartOption.toolbox) {
                        chartOption.toolbox = {};
                    }
                    if (!chartOption.toolbox.feature) {
                        chartOption.toolbox.feature = {};
                    }
                    chartOption.toolbox.feature.saveAsImage = { title: '下载图片' };
                    if (!chartOption.toolbox.right) {
                        chartOption.toolbox.right = 20;
                    }

                    this.$nextTick(() => {
                        // 确保图表容器存在
                        const aiChartDom = document.getElementById('aiChart');
                        if (!aiChartDom) {
                            this.aiError = '图表容器未找到';
                            return;
                        }
                        
                        // 初始化或重用图表实例
                        if (!this.aiChart) {
                            this.aiChart = echarts.init(aiChartDom);
                        }
                        
                        // 设置配置
                        this.aiChart.setOption(chartOption, true);
                        
                        // 响应式调整
                        window.addEventListener('resize', () => {
                            if (this.aiChart) {
                                this.aiChart.resize();
                            }
                        });
                    });
                } else {
                    this.aiError = '未能生成有效的图表配置';
                }
            } catch (error) {
                this.aiError = '生成图表失败：' + error.message;
                console.error('AI Query Error:', error);
            } finally {
                this.isLoadingAI = false;
            }
        }
    }
}).mount('#app');

