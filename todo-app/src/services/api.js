import axios from 'axios'

const API_BASE_URL = 'http://localhost:3000/api/todo'

// 创建基础axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
})

// 请求拦截器 - 添加授权头
apiClient.interceptors.request.use(
  config => {
    const token = localStorage.getItem('msft_access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理授权问题
apiClient.interceptors.response.use(
  response => {
    // 如果API在响应头中提供了新的访问令牌，保存它
    const newToken = response.headers['x-access-token']
    if (newToken) {
      localStorage.setItem('msft_access_token', newToken)
      console.log('已更新访问令牌')
    }
    return response
  },
  error => {
    if (error.response && error.response.status === 401) {
      console.log('认证失败，需要重新登录')
      localStorage.removeItem('msft_access_token')
      // 重定向到登录页
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const todoApi = {
  // 认证相关
  auth: {
    // 检查认证状态
    checkAuth: async () => {
      try {
        const response = await apiClient.get('/lists')
        return { authenticated: true }
      } catch (error) {
        return { authenticated: false, error }
      }
    },
    
    // 开始设备码认证流程
    startDeviceCodeAuth: async () => {
      const response = await apiClient.post('/auth/device-code')
      return response.data
    },
    
    // 检查设备码认证状态
    checkDeviceCodeStatus: async (code) => {
      const response = await apiClient.get(`/auth/status?code=${code}`)
      return response.data
    },
    
    // 登出 - 清除本地令牌
    logout: () => {
      localStorage.removeItem('msft_access_token')
    }
  },
  
  // 列表相关
  lists: {
    // 获取所有列表
    getLists: async () => {
      const response = await apiClient.get('/lists')
      return response.data
    },
    
    // 根据ID获取特定列表
    getList: async (listId) => {
      const response = await apiClient.get(`/lists/${listId}`)
      return response.data
    },
    
    // 根据名称获取列表
    getListByName: async (listName) => {
      const response = await apiClient.get(`/lists/byName/${encodeURIComponent(listName)}`)
      return response.data
    },
    
    // 创建列表
    createList: async (displayName) => {
      const response = await apiClient.post('/lists', { displayName })
      return response.data
    }
  },
  
  // 任务相关
  tasks: {
    // 获取列表中的所有任务
    getTasks: async (listId) => {
      // 已经添加了$expand=checklistItems参数以确保API返回子任务数据
      // 服务器端已实现分页处理，会返回所有任务
      const response = await apiClient.get(`/lists/${listId}/tasks?$expand=checklistItems`)
      return response.data
    },
    
    // 获取特定任务
    getTask: async (listId, taskId) => {
      const response = await apiClient.get(`/lists/${listId}/tasks/${taskId}?$expand=checklistItems`)
      return response.data
    },
    
    // 创建任务
    createTask: async (listId, task) => {
      const response = await apiClient.post(`/lists/${listId}/tasks`, task)
      return response.data
    },
    
    // 更新任务
    updateTask: async (listId, taskId, task) => {
      const response = await apiClient.patch(`/lists/${listId}/tasks/${taskId}`, task)
      return response.data
    },
    
    // 完成任务
    completeTask: async (listId, taskId) => {
      return await todoApi.tasks.updateTask(listId, taskId, {
        status: 'completed'
      })
    },
    
    // 取消完成任务
    uncompleteTask: async (listId, taskId) => {
      return await todoApi.tasks.updateTask(listId, taskId, {
        status: 'notStarted'
      })
    },
    
    // 获取任务增量更新
    getTasksDelta: async (listId, deltaLink = '') => {
      const endpoint = `/lists/${listId}/tasks/delta${deltaLink ? `?deltaLink=${encodeURIComponent(deltaLink)}` : ''}`
      const response = await apiClient.get(endpoint)
      return response.data
    },
    
    // 添加子任务
    addChecklistItem: async (listId, taskId, title) => {
      const response = await apiClient.post(`/lists/${listId}/tasks/${taskId}/checklistItems`, { title })
      return response.data
    },
    
    // 更新子任务
    updateChecklistItem: async (listId, taskId, checklistItemId, data) => {
      // 字段映射 - 确保使用正确的API字段名称
      const apiData = { ...data };
      if ('isCompleted' in apiData) {
        apiData.isChecked = apiData.isCompleted;
        delete apiData.isCompleted;
      }
      if ('title' in apiData) {
        apiData.displayName = apiData.title;
        delete apiData.title;
      }
      
      const response = await apiClient.patch(
        `/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`, 
        apiData
      )
      return response.data
    },
    
    // 完成子任务
    completeChecklistItem: async (listId, taskId, checklistItemId) => {
      return await todoApi.tasks.updateChecklistItem(listId, taskId, checklistItemId, {
        isChecked: true
      })
    },
    
    // 取消完成子任务
    uncompleteChecklistItem: async (listId, taskId, checklistItemId) => {
      return await todoApi.tasks.updateChecklistItem(listId, taskId, checklistItemId, {
        isChecked: false
      })
    },
    
    // 删除子任务
    deleteChecklistItem: async (listId, taskId, checklistItemId) => {
      const response = await apiClient.delete(`/lists/${listId}/tasks/${taskId}/checklistItems/${checklistItemId}`)
      return response.data
    }
  }
}

export default todoApi 