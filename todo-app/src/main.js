import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'

// 创建并挂载应用
const app = createApp(App)

// 全局错误处理
app.config.errorHandler = (err, vm, info) => {
  console.error('全局错误:', err)
  console.error('错误组件:', vm)
  console.error('错误信息:', info)
}

// 添加全局属性
app.config.globalProperties.$apiBaseUrl = 'http://localhost:3000/api/todo'

app.mount('#app') 