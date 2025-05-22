const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const msal = require('@azure/msal-node');

// 模拟Obsidian App对象
const mockApp = {
  vault: {
    adapter: {
      exists: async (path) => {
        return fs.existsSync(path);
      },
      read: async (path) => {
        return fs.readFileSync(path, 'utf8');
      },
      write: async (filepath, data) => {
        // 修复: 使用Node.js path模块的dirname函数
        const dirPath = path.dirname(filepath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        return fs.writeFileSync(filepath, data);
      }
    },
    configDir: path.join(__dirname, '../.cache')
  }
};

// 简化版的MicrosoftClientProvider
class MicrosoftClientProvider {
  constructor(app) {
    this.app = app;
    this.tokenCachePath = path.join(app.vault.configDir, 'Microsoft_cache.json');
    
    // 创建缓存目录
    const cacheDir = path.dirname(this.tokenCachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Microsoft应用配置 - 与 microsoftClientProvider.ts 保持一致
    this.config = {
      auth: {
        clientId: "a1172059-5f55-45cd-9665-8dccc98c2587", // 必须与 microsoftClientProvider.ts 中一致
        authority: "https://login.microsoftonline.com/consumers" // 必须与 microsoftClientProvider.ts 中一致
      }
    };
    
    this.createPublicClientApplication();
  }
  
  createPublicClientApplication() {
    // 创建MSAL实例
    const cachePlugin = {
      beforeCacheAccess: async (cacheContext) => {
        try {
          if (await this.app.vault.adapter.exists(this.tokenCachePath)) {
            const data = await this.app.vault.adapter.read(this.tokenCachePath);
            cacheContext.tokenCache.deserialize(data);
          }
        } catch (error) {
          console.error("令牌缓存读取错误:", error);
        }
      },
      afterCacheAccess: async (cacheContext) => {
        try {
          if (cacheContext.cacheHasChanged) {
            await this.app.vault.adapter.write(this.tokenCachePath, cacheContext.tokenCache.serialize());
          }
        } catch (error) {
          console.error("令牌缓存写入错误:", error);
        }
      }
    };
    
    this.pca = new msal.PublicClientApplication({
      auth: this.config.auth,
      cache: { cachePlugin }
    });
  }
  
  async getAccessToken() {
    const accounts = await this.pca.getTokenCache().getAllAccounts();
    
    if (accounts.length > 0) {
      const silentRequest = {
        account: accounts[0],
        scopes: ["Tasks.ReadWrite"]
      };
      
      try {
        const response = await this.pca.acquireTokenSilent(silentRequest);
        return response.accessToken;
      } catch (error) {
        console.log("无法静默获取令牌，尝试交互式登录");
        throw error; // 让调用者处理重新认证
      }
    } else {
      throw new Error("未找到已认证账户");
    }
  }
}

// 简化版的TodoAPI
class TodoApi {
  constructor(clientProvider) {
    this.clientProvider = clientProvider;
  }
  
  async getLists() {
    return [
      { id: "demo-list-1", displayName: "演示列表1" },
      { id: "demo-list-2", displayName: "演示列表2" }
    ];
  }
  
  async createTaskList(displayName) {
    return { id: "new-list-" + Date.now(), displayName };
  }
}

// 创建Microsoft客户端提供者实例
const clientProvider = new MicrosoftClientProvider(mockApp);

// 创建TodoApi实例
const todoApi = new TodoApi(clientProvider);

// 存储设备代码会话
const deviceCodeSessions = new Map();

// 设备代码认证路由
router.post('/auth/device-code', async (req, res) => {
  try {
    console.log('开始设备代码认证流程');
    
    // 尝试使用备用方法获取令牌
    try {
      // 检查现有缓存账户
      const accounts = await clientProvider.pca.getTokenCache().getAllAccounts();
      console.log(`找到 ${accounts.length} 个缓存账户`);
      
      if (accounts.length > 0) {
        // 有缓存的账户，尝试使用静默获取令牌
        const silentRequest = {
          account: accounts[0],
          scopes: ['Tasks.ReadWrite', 'openid', 'profile']
        };
        
        console.log('尝试使用静默认证获取令牌...');
        const tokenResponse = await clientProvider.pca.acquireTokenSilent(silentRequest);
        
        if (tokenResponse && tokenResponse.accessToken) {
          console.log('成功通过缓存获取令牌');
          // 直接返回令牌
          return res.json({
            accessToken: tokenResponse.accessToken,
            userComplete: true
          });
        }
      }
    } catch (silentError) {
      console.log('静默认证失败，将尝试交互式方法:', silentError.message);
    }
    
    // 如果静默获取失败，尝试使用账户名密码流程（仅在支持的情况下）
    try {
      console.log('尝试使用公共客户端流程...');
      const tokenResponse = await clientProvider.getAccessToken();
      
      if (tokenResponse) {
        console.log('成功获取访问令牌');
        return res.json({
          accessToken: tokenResponse,
          userComplete: true
        });
      }
    } catch (pubClientError) {
      console.log('公共客户端流程失败，将回退到标准设备代码流程:', pubClientError.message);
    }
    
    // 创建设备代码请求（作为最后的备选方案）
    const deviceCodeRequest = {
      scopes: ['Tasks.ReadWrite', 'openid', 'profile'],
      deviceCodeCallback: (response) => {
        console.log('设备代码回调收到响应:', JSON.stringify(response, null, 2));
        
        // 创建或更新会话
        if (response && response.userCode) {
          deviceCodeSessions.set(response.userCode, {
            deviceCode: response.deviceCode,
            verificationUrl: response.verificationUri,
            expiresAt: Date.now() + (response.expiresIn * 1000),
            completed: false,
            accessToken: null
          });
        }
        
        return Promise.resolve();
      }
    };
    
    // 使用标准方法启动设备代码流程
    const deviceCodeFlowPromise = clientProvider.pca.acquireTokenByDeviceCode(deviceCodeRequest);
    
    // 获取设备代码信息从会话中（通过回调设置）
    let userCode = null;
    let maxTries = 10;
    while (maxTries > 0) {
      // 等待短暂时间让回调执行
      await new Promise(r => setTimeout(r, 300));
      
      // 查找会话
      for (const [code, session] of deviceCodeSessions.entries()) {
        if (!session.completed && session.deviceCode) {
          userCode = code;
          break;
        }
      }
      
      if (userCode) break;
      maxTries--;
    }
    
    if (!userCode) {
      throw new Error('无法获取设备代码');
    }
    
    const session = deviceCodeSessions.get(userCode);
    
    // 返回设备代码信息
    res.json({
      userCode: userCode,
      verificationUrl: session.verificationUrl,
      expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000),
      interval: 5
    });
    
    // 设备代码流程完成后，更新会话
    deviceCodeFlowPromise.then(result => {
      if (result && result.accessToken) {
        console.log(`获取到访问令牌，长度: ${result.accessToken.length}`);
        
        const session = deviceCodeSessions.get(userCode);
        if (session) {
          session.accessToken = result.accessToken;
          session.completed = true;
          deviceCodeSessions.set(userCode, session);
          console.log(`令牌已成功存储到会话: ${userCode}`);
        }
      }
    }).catch(error => {
      console.error('设备代码流程出错:', error);
    });
    
  } catch (error) {
    console.error('获取设备代码失败:', error);
    res.status(500).json({
      message: '获取设备代码失败',
      error: error.message
    });
  }
});

// 检查认证状态
router.get('/auth/status', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ message: '缺少必要的代码参数' });
  }
  
  console.log(`检查认证状态: code=${code}, 当前会话数量: ${deviceCodeSessions.size}`);
  console.log(`所有会话: ${Array.from(deviceCodeSessions.keys()).join(', ')}`);
  
  const session = deviceCodeSessions.get(code);
  
  if (!session) {
    console.log(`未找到会话: ${code}`);
    return res.status(400).json({ message: '无效的认证会话' });
  }
  
  console.log(`会话状态: completed=${session.completed}, hasToken=${!!session.accessToken}`);
  
  // 检查会话是否过期
  if (session.expiresAt < Date.now()) {
    deviceCodeSessions.delete(code);
    return res.status(400).json({ message: '认证会话已过期' });
  }
  
  // 检查是否已完成认证
  if (session.completed && session.accessToken) {
    // 返回访问令牌
    res.json({ accessToken: session.accessToken });
    
    // 认证成功后删除会话
    setTimeout(() => {
      deviceCodeSessions.delete(code);
    }, 30 * 1000); // 给前端30秒的缓冲时间
  } else {
    // 仍在等待用户授权
    res.status(202).json({ status: 'pending' });
  }
});

// 认证中间件
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    try {
      // 如果没有提供令牌，尝试获取新令牌
      const accessToken = await clientProvider.getAccessToken();
      // 设置令牌到请求对象
      req.accessToken = accessToken;
      next();
    } catch (error) {
      console.error('认证失败:', error);
      res.status(401).json({ 
        message: '认证失败', 
        error: error.message,
        loginUrl: '/auth'
      });
    }
  } else {
    // 如果提供了令牌，使用该令牌
    req.accessToken = token;
    next();
  }
};

// 调试路由 - 显示系统状态
router.get('/debug/status', async (req, res) => {
  try {
    // 收集系统状态
    const accounts = await clientProvider.pca.getTokenCache().getAllAccounts();
    const sessionInfo = Array.from(deviceCodeSessions.entries())
      .map(([key, session]) => ({
        userCode: key,
        expiresAt: new Date(session.expiresAt).toISOString(),
        completed: session.completed,
        hasToken: !!session.accessToken,
      }));
    
    const cacheFilePath = clientProvider.tokenCachePath;
    let cacheFileExists = false;
    let cacheContent = null;
    
    try {
      cacheFileExists = await mockApp.vault.adapter.exists(cacheFilePath);
      if (cacheFileExists) {
        const rawCache = await mockApp.vault.adapter.read(cacheFilePath);
        try {
          // 尝试解析但不返回敏感信息
          const parsed = JSON.parse(rawCache);
          cacheContent = {
            hasAccounts: !!parsed.Account,
            hasRefreshTokens: !!parsed.RefreshToken,
            hasAccessTokens: !!parsed.AccessToken,
            accountCount: parsed.Account ? Object.keys(parsed.Account).length : 0,
          };
        } catch (e) {
          cacheContent = { error: 'Cache file exists but cannot be parsed' };
        }
      }
    } catch (e) {
      console.error('读取缓存文件出错:', e);
    }
    
    res.json({
      accounts: accounts.map(acc => ({
        username: acc.username,
        homeAccountId: acc.homeAccountId,
        environment: acc.environment,
        tenantId: acc.tenantId,
        localAccountId: acc.localAccountId
      })),
      sessions: sessionInfo,
      cache: {
        path: cacheFilePath,
        exists: cacheFileExists,
        content: cacheContent
      },
      currentConfiguration: {
        clientId: clientProvider.config.auth.clientId,
        authority: clientProvider.config.auth.authority
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 强制使用直接令牌 - 仅供调试使用
router.get('/debug/force-token', async (req, res) => {
  try {
    // 创建模拟令牌以跳过认证
    const mockToken = Buffer.from(JSON.stringify({
      alg: "none",
      typ: "JWT"
    }) + "." + JSON.stringify({
      name: "Test User",
      preferred_username: "testuser@example.com",
      oid: "12345678-1234-5678-abcd-123456789012", 
      sub: "12345678-1234-5678-abcd-123456789012",
      iss: "https://login.microsoftonline.com/consumers/v2.0",
      aud: clientProvider.config.auth.clientId,
      exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1小时后过期
      iat: Math.floor(Date.now() / 1000)
    }) + ".").toString('base64');
    
    res.json({ accessToken: mockToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 认证路由
router.get('/auth/login', async (req, res) => {
  try {
    const accessToken = await clientProvider.getAccessToken();
    res.json({ accessToken });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(401).json({ message: '登录失败', error: error.message });
  }
});

// 应用认证中间件到所有路由
router.use(authMiddleware);

// 获取所有任务列表
router.get('/lists', async (req, res) => {
  try {
    const lists = await todoApi.getLists();
    
    // 如果有访问令牌，添加到响应头
    if (req.accessToken) {
      res.setHeader('X-Access-Token', req.accessToken);
    }
    
    res.json(lists);
  } catch (error) {
    console.error('获取任务列表失败:', error);
    res.status(500).json({ message: '获取任务列表失败', error: error.message });
  }
});

// 通过名称获取列表ID
router.get('/lists/byName/:listName', async (req, res) => {
  try {
    res.json({ id: "demo-list-1" });
  } catch (error) {
    console.error('通过名称获取列表ID失败:', error);
    res.status(500).json({ message: '通过名称获取列表ID失败', error: error.message });
  }
});

// 获取特定任务列表
router.get('/lists/:listId', async (req, res) => {
  try {
    res.json({ id: req.params.listId, displayName: "演示列表 " + req.params.listId });
  } catch (error) {
    console.error('获取任务列表失败:', error);
    res.status(500).json({ message: '获取任务列表失败', error: error.message });
  }
});

// 创建任务列表
router.post('/lists', async (req, res) => {
  try {
    const { displayName } = req.body;
    const newList = await todoApi.createTaskList(displayName);
    res.status(201).json(newList);
  } catch (error) {
    console.error('创建任务列表失败:', error);
    res.status(500).json({ message: '创建任务列表失败', error: error.message });
  }
});

// 获取列表中的任务
router.get('/lists/:listId/tasks', async (req, res) => {
  try {
    res.json([
      { id: "task-1", title: "演示任务1", status: "notStarted" },
      { id: "task-2", title: "演示任务2", status: "completed" }
    ]);
  } catch (error) {
    console.error('获取任务失败:', error);
    res.status(500).json({ message: '获取任务失败', error: error.message });
  }
});

// 获取特定任务
router.get('/lists/:listId/tasks/:taskId', async (req, res) => {
  try {
    const task = await todoApi.getTask(req.params.listId, req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: '未找到任务' });
    }
    res.json(task);
  } catch (error) {
    console.error('获取任务失败:', error);
    res.status(500).json({ message: '获取任务失败', error: error.message });
  }
});

// 创建任务
router.post('/lists/:listId/tasks', async (req, res) => {
  try {
    const newTask = await todoApi.createTaskFromToDo(req.params.listId, req.body);
    res.status(201).json(newTask);
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({ message: '创建任务失败', error: error.message });
  }
});

// 更新任务
router.patch('/lists/:listId/tasks/:taskId', async (req, res) => {
  try {
    const updatedTask = await todoApi.updateTaskFromToDo(req.params.listId, req.params.taskId, req.body);
    res.json(updatedTask);
  } catch (error) {
    console.error('更新任务失败:', error);
    res.status(500).json({ message: '更新任务失败', error: error.message });
  }
});

// 获取任务增量更新
router.get('/lists/:listId/tasks/delta', async (req, res) => {
  try {
    const deltaCollection = await todoApi.getTasksDelta(req.params.listId, req.query.deltaLink || '');
    res.json(deltaCollection);
  } catch (error) {
    console.error('获取任务增量更新失败:', error);
    res.status(500).json({ message: '获取任务增量更新失败', error: error.message });
  }
});

// 创建链接资源
router.post('/lists/:listId/tasks/:taskId/linkedResources', async (req, res) => {
  try {
    const { webUrl, externalId } = req.body;
    await todoApi.createLinkedResource(req.params.listId, req.params.taskId, externalId, webUrl);
    res.status(201).json({ message: '链接资源创建成功' });
  } catch (error) {
    console.error('创建链接资源失败:', error);
    res.status(500).json({ message: '创建链接资源失败', error: error.message });
  }
});

// 更新链接资源
router.put('/lists/:listId/tasks/:taskId/linkedResources/:linkedResourceId', async (req, res) => {
  try {
    const { webUrl, externalId } = req.body;
    await todoApi.updateLinkedResource(
      req.params.listId,
      req.params.taskId,
      req.params.linkedResourceId,
      externalId,
      webUrl
    );
    res.json({ message: '链接资源更新成功' });
  } catch (error) {
    console.error('更新链接资源失败:', error);
    res.status(500).json({ message: '更新链接资源失败', error: error.message });
  }
});

module.exports = router; 