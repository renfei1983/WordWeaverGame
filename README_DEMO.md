# 自主化AI学习 Demo (Mac版)

## 简介
这是一个集成了 WordWeaver (单词织梦者) 和 MathSense (数感进化) 的统一演示版本。

## 目录结构
- `portal`: 统一入口 (Port 3000)
- `frontend`: WordWeaver 前端 (Port 13900)
- `backend`: WordWeaver 后端 (Port 8000)
- `MathSenseEvolution/frontend`: MathSense 前端 (Port 13911)
- `MathSenseEvolution/backend`: MathSense 后端 (Port 8011)

## 快速开始

1. **解压文件**
   确保你已经解压了 `AutonomousLearningDemo.zip`。

2. **运行启动脚本**
   在终端中进入解压后的目录，运行：
   ```bash
   bash run_demo_mac.sh
   ```
   
   脚本会自动：
   - 安装所有必要的依赖 (Node.js 和 Python)
   - 编译前端项目
   - 启动所有后端和前端服务
   - 提示你访问 http://localhost:3000

3. **停止服务**
   运行：
   ```bash
   bash stop_demo_mac.sh
   ```

## 注意事项
- 首次运行可能需要较长时间来安装依赖和编译。
- 如果遇到权限错误，脚本会尝试自动修复。
- 请确保已安装 Node.js 和 Python 3。
