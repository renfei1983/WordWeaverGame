# WordWeaver 部署指南 (微信云托管)

本指南将帮助您将 WordWeaver 后端部署到微信云托管，并发布微信小游戏前端。

## 1. 后端部署 (微信云托管)

我们已经为您准备好了 Docker 部署所需的文件：`Dockerfile` 和 `container.config.json`。

### 步骤：
1. **登录控制台**：访问 [微信云托管控制台](https://cloud.weixin.qq.com/)。
2. **选择环境**：进入环境 `prod-9g8femu80d9d37f3`。
3. **新建服务**：
   - 服务名称建议：`flask-service` (这也是代码中默认配置的服务名)。
   - 如果您使用了其他名称，请修改 `minigame/game.js` 中的 `X-WX-SERVICE` 请求头。
4. **部署版本**：
   - 方式一：**代码库拉取**（推荐）。将 `backend` 文件夹推送到 GitHub/GitLab，然后在云托管中关联仓库。
   - 方式二：**本地代码上传**。将 `backend` 文件夹（**不包含** `venv` 或 `__pycache__`）压缩为 ZIP 包，在控制台点击“版本管理” -> “新建版本” -> “上传代码包”。
5. **环境变量**：
   - 在服务配置中，确保添加以下环境变量（如果需要）：
     - `SILICONFLOW_API_KEY`: 您的 AI API Key。
     - `WECHAT_APP_ID`: `wx13922e8b755b1ece`
     - `WECHAT_APP_SECRET`: (您的 AppSecret)

### 注意事项：
- 我们已将后端端口配置为监听云托管注入的 `PORT` 环境变量（默认 80）。
- 数据库目前使用 SQLite (`database.db`)。**注意**：云托管容器重启后 SQLite 数据会丢失。建议后续在云托管控制台购买 MySQL 数据库，并修改 `backend/db.py` 连接字符串。

## 2. 小游戏前端发布

我们已将小游戏配置为使用**微信云调用 (Cloud Call)**，无需域名校验，更安全稳定。

### 自动上传（需要 IP 白名单）：
我们在 `backend/upload_minigame.js` 提供了自动上传脚本，但需要您在微信后台将当前开发机 IP 加入白名单。
如果遇到 `invalid ip` 错误，请登录微信公众平台 -> 开发 -> 开发设置 -> 小程序代码上传 -> IP 白名单，添加报错信息中的 IP。

### 手动上传（推荐）：
1. 打开 **微信开发者工具**。
2. 导入项目目录：`WordWeaverGame/minigame`。
3. 确保 `appid` 为 `wx13922e8b755b1ece`。
4. 在工具栏点击 **“上传”**。
5. 版本号建议：`1.0.0`，备注：`Initial Cloud Deploy`。

## 3. 验证

1. 打开小游戏（开发者工具或真机预览）。
2. 点击“英语世界”。
3. 如果显示“登录成功”，则说明后端连接正常。
4. 点击“开始学习”或触发学习记录，查看控制台是否输出“记录已同步(云端)”。

## 文件变更说明
- `backend/Dockerfile`: 新增，用于容器化部署。
- `backend/main.py`: 修改，支持云托管 `x-wx-openid` 头部鉴权。
- `minigame/game.js`: 修改，使用 `wx.cloud.callContainer` 替代 HTTP 请求。
