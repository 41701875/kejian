 // 全局图表实例
        let distributionChart = null;
        let pieChart = null;
        let normalChart = null;

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', function() {
            const fileInput = document.getElementById('fileInput');
            const dropArea = document.getElementById('dropArea');
            const loadingIndicator = document.getElementById('loadingIndicator');
            const resultsSection = document.getElementById('resultsSection');
            const sampleDataBtn = document.getElementById('sampleDataBtn');
            
            // 文件选择处理
            fileInput.addEventListener('change', async function(e) {
                if (e.target.files.length) {
                    showLoading(true);
                    try {
                        const file = e.target.files[0];
                        const data = await parseFile(file);
                        await analyzeData(data);
                    } catch (error) {
                        alert(`错误: ${error.message}`);
                    } finally {
                        showLoading(false);
                    }
                }
            });
            
            // 使用示例数据
            sampleDataBtn.addEventListener('click', async function() {
                showLoading(true);
                try {
                    const data = generateSampleData();
                    await analyzeData(data);
                } catch (error) {
                    alert(`错误: ${error.message}`);
                } finally {
                    showLoading(false);
                }
            });
            
            // 拖拽功能
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropArea.addEventListener(eventName, preventDefaults, false);
            });
            
            function preventDefaults(e) {
                e.preventDefault();
                e.stopPropagation();
            }
            
            ['dragenter', 'dragover'].forEach(eventName => {
                dropArea.addEventListener(eventName, highlight, false);
            });
            
            ['dragleave', 'drop'].forEach(eventName => {
                dropArea.addEventListener(eventName, unhighlight, false);
            });
            
            function highlight() {
                dropArea.classList.add('drag-over');
            }
            
            function unhighlight() {
                dropArea.classList.remove('drag-over');
            }
            
            dropArea.addEventListener('drop', handleDrop, false);
            
            function handleDrop(e) {
                const dt = e.dataTransfer;
                const file = dt.files[0];
                
                if (file) {
                    if (isValidFileType(file)) {
                        fileInput.files = dt.files;
                        fileInput.dispatchEvent(new Event('change'));
                    } else {
                        alert('请上传Excel或CSV文件！');
                    }
                }
            }
            
            function isValidFileType(file) {
                return file.name.endsWith('.xlsx') || 
                       file.name.endsWith('.xls') || 
                       file.name.endsWith('.csv');
            }
            
            function showLoading(show) {
                loadingIndicator.style.display = show ? 'block' : 'none';
            }
            
            // 示例数据生成（正态分布）
            function generateSampleData() {
                const data = [];
                const mean = 75; // 平均分
                const stdDev = 10; // 标准差
                const count = 100; // 学生数量
                
                for (let i = 1; i <= count; i++) {
                    // 生成符合正态分布的成绩
                    const u1 = Math.random();
                    const u2 = Math.random();
                    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                    const score = Math.round(Math.max(0, Math.min(100, z * stdDev + mean)));
                    
                    data.push({
                        name: `学生${i}`,
                        studentId: `S${1000 + i}`,
                        score: score
                    });
                }
                
                return data;
            }
            
            // 文件解析 - 支持"成绩"列名
            async function parseFile(file) {
                return new Promise((resolve, reject) => {
                    if (file.name.endsWith('.csv')) {
                        Papa.parse(file, {
                            header: true,
                            dynamicTyping: true,
                            complete: function(results) {
                                // 支持多种列名：优先"成绩"，然后是"Score"、"score"、"grade"
                                const formattedData = results.data.map(row => {
                                    // 检查是否存在"成绩"列
                                    if (row['成绩'] !== undefined) {
                                        row.score = row['成绩'];
                                    }
                                    // 检查其他可能的列名
                                    else if (row.Score !== undefined) {
                                        row.score = row.Score;
                                    }
                                    else if (row.score === undefined && row.grade !== undefined) {
                                        row.score = row.grade;
                                    }
                                    return row;
                                });
                                resolve(formattedData);
                            },
                            error: function(error) {
                                reject(new Error('CSV文件解析失败: ' + error.message));
                            }
                        });
                    } else {
                        const reader = new FileReader();
                        
                        reader.onload = function(e) {
                            try {
                                const data = new Uint8Array(e.target.result);
                                const workbook = XLSX.read(data, {type: 'array'});
                                
                                // 获取第一个工作表
                                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                                
                                // 转换为JSON
                                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                                
                                // 检查数据格式 - 支持多种列名
                                const formattedData = jsonData.map(row => {
                                    // 检查是否存在"成绩"列
                                    if (row['成绩'] !== undefined) {
                                        row.score = row['成绩'];
                                    }
                                    // 检查其他可能的列名
                                    else if (row.Score !== undefined) {
                                        row.score = row.Score;
                                    }
                                    else if (row.score === undefined && row.grade !== undefined) {
                                        row.score = row.grade;
                                    }
                                    return row;
                                });
                                
                                resolve(formattedData);
                            } catch (error) {
                                reject(new Error('Excel文件解析失败: ' + error.message));
                            }
                        };
                        
                        reader.onerror = function(error) {
                            reject(new Error('文件读取失败: ' + error.target.error.name));
                        };
                        
                        reader.readAsArrayBuffer(file);
                    }
                });
            }
            
            // 数据分析和图表生成
            async function analyzeData(data) {
                try {
                    // 提取成绩数据 - 支持多种列名
                    const scores = data
                        .map(row => {
                            // 使用统一的score字段
                            const score = row.score;
                            return score !== undefined ? Number(score) : null;
                        })
                        .filter(score => score !== null && !isNaN(score) && score >= 0 && score <= 100);
                    
                    if (scores.length === 0) {
                        throw new Error('文件中没有找到有效的成绩数据！请确保包含"成绩"、"Score"、"score"或"grade"列');
                    }
                    
                    // 计算统计指标
                    const mean = calculateMean(scores);
                    const stdDev = calculateStandardDeviation(scores, mean);
                    const min = Math.min(...scores);
                    const max = Math.max(...scores);
                    const discrimination = calculateDiscrimination(scores);
                    // 更新统计卡片
                    document.getElementById('meanValue').textContent = mean.toFixed(2);
                    document.getElementById('stdDevValue').textContent = stdDev.toFixed(2);
                    document.getElementById('maxValue').textContent = max;
                    document.getElementById('minValue').textContent = min;
                    document.getElementById('discriminationValue').textContent = discrimination.toFixed(2);
                    // 生成分数段分布
                    const distribution = generateScoreDistribution(scores);
                    
                    // 计算每个分数段的百分比
                    const totalStudents = scores.length;
                    const distributionPercentages = distribution.map(count => 
                        ((count / totalStudents) * 100).toFixed(1) + '%'
                    );
                    
                    // 生成分数等级分布
                    const gradeDistribution = generateGradeDistribution(scores);
                    
                    // 生成正态分布曲线数据
                    const normalCurve = generateNormalCurve(mean, stdDev);
                    
                    // 渲染图表
                    renderCharts(distribution, distributionPercentages, gradeDistribution, normalCurve, mean, stdDev);
                    
                    // 显示结果区域
                    resultsSection.style.display = 'block';
                } catch (error) {
                    throw error;
                }
            }
            
            // 计算平均值
            function calculateMean(scores) {
                const sum = scores.reduce((acc, score) => acc + score, 0);
                return sum / scores.length;
            }
            
            // 新增：区分度计算函数
            function calculateDiscrimination(scores) {
                // 按成绩降序排序
                const sortedScores = [...scores].sort((a, b) => b - a);
                const total = sortedScores.length;
                
                // 计算27%分组位置
                const groupSize = Math.round(total * 0.27);
                
                // 获取高分组和低分组
                const highGroup = sortedScores.slice(0, groupSize);
                const lowGroup = sortedScores.slice(total - groupSize);
                
                // 计算平均分
                const highMean = calculateMean(highGroup);
                const lowMean = calculateMean(lowGroup);
                
                // 计算区分度
                return (highMean - lowMean) / 100;
            }  
            
            // 计算标准差
            function calculateStandardDeviation(scores, mean) {
                const squaredDifferences = scores.map(score => Math.pow(score - mean, 2));
                const variance = squaredDifferences.reduce((acc, sd) => acc + sd, 0) / scores.length;
                return Math.sqrt(variance);
            }
            
            // 生成分数段分布 (10分一段)
            function generateScoreDistribution(scores) {
                const distribution = Array(10).fill(0); // 0-9, 10-19, ..., 90-100
                
                scores.forEach(score => {
                    const index = Math.min(9, Math.floor(score / 10));
                    distribution[index]++;
                });
                
                return distribution;
            }
            
            // 生成分数等级分布
            function generateGradeDistribution(scores) {
                const distribution = {
                    '优秀(≥90)': 0,
                    '良好(80-89)': 0,
                    '中等(70-79)': 0,
                    '及格(60-69)': 0,
                    '不及格(<60)': 0
                };
                
                scores.forEach(score => {
                    if (score >= 90) distribution['优秀(≥90)']++;
                    else if (score >= 80) distribution['良好(80-89)']++;
                    else if (score >= 70) distribution['中等(70-79)']++;
                    else if (score >= 60) distribution['及格(60-69)']++;
                    else distribution['不及格(<60)']++;
                });
                
                return Object.entries(distribution);
            }
            
            // 生成正态分布曲线数据
            function generateNormalCurve(mean, stdDev) {
                const points = [];
                const minX = Math.max(0, mean - 4 * stdDev);
                const maxX = Math.min(100, mean + 4 * stdDev);
                
                for (let x = minX; x <= maxX; x += 0.5) {
                    // 正态分布概率密度函数
                    const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
                    const y = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
                    
                    // 将概率密度转换为适合图表显示的值（缩放100倍）
                    points.push({x, y: y * 100});
                }
                
                return points;
            }
            
            // 渲染图表
            function renderCharts(distribution, distributionPercentages, gradeDistribution, normalCurve, mean, stdDev) {
                // 销毁旧图表
                if (distributionChart) distributionChart.destroy();
                if (pieChart) pieChart.destroy();
                if (normalChart) normalChart.destroy();

 // 添加水印功能
function addWatermark() {
  const canvas = document.getElementById('watermarkCanvas');
  const ctx = canvas.getContext('2d');
  const dropArea = document.getElementById('dropArea');
  
  // 设置canvas尺寸与上传区域一致
  canvas.width = dropArea.offsetWidth;
  canvas.height = dropArea.offsetHeight;
  
  // 水印样式设置
  ctx.font = "24px Arial";
  ctx.fillStyle = "rgba(0, 0, 0, 0.08)"; // 半透明黑色
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  
  // 计算水印位置和密度
  const text = "玩机故事";
  const textWidth = ctx.measureText(text).width;
  const spacingX = 200; // 水平间距
  const spacingY = 100; // 垂直间距
  const rows = Math.ceil(canvas.height / spacingY);
  const cols = Math.ceil(canvas.width / spacingX);
  
  // 绘制水印
  ctx.save();
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.rotate(-15 * Math.PI / 180); // 旋转15度
  
  for (let i = -rows; i < rows; i++) {
    for (let j = -cols; j < cols; j++) {
      const x = j * (textWidth + spacingX);
      const y = i * (spacingY);
      ctx.fillText(text, x, y);
    }
  }
  
  ctx.restore();
}

// 页面加载时添加水印
document.addEventListener('DOMContentLoaded', function() {
  addWatermark();
  
  // 窗口大小变化时重新绘制水印
  window.addEventListener('resize', function() {
    addWatermark();
  });
});  
             
                // 1. 成绩分布直方图（带百分比）
               const distributionCtx = document.getElementById('distributionChart').getContext('2d');
distributionChart = new Chart(distributionCtx, {
    type: 'bar',
    data: {
        labels: ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'],
        datasets: [{
            label: '学生人数',
            data: distribution,
            backgroundColor: 'rgba(54, 162, 235, 0.7)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const index = context.dataIndex;
                        const count = context.raw;
                        const percentage = distributionPercentages[index];
                        return `学生人数: ${count} (${percentage})`;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: '学生人数'
                }
            },
            x: {
                title: {
                    display: true,
                    text: '分数段'
                }
            }
        }
    },
    plugins: [{
        id: 'datalabels',
        afterDraw: function(chart) {
            const ctx = chart.ctx;
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = '#333';

            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                if (!meta.hidden) {
                    meta.data.forEach((element, index) => {
                        const data = dataset.data[index];
                        const percentage = distributionPercentages[index];

                        // 在柱子顶部上方绘制百分比（稍小字体）
                        ctx.save();
                        ctx.font = '10px Arial';
                        ctx.fillText(
                            percentage,
                            element.x,
                            element.y - 5
                        );
                        ctx.restore();

                        // 在柱子内部顶部绘制人数（如果柱子高度足够，则在柱子内部顶部显示，否则显示在柱子外部）
                        if (data > 0) {
                            // 如果柱子高度大于20像素，则在柱子内部顶部（向下10像素）显示
                            const yPos = element.y + 12; // 在柱子内部，距离顶部12像素（大约一行字的高度）
                            ctx.font = '12px Arial';
                            ctx.fillText(
                                data,
                                element.x,
                                yPos
                            );
                        }
                    });
                }
            });
        }
    }]
});
                
                // 2. 分数段比例饼图
                const pieCtx = document.getElementById('pieChart').getContext('2d');
                pieChart = new Chart(pieCtx, {
                    type: 'doughnut',
                    data: {
                        labels: gradeDistribution.map(item => item[0]),
                        datasets: [{
                            data: gradeDistribution.map(item => item[1]),
                            backgroundColor: [
                                'rgba(75, 192, 192, 0.7)',
                                'rgba(153, 102, 255, 0.7)',
                                'rgba(255, 159, 64, 0.7)',
                                'rgba(255, 205, 86, 0.7)',
                                'rgba(255, 99, 132, 0.7)'
                            ],
                            borderColor: [
                                'rgba(75, 192, 192, 1)',
                                'rgba(153, 102, 255, 1)',
                                'rgba(255, 159, 64, 1)',
                                'rgba(255, 205, 86, 1)',
                                'rgba(255, 99, 132, 1)'
                            ],
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right'
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.raw;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = Math.round((value / total) * 100);
                                        return `${label}: ${value}人 (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
                
                // 3. 正态分布曲线
                const normalCtx = document.getElementById('normalChart').getContext('2d');
                normalChart = new Chart(normalCtx, {
                    type: 'line',
                    data: {
                        datasets: [{
                            label: '正态分布曲线',
                            data: normalCurve,
                            borderColor: 'rgba(255, 99, 132, 1)',
                            backgroundColor: 'rgba(255, 99, 132, 0.2)',
                            borderWidth: 3,
                            pointRadius: 0,
                            pointHoverRadius: 0,
                            fill: true,
                            tension: 0.1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    title: function(context) {
                                        return `分数: ${context[0].parsed.x.toFixed(1)}`;
                                    },
                                    label: function(context) {
                                        return `概率密度: ${context.parsed.y.toFixed(4)}`;
                                    }
                                }
                            },
                            legend: {
                                labels: {
                                    usePointStyle: true,
                                    pointStyle: 'line'
                                }
                            }
                        },
                        scales: {
                            x: {
                                type: 'linear',
                                min: 0,
                                max: 100,
                                title: {
                                    display: true,
                                    text: '分数'
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: '概率密度(×100)'
                                }
                            }
                        }
                    }
                });
            }
        });