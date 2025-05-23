<template>
  <div class="auth-container apple-card">
    <h1 class="apple-heading text-center text-2xl mb-8">Microsoft Todo 登录</h1>
    
    <div class="auth-steps">
      <!-- 步骤 1: 开始认证 -->
      <div class="auth-step" :class="{ active: currentStep === 1 }">
        <div class="step-header">
          <div class="step-number">1</div>
          <div class="step-title">开始认证流程</div>
        </div>
        <div class="step-content">
          <p class="mb-4">点击下方按钮开始Microsoft账号认证流程，授权访问您的Todo数据。</p>
          <button @click="startAuth" class="apple-button w-full" :disabled="isLoading">
            {{ isLoading ? '正在加载...' : '开始认证' }}
          </button>
        </div>
      </div>
      
      <!-- 步骤 2: 输入验证码 -->
      <div class="auth-step" :class="{ active: currentStep === 2 }">
        <div class="step-header">
          <div class="step-number">2</div>
          <div class="step-title">输入验证码</div>
        </div>
        <div class="step-content">
          <p class="mb-2">请在Microsoft验证页面中输入以下代码：</p>
          <div class="device-code">{{ userCode || '等待中...' }}</div>
          <div class="text-center mt-2">
            <button @click="copyCode" class="apple-button secondary text-sm">
              复制代码
            </button>
          </div>
          <div class="code-timer text-sm text-center mt-2" v-if="expiresIn">
            代码有效时间: {{ formatTime(timeLeft) }}
          </div>
        </div>
      </div>
      
      <!-- 步骤 3: 完成Microsoft登录 -->
      <div class="auth-step" :class="{ active: currentStep >= 2 }">
        <div class="step-header">
          <div class="step-number">3</div>
          <div class="step-title">完成Microsoft登录</div>
        </div>
        <div class="step-content">
          <p class="mb-4">点击下方按钮在Microsoft网站上完成登录和授权：</p>
          <a :href="verificationUrl" target="_blank" class="apple-button w-full block text-center" v-if="verificationUrl">
            打开Microsoft登录页面
          </a>
          <button class="apple-button w-full block" disabled v-else>
            等待获取登录链接...
          </button>
        </div>
      </div>
      
      <!-- 认证状态提示 -->
      <div class="auth-status mt-6" :class="statusType">
        <div class="status-icon">
          <div class="spinner" v-if="statusType === 'pending'"></div>
          <div class="checkmark" v-else-if="statusType === 'success'">✓</div>
          <div class="error-mark" v-else-if="statusType === 'error'">✕</div>
        </div>
        <div class="status-text">{{ statusMessage }}</div>
      </div>
      
      <!-- 调试区域 (开发时可见) -->
      <div class="debug-area mt-6 p-4 bg-gray-100 rounded-lg text-xs" v-if="showDebug">
        <h4 class="font-bold mb-2">调试信息</h4>
        <div class="debug-actions flex space-x-2 mb-2">
          <button @click="checkStatus" class="text-xs px-2 py-1 bg-blue-500 text-white rounded">
            检查状态
          </button>
          <button @click="forceAuth" class="text-xs px-2 py-1 bg-green-500 text-white rounded">
            强制认证
          </button>
        </div>
        <pre class="whitespace-pre-wrap">{{ JSON.stringify(debugData, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { todoApi } from '../services/api'

export default {
  name: 'AuthComponent',
  setup() {
    // 状态
    const currentStep = ref(1)
    const isLoading = ref(false)
    const userCode = ref('')
    const verificationUrl = ref('')
    const expiresIn = ref(0)
    const expiresAt = ref(0)
    const statusMessage = ref('准备开始认证流程...')
    const statusType = ref('pending')
    const debugData = ref({})
    const showDebug = ref(false)
    
    // 计时器
    let pollTimer = null
    let countdownTimer = null
    
    // 计算属性
    const timeLeft = computed(() => {
      if (!expiresAt.value) return 0
      return Math.max(0, expiresAt.value - Date.now())
    })
    
    // 格式化时间
    const formatTime = (ms) => {
      const seconds = Math.floor(ms / 1000)
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = seconds % 60
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
    }
    
    // 开始认证流程
    const startAuth = async () => {
      try {
        currentStep.value = 1
        isLoading.value = true
        statusMessage.value = '正在启动认证流程...'
        statusType.value = 'pending'
        
        const response = await todoApi.auth.startDeviceCodeAuth()
        
        // 直接获取到令牌的情况
        if (response.accessToken && response.userComplete) {
          localStorage.setItem('msft_access_token', response.accessToken)
          statusMessage.value = '认证成功！正在跳转...'
          statusType.value = 'success'
          
          setTimeout(() => {
            window.location.href = '/'
          }, 1500)
          return
        }
        
        // 设置设备码和验证URL
        userCode.value = response.userCode
        verificationUrl.value = response.verificationUrl
        expiresIn.value = response.expiresIn || 900
        expiresAt.value = Date.now() + (expiresIn.value * 1000)
        
        // 更新状态和步骤
        currentStep.value = 2
        statusMessage.value = '请在Microsoft页面上输入验证码以完成授权'
        
        // 开始轮询
        startPolling(response.userCode)
        
        // 启动倒计时
        startCountdown()
        
        // 如果30秒后仍无响应，显示调试区域
        setTimeout(() => {
          if (statusType.value === 'pending') {
            showDebug.value = true
          }
        }, 30000)
      } catch (error) {
        statusMessage.value = `认证过程出错: ${error.message}`
        statusType.value = 'error'
        isLoading.value = false
        showDebug.value = true
        debugData.value = { error: error.message }
      }
    }
    
    // 复制验证码到剪贴板
    const copyCode = () => {
      if (!userCode.value) return
      
      try {
        navigator.clipboard.writeText(userCode.value)
        statusMessage.value = '验证码已复制到剪贴板！'
        
        // 2秒后恢复原来的状态信息
        setTimeout(() => {
          statusMessage.value = '请在Microsoft页面上输入验证码以完成授权'
        }, 2000)
      } catch (err) {
        console.error('无法复制到剪贴板:', err)
      }
    }
    
    // 启动轮询检查认证状态
    const startPolling = (code) => {
      if (pollTimer) clearInterval(pollTimer)
      
      pollTimer = setInterval(async () => {
        try {
          const result = await todoApi.auth.checkDeviceCodeStatus(code)
          
          if (result.accessToken) {
            // 认证成功
            clearInterval(pollTimer)
            localStorage.setItem('msft_access_token', result.accessToken)
            
            statusMessage.value = '认证成功！正在跳转...'
            statusType.value = 'success'
            
            // 跳转到首页
            setTimeout(() => {
              window.location.href = '/'
            }, 1500)
          } else if (result.status === 'pending') {
            // 仍在等待授权
            statusMessage.value = '等待您在Microsoft页面上完成授权...'
            statusType.value = 'pending'
          }
        } catch (error) {
          console.error('轮询状态出错:', error)
        }
      }, 5000)
    }
    
    // 启动倒计时
    const startCountdown = () => {
      if (countdownTimer) clearInterval(countdownTimer)
      
      countdownTimer = setInterval(() => {
        if (timeLeft.value <= 0) {
          clearInterval(countdownTimer)
          // 过期处理
          if (statusType.value === 'pending') {
            statusMessage.value = '验证码已过期，请重新开始'
            statusType.value = 'error'
          }
        }
      }, 1000)
    }
    
    // 检查认证状态 (调试方法)
    const checkStatus = async () => {
      if (!userCode.value) return
      
      try {
        const result = await todoApi.auth.checkDeviceCodeStatus(userCode.value)
        debugData.value = result
      } catch (error) {
        debugData.value = { error: error.message }
      }
    }
    
    // 强制认证 (调试方法)
    const forceAuth = async () => {
      try {
        // 尝试从debug/force-token获取模拟令牌
        const response = await fetch('http://localhost:3000/api/todo/debug/force-token')
        const data = await response.json()
        
        if (data.accessToken) {
          localStorage.setItem('msft_access_token', data.accessToken)
          statusMessage.value = '强制认证成功！正在跳转...'
          statusType.value = 'success'
          debugData.value = { success: true, message: '已获取模拟令牌' }
          
          setTimeout(() => {
            window.location.href = '/'
          }, 1500)
        }
      } catch (error) {
        debugData.value = { error: error.message }
      }
    }
    
    // 初始化
    onMounted(() => {
      // 检查是否已经有令牌
      const token = localStorage.getItem('msft_access_token')
      if (token) {
        statusMessage.value = '您已登录。正在验证...'
        // 验证令牌有效性
        todoApi.auth.checkAuth().then(({ authenticated }) => {
          if (authenticated) {
            statusMessage.value = '已认证，正在跳转...'
            statusType.value = 'success'
            setTimeout(() => {
              window.location.href = '/'
            }, 1000)
          } else {
            // 令牌无效，开始新的认证流程
            localStorage.removeItem('msft_access_token')
            statusMessage.value = '认证已过期，请重新登录'
            statusType.value = 'pending'
          }
        })
      }
      
      // 开发环境下显示调试区域
      if (process.env.NODE_ENV === 'development') {
        showDebug.value = true
      }
    })
    
    // 清理计时器
    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer)
      if (countdownTimer) clearInterval(countdownTimer)
    })
    
    return {
      currentStep,
      isLoading,
      userCode,
      verificationUrl,
      expiresIn,
      statusMessage,
      statusType,
      timeLeft,
      showDebug,
      debugData,
      
      formatTime,
      startAuth,
      copyCode,
      checkStatus,
      forceAuth
    }
  }
}
</script>

<style scoped>
.auth-container {
  max-width: 500px;
  margin: 50px auto;
}

.text-center {
  text-align: center;
}

.auth-step {
  margin-bottom: 20px;
  opacity: 0.5;
  transition: opacity 0.3s ease;
}

.auth-step.active {
  opacity: 1;
}

.step-header {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.step-number {
  width: 28px;
  height: 28px;
  background-color: var(--apple-blue);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-right: 10px;
  flex-shrink: 0;
}

.step-title {
  font-weight: 600;
  font-size: 18px;
}

.step-content {
  margin-left: 38px;
}

.device-code {
  font-family: monospace;
  font-size: 24px;
  letter-spacing: 2px;
  text-align: center;
  background-color: var(--apple-light-gray);
  padding: 15px;
  border-radius: 8px;
  margin: 15px 0;
  font-weight: bold;
}

.auth-status {
  display: flex;
  align-items: center;
  padding: 15px;
  border-radius: 8px;
  background-color: #f8f9fa;
}

.status-icon {
  width: 24px;
  height: 24px;
  margin-right: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-status.pending {
  background-color: #f8f9fa;
}

.auth-status.success {
  background-color: #d4edda;
  color: #155724;
}

.auth-status.error {
  background-color: #f8d7da;
  color: #721c24;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(0, 120, 212, 0.3);
  border-radius: 50%;
  border-top-color: var(--apple-blue);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.checkmark {
  color: var(--apple-green);
  font-size: 20px;
  font-weight: bold;
}

.error-mark {
  color: var(--apple-red);
  font-size: 20px;
  font-weight: bold;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.mb-6 {
  margin-bottom: 1.5rem;
}

.mb-8 {
  margin-bottom: 2rem;
}

.mt-2 {
  margin-top: 0.5rem;
}

.mt-6 {
  margin-top: 1.5rem;
}

.w-full {
  width: 100%;
}

.text-sm {
  font-size: 0.875rem;
}

.text-xs {
  font-size: 0.75rem;
}

.text-2xl {
  font-size: 1.5rem;
}

.code-timer {
  color: var(--apple-text-secondary);
}
</style> 