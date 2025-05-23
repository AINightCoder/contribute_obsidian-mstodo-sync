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
    this.logger = console;
    this.retryOptions = { maxRetries: 3, delayMs: 3000 };
  }
  
  async getClient() {
    // 懒加载客户端，确保在需要时才获取
    if (!this._client) {
      try {
        // 获取Graph客户端
        const accessToken = await this.clientProvider.getAccessToken();
        this._client = this.createGraphClient(accessToken);
        this.logger.debug('Graph client created successfully');
      } catch (error) {
        this.logger.error('Failed to initialize Graph client:', error);
        throw new Error('无法初始化Microsoft客户端');
      }
    }
    return this._client;
  }
  
  // 创建Microsoft Graph客户端
  createGraphClient(accessToken) {
    // 由于我们使用的是Node.js环境，需要手动实现Graph客户端
    return {
      api: (endpoint) => {
        const apiBuilder = {
          endpoint,
          filterParam: '',
          middlewareOpts: [],
          
          // Builder模式方法
          filter(filterExpr) {
            this.filterParam = `$filter=${encodeURIComponent(filterExpr)}`;
            return this;
          },
          
          middlewareOptions(options) {
            this.middlewareOpts = options;
            return this;
          },
          
          // 执行HTTP请求
          async get() {
            try {
              const url = `https://graph.microsoft.com/v1.0${this.endpoint}${this.filterParam ? '?' + this.filterParam : ''}`;
              console.log(`Making Graph API request to: ${url}`);
              
              const response = await fetch(url, {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Accept': 'application/json'
                }
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Graph API error (${response.status}): ${errorText}`);
                throw new Error(`Graph API request failed: ${response.status}`);
              }
              
              return await response.json();
            } catch (error) {
              console.error('Graph API request error:', error);
              throw error;
            }
          },
          
          // POST方法实现
          async post(data) {
            try {
              const url = `https://graph.microsoft.com/v1.0${this.endpoint}`;
              console.log(`Making Graph API POST to: ${url}`);
              
              const response = await fetch(url, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify(data)
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Graph API error (${response.status}): ${errorText}`);
                throw new Error(`Graph API request failed: ${response.status}`);
              }
              
              return await response.json();
            } catch (error) {
              console.error('Graph API POST error:', error);
              throw error;
            }
          },
          
          // PATCH方法实现
          async patch(data) {
            try {
              const url = `https://graph.microsoft.com/v1.0${this.endpoint}`;
              console.log(`Making Graph API PATCH to: ${url}`);
              
              const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify(data)
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Graph API error (${response.status}): ${errorText}`);
                throw new Error(`Graph API request failed: ${response.status}`);
              }
              
              return await response.json();
            } catch (error) {
              console.error('Graph API PATCH error:', error);
              throw error;
            }
          },
          
          // Update方法（PATCH的别名）
          async update(data) {
            return this.patch(data);
          },
          
          // DELETE方法实现
          async delete() {
            try {
              const url = `https://graph.microsoft.com/v1.0${this.endpoint}`;
              console.log(`Making Graph API DELETE to: ${url}`);
              
              const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${accessToken}`
                }
              });
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`Graph API error (${response.status}): ${errorText}`);
                throw new Error(`Graph API request failed: ${response.status}`);
              }
              
              // DELETE请求通常返回204 No Content
              return response.status === 204 ? {} : await response.json();
            } catch (error) {
              console.error('Graph API DELETE error:', error);
              throw error;
            }
          }
        };
        
        return apiBuilder;
      }
    };
  }
  
  /**
   * 获取所有任务列表
   */
  async getLists() {
    try {
      const client = await this.getClient();
      const endpoint = '/me/todo/lists';
      const response = await client.api(endpoint).get();
      
      if (!response || !response.value) {
        return [];
      }
      
      return response.value;
    } catch (error) {
      this.logger.error('获取任务列表失败:', error);
      throw new Error('无法获取Microsoft To Do任务列表');
    }
  }
  
  /**
   * 根据名称获取列表ID
   */
  async getListIdByName(listName) {
    if (!listName) {
      return;
    }
    
    try {
      const client = await this.getClient();
      const endpoint = '/me/todo/lists';
      const response = await client.api(endpoint).filter(`contains(displayName,'${listName}')`).get();
      
      if (!response.value || response.value.length === 0) {
        return;
      }
      
      return response.value[0].id;
    } catch (error) {
      this.logger.error('根据名称获取列表ID失败:', error);
      throw new Error(`无法找到名为"${listName}"的列表`);
    }
  }
  
  /**
   * 获取特定任务列表
   */
  async getList(listId) {
    if (!listId) {
      return;
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}`;
      return await client.api(endpoint).get();
    } catch (error) {
      this.logger.error('获取任务列表失败:', error);
      throw new Error('无法获取指定的Microsoft To Do任务列表');
    }
  }
  
  /**
   * 创建任务列表
   */
  async createTaskList(displayName) {
    if (!displayName) {
      return;
    }
    
    try {
      const client = await this.getClient();
      return await client.api('/me/todo/lists').post({
        displayName
      });
    } catch (error) {
      this.logger.error('创建任务列表失败:', error);
      throw new Error('无法创建Microsoft To Do任务列表');
    }
  }
  
  /**
   * 获取列表中的任务
   */
  async getListTasks(listId, searchText) {
    if (!listId) {
      return;
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks`;
      
      let apiCall = client.api(endpoint);
      if (searchText) {
        apiCall = apiCall.filter(searchText);
      }
      
      // 添加$expand=checklistItems参数以确保API返回子任务数据
      // 避免重复添加参数，创建不带searchText的API调用
      const expandParam = "?$expand=checklistItems";
      const queryEndpoint = endpoint + expandParam;
      apiCall = client.api(queryEndpoint);
      if (searchText) {
        apiCall = apiCall.filter(searchText);
      }
      
      const allTasks = [];
      let response = await apiCall.get();
      
      // 处理所有分页结果
      while (response && response.value && response.value.length > 0) {
        allTasks.push(...response.value);
        
        // 处理分页
        if (response['@odata.nextLink']) {
          try {
            this.logger.debug(`获取下一页任务，已收集 ${allTasks.length} 个任务...`);
            
            // 判断nextLink是否是完整URL
            const nextLink = response['@odata.nextLink'];
            this.logger.debug(`下一页链接: ${nextLink}`);
            
            if (nextLink.startsWith('https://')) {
              // 如果是完整URL，使用特殊方法直接请求
              const nextResponse = await fetch(nextLink, {
                headers: {
                  'Authorization': `Bearer ${await this.clientProvider.getAccessToken()}`,
                  'Accept': 'application/json'
                }
              });
              
              if (!nextResponse.ok) {
                const errorText = await nextResponse.text();
                this.logger.error(`下一页请求失败 (${nextResponse.status}): ${errorText}`);
                break;
              }
              
              response = await nextResponse.json();
            } else {
              // 如果只是相对路径，使用Graph客户端
              response = await client.api(nextLink).get();
            }
          } catch (paginationError) {
            this.logger.error(`获取下一页失败:`, paginationError);
            break; // 停止分页，返回已获取的任务
          }
        } else {
          break;
        }
      }
      
      this.logger.info(`从Microsoft To Do获取了${allTasks.length}个任务`);
      return allTasks;
    } catch (error) {
      this.logger.error('获取任务失败:', error);
      throw new Error('无法获取Microsoft To Do任务');
    }
  }
  
  /**
   * 获取特定任务
   */
  async getTask(listId, taskId) {
    if (!listId || !taskId) {
      return;
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}`;
      return await client.api(endpoint).get();
    } catch (error) {
      this.logger.error('获取任务失败:', error);
      throw new Error('无法获取指定的Microsoft To Do任务');
    }
  }
  
  /**
   * 获取任务增量更新
   */
  async getTasksDelta(listId, deltaLink) {
    if (!listId) {
      this.logger.error('获取任务增量更新失败: 缺少listId');
      throw new Error('获取任务增量更新需要有效的列表ID');
    }
    
    try {
      const client = await this.getClient();
      
      let endpoint;
      if (!deltaLink || deltaLink === '') {
        endpoint = `/me/todo/lists/${listId}/tasks/delta`;
        this.logger.debug(`使用初始delta端点: ${endpoint}`);
      } else {
        endpoint = deltaLink;
        this.logger.debug(`使用deltaLink: ${endpoint}`);
      }
      
      const allTasks = [];
      
      let response = await client.api(endpoint).get();
      
      // 处理所有分页结果
      while (response && response.value && response.value.length > 0) {
        allTasks.push(...response.value);
        
        // 处理分页
        if (response['@odata.nextLink']) {
          this.logger.debug(`获取下一页结果...`);
          response = await client.api(response['@odata.nextLink']).get();
        } else {
          break;
        }
      }
      
      // 获取新的deltaLink
      const newDeltaLink = response['@odata.deltaLink'] || '';
      
      this.logger.info(`从Microsoft To Do获取了${allTasks.length}个任务`);
      return {
        allTasks,
        deltaLink: newDeltaLink,
        listId,
        name: '' 
      };
    } catch (error) {
      this.logger.error('获取任务增量更新失败:', error);
      // 返回空集合
      return {
        allTasks: [],
        deltaLink: '',
        listId,
        name: ''
      };
    }
  }
  
  /**
   * 根据待办事项创建任务
   */
  async createTaskFromToDo(listId, toDo) {
    if (!listId) {
      throw new Error('创建任务需要有效的列表ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks`;
      return await client.api(endpoint).post(toDo);
    } catch (error) {
      this.logger.error('创建任务失败:', error);
      throw new Error('无法创建Microsoft To Do任务');
    }
  }
  
  /**
   * 更新任务
   */
  async updateTaskFromToDo(listId, taskId, toDo) {
    if (!listId || !taskId) {
      throw new Error('更新任务需要有效的列表ID和任务ID');
    }
    
    try {
      // 删除linkedResources属性，因为它不能通过PATCH更新
      const todoWithoutLinkedResources = { ...toDo };
      delete todoWithoutLinkedResources.linkedResources;
      
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}`;
      return await client.api(endpoint).patch(todoWithoutLinkedResources);
    } catch (error) {
      this.logger.error('更新任务失败:', error);
      throw new Error('无法更新Microsoft To Do任务');
    }
  }
  
  /**
   * 获取任务的子任务
   */
  async getChecklistItems(listId, taskId) {
    if (!listId || !taskId) {
      throw new Error('获取子任务需要有效的列表ID和任务ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;
      const response = await client.api(endpoint).get();
      return response.value;
    } catch (error) {
      this.logger.error('获取子任务失败:', error);
      throw new Error('无法获取Microsoft To Do子任务');
    }
  }
  
  /**
   * 添加子任务
   */
  async addChecklistItem(listId, taskId, title) {
    if (!listId || !taskId) {
      throw new Error('添加子任务需要有效的列表ID和任务ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`;
      return await client.api(endpoint).post({ displayName: title });
    } catch (error) {
      this.logger.error('添加子任务失败:', error);
      throw new Error('无法添加Microsoft To Do子任务');
    }
  }
  
  /**
   * 更新子任务
   */
  async updateChecklistItem(listId, taskId, checklistItemId, data) {
    if (!listId || !taskId || !checklistItemId) {
      throw new Error('更新子任务需要有效的列表ID、任务ID和子任务ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`;
      return await client.api(endpoint).patch(data);
    } catch (error) {
      this.logger.error('更新子任务失败:', error);
      throw new Error('无法更新Microsoft To Do子任务');
    }
  }
  
  /**
   * 删除子任务
   */
  async deleteChecklistItem(listId, taskId, checklistItemId) {
    if (!listId || !taskId || !checklistItemId) {
      throw new Error('删除子任务需要有效的列表ID、任务ID和子任务ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`;
      await client.api(endpoint).delete();
      return { success: true };
    } catch (error) {
      this.logger.error('删除子任务失败:', error);
      throw new Error('无法删除Microsoft To Do子任务');
    }
  }
  
  /**
   * 创建链接资源
   */
  async createLinkedResource(listId, taskId, blockId, webUrl) {
    if (!listId || !taskId) {
      throw new Error('创建链接资源需要有效的列表ID和任务ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/linkedResources`;
      
      const linkedResource = {
        webUrl,
        applicationName: 'Obsidian Microsoft To Do Sync',
        externalId: blockId,
        displayName: `Tracking Block Link: ${blockId}`
      };
      
      return await client.api(endpoint).post(linkedResource);
    } catch (error) {
      this.logger.error('创建链接资源失败:', error);
      throw new Error('无法创建Microsoft To Do链接资源');
    }
  }
  
  /**
   * 更新链接资源
   */
  async updateLinkedResource(listId, taskId, linkedResourceId, blockId, webUrl) {
    if (!listId || !taskId || !linkedResourceId) {
      throw new Error('更新链接资源需要有效的列表ID、任务ID和资源ID');
    }
    
    try {
      const client = await this.getClient();
      const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}/linkedResources/${linkedResourceId}`;
      
      const linkedResource = {
        webUrl,
        applicationName: 'Obsidian Microsoft To Do Sync',
        externalId: blockId,
        displayName: `Tracking Block Link: ${blockId}`
      };
      
      return await client.api(endpoint).update(linkedResource);
    } catch (error) {
      this.logger.error('更新链接资源失败:', error);
      throw new Error('无法更新Microsoft To Do链接资源');
    }
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
    const listName = req.params.listName;
    const listId = await todoApi.getListIdByName(listName);
    
    if (!listId) {
      return res.status(404).json({ message: `未找到名为"${listName}"的列表` });
    }
    
    res.json({ id: listId });
  } catch (error) {
    console.error('通过名称获取列表ID失败:', error);
    res.status(500).json({ message: '通过名称获取列表ID失败', error: error.message });
  }
});

// 获取特定任务列表
router.get('/lists/:listId', async (req, res) => {
  try {
    const list = await todoApi.getList(req.params.listId);
    
    if (!list) {
      return res.status(404).json({ message: '未找到任务列表' });
    }
    
    res.json(list);
  } catch (error) {
    console.error('获取任务列表失败:', error);
    res.status(500).json({ message: '获取任务列表失败', error: error.message });
  }
});

// 创建任务列表
router.post('/lists', async (req, res) => {
  try {
    const { displayName } = req.body;
    
    if (!displayName) {
      return res.status(400).json({ message: '创建任务列表需要displayName参数' });
    }
    
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
    const { listId } = req.params;
    const { filter } = req.query;
    
    const tasks = await todoApi.getListTasks(listId, filter);
    
    if (!tasks) {
      return res.json([]);
    }
    
    res.json(tasks);
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
    const { listId } = req.params;
    const taskData = req.body;
    
    // 确保必要的任务属性
    if (!taskData.title) {
      return res.status(400).json({ message: '任务必须包含title字段' });
    }
    
    const newTask = await todoApi.createTaskFromToDo(listId, taskData);
    res.status(201).json(newTask);
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({ message: '创建任务失败', error: error.message });
  }
});

// 更新任务
router.patch('/lists/:listId/tasks/:taskId', async (req, res) => {
  try {
    const { listId, taskId } = req.params;
    const taskData = req.body;
    
    const updatedTask = await todoApi.updateTaskFromToDo(listId, taskId, taskData);
    res.json(updatedTask);
  } catch (error) {
    console.error('更新任务失败:', error);
    res.status(500).json({ message: '更新任务失败', error: error.message });
  }
});

// 获取任务增量更新
router.get('/lists/:listId/tasks/delta', async (req, res) => {
  try {
    const { listId } = req.params;
    const { deltaLink } = req.query;
    
    const deltaCollection = await todoApi.getTasksDelta(listId, deltaLink || '');
    res.json(deltaCollection);
  } catch (error) {
    console.error('获取任务增量更新失败:', error);
    res.status(500).json({ message: '获取任务增量更新失败', error: error.message });
  }
});

// 获取任务的子任务
router.get('/lists/:listId/tasks/:taskId/checklistItems', authMiddleware, async (req, res) => {
  try {
    const { listId, taskId } = req.params;
    const items = await todoApi.getChecklistItems(listId, taskId);
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 添加子任务
router.post('/lists/:listId/tasks/:taskId/checklistItems', authMiddleware, async (req, res) => {
  try {
    const { listId, taskId } = req.params;
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({ message: '子任务标题不能为空' });
    }
    
    const newItem = await todoApi.addChecklistItem(listId, taskId, title);
    res.status(201).json(newItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 更新子任务
router.patch('/lists/:listId/tasks/:taskId/checklistItems/:checklistItemId', authMiddleware, async (req, res) => {
  try {
    const { listId, taskId, checklistItemId } = req.params;
    const data = req.body;
    
    const updatedItem = await todoApi.updateChecklistItem(listId, taskId, checklistItemId, data);
    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 删除子任务
router.delete('/lists/:listId/tasks/:taskId/checklistItems/:checklistItemId', authMiddleware, async (req, res) => {
  try {
    const { listId, taskId, checklistItemId } = req.params;
    
    await todoApi.deleteChecklistItem(listId, taskId, checklistItemId);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 创建链接资源
router.post('/lists/:listId/tasks/:taskId/linkedResources', async (req, res) => {
  try {
    const { listId, taskId } = req.params;
    const { webUrl, externalId } = req.body;
    
    if (!webUrl || !externalId) {
      return res.status(400).json({ message: '创建链接资源需要webUrl和externalId字段' });
    }
    
    const linkedResource = await todoApi.createLinkedResource(listId, taskId, externalId, webUrl);
    res.status(201).json(linkedResource);
  } catch (error) {
    console.error('创建链接资源失败:', error);
    res.status(500).json({ message: '创建链接资源失败', error: error.message });
  }
});

// 更新链接资源
router.put('/lists/:listId/tasks/:taskId/linkedResources/:linkedResourceId', async (req, res) => {
  try {
    const { listId, taskId, linkedResourceId } = req.params;
    const { webUrl, externalId } = req.body;
    
    if (!webUrl || !externalId) {
      return res.status(400).json({ message: '更新链接资源需要webUrl和externalId字段' });
    }
    
    const updatedResource = await todoApi.updateLinkedResource(
      listId,
      taskId,
      linkedResourceId,
      externalId,
      webUrl
    );
    res.json(updatedResource);
  } catch (error) {
    console.error('更新链接资源失败:', error);
    res.status(500).json({ message: '更新链接资源失败', error: error.message });
  }
});

module.exports = router; 