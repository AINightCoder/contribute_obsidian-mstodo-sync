<template>
  <div class="todo-lists">
    <!-- 加载状态 -->
    <div class="loading-state" v-if="isLoading">
      <div class="spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>
    
    <!-- 有列表时显示 -->
    <div v-else-if="lists && lists.length > 0" class="lists-container">
      <h2 class="apple-heading">我的列表</h2>
      
      <!-- 列表网格 -->
      <div class="lists-grid">
        <div 
          v-for="list in lists" 
          :key="list.id" 
          class="list-card apple-card fade-in"
          :class="{ 'active': selectedList && selectedList.id === list.id }"
          @click="selectList(list)"
        >
          <div class="list-card-content">
            <div class="list-icon" :style="{ backgroundColor: getListColor(list.id) }">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-4-5.5a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm0-3a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm0-3a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="list-title">{{ list.displayName }}</div>
            <div class="list-count" v-if="listCounts[list.id]">{{ listCounts[list.id] }} 项</div>
          </div>
        </div>
        
        <!-- 添加列表卡片 -->
        <div class="list-card apple-card add-list-card" @click="showAddListForm = true">
          <div class="list-card-content">
            <div class="list-icon new-list-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="list-title">创建新列表</div>
          </div>
        </div>
      </div>
      
      <!-- 选定列表后显示的任务 -->
      <div v-if="selectedList" class="selected-list-tasks">
        <h3 class="apple-heading list-details-header">
          <span :style="{ color: getListColor(selectedList.id) }">{{ selectedList.displayName }}</span>
          <button class="apple-button secondary small" @click="selectedList = null">返回列表</button>
        </h3>
        
        <!-- 任务列表 -->
        <todo-items 
          :list-id="selectedList.id" 
          :list-name="selectedList.displayName"
          @update-count="updateListCount"
        />
      </div>
    </div>
    
    <!-- 无列表时显示 -->
    <div v-else class="no-lists apple-card">
      <div class="empty-state-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9a1 1 0 011-1h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H6a1 1 0 010-2h2V7z" clip-rule="evenodd" />
        </svg>
      </div>
      <h3>未找到待办事项列表</h3>
      <p>点击下方按钮创建您的第一个列表</p>
      <button @click="showAddListForm = true" class="apple-button mt-4">
        创建新列表
      </button>
    </div>
    
    <!-- 添加列表对话框 -->
    <div class="modal-overlay" v-if="showAddListForm" @click.self="showAddListForm = false">
      <div class="modal-container apple-card">
        <h3 class="apple-heading">创建新列表</h3>
        <form @submit.prevent="createList">
          <div class="form-group">
            <label for="list-name">列表名称</label>
            <input 
              id="list-name" 
              v-model="newListName" 
              class="apple-input" 
              placeholder="输入列表名称"
              required 
              autofocus
            />
          </div>
          <div class="form-actions">
            <button 
              type="button" 
              class="apple-button secondary" 
              @click="showAddListForm = false"
            >
              取消
            </button>
            <button 
              type="submit" 
              class="apple-button"
              :disabled="!newListName.trim() || isCreating"
            >
              {{ isCreating ? '创建中...' : '创建列表' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, onMounted } from 'vue'
import TodoItems from './TodoItems.vue'
import todoApi from '../services/api'

export default {
  name: 'TodoLists',
  components: {
    TodoItems
  },
  setup() {
    const lists = ref([])
    const selectedList = ref(null)
    const isLoading = ref(true)
    const listCounts = reactive({})
    
    const showAddListForm = ref(false)
    const newListName = ref('')
    const isCreating = ref(false)
    
    // 预定义颜色数组
    const colors = [
      '#007AFF', // 蓝色
      '#FF3B30', // 红色
      '#34C759', // 绿色
      '#FF9500', // 橙色
      '#5856D6', // 紫色
      '#FF2D55', // 粉色
      '#AF52DE', // 紫罗兰
      '#5AC8FA', // 浅蓝
      '#FFCC00', // 黄色
    ]
    
    // 基于列表ID返回一个预定义颜色
    const getListColor = (listId) => {
      if (!listId) return colors[0]
      // 使用列表ID的最后一个字符的ASCII值来确定颜色索引
      const lastChar = listId.charAt(listId.length - 1)
      const charCode = lastChar.charCodeAt(0)
      const colorIndex = charCode % colors.length
      return colors[colorIndex]
    }
    
    // 加载所有列表
    const loadLists = async () => {
      isLoading.value = true
      try {
        const response = await todoApi.lists.getLists()
        lists.value = response
        
        // 预先计算每个列表的任务计数
        for (const list of lists.value) {
          loadListCount(list.id)
        }
      } catch (error) {
        console.error('加载列表失败:', error)
        if (error.response?.status === 401) {
          // 认证失败，重定向到登录页面
          window.location.href = '/login'
        }
      } finally {
        isLoading.value = false
      }
    }
    
    // 加载单个列表的任务计数
    const loadListCount = async (listId) => {
      try {
        const tasks = await todoApi.tasks.getTasks(listId)
        listCounts[listId] = tasks.length
      } catch (error) {
        console.error(`加载列表 ${listId} 的任务计数失败:`, error)
        listCounts[listId] = 0
      }
    }
    
    // 更新列表计数（由子组件调用）
    const updateListCount = (listId, count) => {
      listCounts[listId] = count
    }
    
    // 选择列表
    const selectList = (list) => {
      selectedList.value = list
    }
    
    // 创建新列表
    const createList = async () => {
      if (!newListName.value.trim()) return
      
      isCreating.value = true
      try {
        const createdList = await todoApi.lists.createList(newListName.value.trim())
        lists.value.push(createdList)
        listCounts[createdList.id] = 0
        showAddListForm.value = false
        newListName.value = ''
      } catch (error) {
        console.error('创建列表失败:', error)
        alert('创建列表失败: ' + (error.response?.data?.message || error.message))
      } finally {
        isCreating.value = false
      }
    }
    
    // 初始化
    onMounted(() => {
      loadLists()
    })
    
    return {
      lists,
      selectedList,
      isLoading,
      listCounts,
      showAddListForm,
      newListName,
      isCreating,
      getListColor,
      selectList,
      createList,
      updateListCount
    }
  }
}
</script>

<style scoped>
.todo-lists {
  padding: 20px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
}

.loading-state .spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 113, 227, 0.2);
  border-radius: 50%;
  border-top-color: var(--apple-blue);
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.loading-text {
  color: var(--apple-text-secondary);
}

.lists-container {
  max-width: 900px;
  margin: 0 auto;
}

.lists-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 40px;
}

.list-card {
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
  overflow: hidden;
  animation: fadeIn 0.3s ease forwards;
}

.list-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.list-card.active {
  border: 2px solid var(--apple-blue);
  transform: scale(1.02);
}

.list-card-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  height: 100%;
}

.list-icon {
  width: 60px;
  height: 60px;
  border-radius: 15px;
  background-color: var(--apple-blue);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.list-icon svg {
  width: 30px;
  height: 30px;
}

.new-list-icon {
  background-color: var(--apple-green);
}

.list-title {
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 8px;
}

.list-count {
  font-size: 14px;
  color: var(--apple-text-secondary);
}

.no-lists {
  max-width: 400px;
  margin: 60px auto;
  text-align: center;
  padding: 40px;
}

.empty-state-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 24px;
  background-color: var(--apple-light-gray);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state-icon svg {
  width: 40px;
  height: 40px;
  color: var(--apple-blue);
}

.selected-list-tasks {
  animation: fadeIn 0.3s ease;
}

.list-details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 100%;
  max-width: 450px;
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.apple-button.small {
  font-size: 12px;
  padding: 6px 12px;
}

.mt-4 {
  margin-top: 1rem;
}
</style> 