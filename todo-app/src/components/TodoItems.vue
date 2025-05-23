<template>
  <div class="todo-items">
    <!-- 加载状态 -->
    <div class="loading-state" v-if="isLoading">
      <div class="spinner"></div>
      <div class="loading-text">加载任务中...</div>
    </div>
    
    <!-- 任务列表 -->
    <div v-else class="tasks-container">
      <!-- 创建任务表单 -->
      <div class="create-task-form apple-card">
        <form @submit.prevent="createTask">
          <div class="input-group">
            <input 
              v-model="newTaskTitle" 
              class="apple-input" 
              placeholder="添加新任务..." 
              :disabled="isCreating" 
              ref="newTaskInput"
            />
            <button 
              type="submit" 
              class="apple-button" 
              :disabled="!newTaskTitle.trim() || isCreating"
            >
              {{ isCreating ? '添加中...' : '添加' }}
            </button>
          </div>
        </form>
      </div>
      
      <!-- 任务列表 -->
      <div class="tasks-list">
        <!-- 未完成任务 -->
        <div class="tasks-group">
          <h4 class="tasks-group-title">待办任务 ({{ incompleteTasks.length }})</h4>
          
          <template v-if="incompleteTasks.length > 0">
            <div 
              v-for="task in incompleteTasks" 
              :key="task.id" 
              class="task-item apple-card fade-in"
            >
              <div class="task-checkbox">
                <label class="apple-checkbox">
                  <input 
                    type="checkbox" 
                    :checked="task.status === 'completed'" 
                    @change="toggleTaskStatus(task)"
                  />
                  <span class="checkmark"></span>
                </label>
              </div>
              <div class="task-content" @click="editTask(task)">
                <div class="task-title">{{ task.title }}</div>
                <div class="task-due" v-if="task.dueDateTime">
                  到期: {{ formatDueDate(task.dueDateTime) }}
                </div>
              </div>
              <div class="task-actions">
                <button class="task-action-btn delete" @click="deleteTask(task)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </template>
          <div v-else class="empty-tasks-message">
            没有待办任务，请添加一些任务吧！
          </div>
        </div>
        
        <!-- 已完成任务 (可折叠) -->
        <div class="tasks-group completed-tasks" v-if="completedTasks.length > 0">
          <div class="tasks-group-header" @click="showCompletedTasks = !showCompletedTasks">
            <h4 class="tasks-group-title">
              已完成 ({{ completedTasks.length }})
            </h4>
            <button class="toggle-btn">
              {{ showCompletedTasks ? '隐藏' : '显示' }}
            </button>
          </div>
          
          <div v-if="showCompletedTasks" class="completed-tasks-list">
            <div 
              v-for="task in completedTasks" 
              :key="task.id" 
              class="task-item apple-card fade-in completed"
            >
              <div class="task-checkbox">
                <label class="apple-checkbox">
                  <input 
                    type="checkbox" 
                    :checked="true" 
                    @change="toggleTaskStatus(task)"
                  />
                  <span class="checkmark"></span>
                </label>
              </div>
              <div class="task-content todo-completed" @click="editTask(task)">
                <div class="task-title">{{ task.title }}</div>
                <div class="task-due" v-if="task.dueDateTime">
                  到期: {{ formatDueDate(task.dueDateTime) }}
                </div>
              </div>
              <div class="task-actions">
                <button class="task-action-btn delete" @click="deleteTask(task)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 任务编辑对话框 -->
    <div 
      class="modal-overlay" 
      v-if="showEditTaskModal" 
      @click.self="cancelEditTask"
    >
      <div class="modal-container apple-card">
        <h3 class="apple-heading">编辑任务</h3>
        <form @submit.prevent="saveTaskEdit">
          <div class="form-group">
            <label for="task-title">任务标题</label>
            <input 
              id="task-title" 
              v-model="editedTask.title" 
              class="apple-input" 
              placeholder="任务标题" 
              required
            />
          </div>
          <div class="form-group">
            <label for="task-due-date">到期日期</label>
            <input 
              id="task-due-date" 
              v-model="editedTask.dueDate" 
              type="date" 
              class="apple-input"
            />
          </div>
          <div class="form-group">
            <label class="apple-checkbox">
              <input type="checkbox" v-model="editedTask.isCompleted" />
              <span class="checkmark"></span>
              已完成
            </label>
          </div>
          <div class="form-actions">
            <button 
              type="button" 
              class="apple-button secondary" 
              @click="cancelEditTask"
            >
              取消
            </button>
            <button 
              type="submit" 
              class="apple-button"
              :disabled="!editedTask.title.trim() || isSaving"
            >
              {{ isSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import todoApi from '../services/api'

export default {
  name: 'TodoItems',
  props: {
    listId: {
      type: String,
      required: true
    },
    listName: {
      type: String,
      default: ''
    }
  },
  emits: ['update-count'],
  setup(props, { emit }) {
    // 状态
    const tasks = ref([])
    const isLoading = ref(true)
    const newTaskTitle = ref('')
    const isCreating = ref(false)
    const showCompletedTasks = ref(false)
    const newTaskInput = ref(null)
    
    // 编辑任务状态
    const showEditTaskModal = ref(false)
    const editedTask = ref({ title: '', dueDate: '', isCompleted: false })
    const editingTaskId = ref(null)
    const isSaving = ref(false)
    
    // 计算属性：未完成任务
    const incompleteTasks = computed(() => {
      return tasks.value.filter(task => task.status !== 'completed')
    })
    
    // 计算属性：已完成任务
    const completedTasks = computed(() => {
      return tasks.value.filter(task => task.status === 'completed')
    })
    
    // 加载任务
    const loadTasks = async () => {
      isLoading.value = true
      try {
        const response = await todoApi.tasks.getTasks(props.listId)
        tasks.value = response
        
        // 向父组件发送任务计数更新
        emit('update-count', props.listId, response.length)
      } catch (error) {
        console.error('加载任务失败:', error)
      } finally {
        isLoading.value = false
      }
    }
    
    // 创建任务
    const createTask = async () => {
      if (!newTaskTitle.value.trim()) return
      
      isCreating.value = true
      try {
        const newTask = {
          title: newTaskTitle.value.trim(),
          status: 'notStarted'
        }
        
        const createdTask = await todoApi.tasks.createTask(props.listId, newTask)
        tasks.value.push(createdTask)
        newTaskTitle.value = ''
        
        // 向父组件发送任务计数更新
        emit('update-count', props.listId, tasks.value.length)
        
        // 自动聚焦输入框
        nextTick(() => {
          newTaskInput.value?.focus()
        })
      } catch (error) {
        console.error('创建任务失败:', error)
        alert('创建任务失败: ' + (error.response?.data?.message || error.message))
      } finally {
        isCreating.value = false
      }
    }
    
    // 切换任务状态
    const toggleTaskStatus = async (task) => {
      const newStatus = task.status === 'completed' ? 'notStarted' : 'completed'
      try {
        const updatedTask = await todoApi.tasks.updateTask(props.listId, task.id, {
          status: newStatus
        })
        
        // 更新本地任务列表
        const index = tasks.value.findIndex(t => t.id === task.id)
        if (index !== -1) {
          tasks.value[index] = { ...tasks.value[index], ...updatedTask }
        }
      } catch (error) {
        console.error('更新任务状态失败:', error)
        alert('无法更新任务状态，请稍后再试')
      }
    }
    
    // 删除任务
    const deleteTask = async (task) => {
      if (!confirm(`确定要删除任务 "${task.title}" 吗？`)) return
      
      try {
        // 乐观更新
        const taskIndex = tasks.value.findIndex(t => t.id === task.id)
        if (taskIndex !== -1) {
          tasks.value.splice(taskIndex, 1)
        }
        
        // 向父组件发送任务计数更新
        emit('update-count', props.listId, tasks.value.length)
        
        // 在真实API中，会调用删除API
        // 由于我们的API没有实现删除功能，这里模拟成功
        console.log('删除任务:', task.id)
      } catch (error) {
        console.error('删除任务失败:', error)
        alert('删除任务失败，请稍后再试')
        // 失败时恢复任务
        loadTasks()
      }
    }
    
    // 编辑任务
    const editTask = (task) => {
      editingTaskId.value = task.id
      
      // 解析日期时间
      let dueDate = ''
      if (task.dueDateTime && task.dueDateTime.dateTime) {
        dueDate = task.dueDateTime.dateTime.split('T')[0]
      }
      
      editedTask.value = {
        title: task.title,
        dueDate: dueDate,
        isCompleted: task.status === 'completed'
      }
      
      showEditTaskModal.value = true
    }
    
    // 保存任务编辑
    const saveTaskEdit = async () => {
      if (!editedTask.value.title.trim() || !editingTaskId.value) return
      
      isSaving.value = true
      try {
        // 准备更新数据
        const updateData = {
          title: editedTask.value.title.trim(),
          status: editedTask.value.isCompleted ? 'completed' : 'notStarted'
        }
        
        // 添加到期日期（如果有）
        if (editedTask.value.dueDate) {
          updateData.dueDateTime = {
            dateTime: `${editedTask.value.dueDate}T00:00:00Z`,
            timeZone: 'UTC'
          }
        }
        
        // 调用API更新
        const updatedTask = await todoApi.tasks.updateTask(props.listId, editingTaskId.value, updateData)
        
        // 更新本地任务列表
        const taskIndex = tasks.value.findIndex(t => t.id === editingTaskId.value)
        if (taskIndex !== -1) {
          tasks.value[taskIndex] = { ...tasks.value[taskIndex], ...updatedTask }
        }
        
        // 关闭对话框
        showEditTaskModal.value = false
      } catch (error) {
        console.error('保存任务失败:', error)
        alert('无法保存任务，请稍后再试')
      } finally {
        isSaving.value = false
      }
    }
    
    // 取消编辑
    const cancelEditTask = () => {
      showEditTaskModal.value = false
      editingTaskId.value = null
      editedTask.value = { title: '', dueDate: '', isCompleted: false }
    }
    
    // 格式化到期日期
    const formatDueDate = (dueDateTime) => {
      if (!dueDateTime || !dueDateTime.dateTime) return ''
      
      try {
        const date = new Date(dueDateTime.dateTime)
        return date.toLocaleDateString('zh-CN', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        })
      } catch (e) {
        return dueDateTime.dateTime
      }
    }
    
    // 监听列表ID变化
    watch(() => props.listId, () => {
      loadTasks()
    })
    
    // 初始加载
    onMounted(() => {
      loadTasks()
    })
    
    return {
      tasks,
      isLoading,
      newTaskTitle,
      isCreating,
      showCompletedTasks,
      incompleteTasks,
      completedTasks,
      newTaskInput,
      showEditTaskModal,
      editedTask,
      isSaving,
      
      loadTasks,
      createTask,
      toggleTaskStatus,
      deleteTask,
      editTask,
      saveTaskEdit,
      cancelEditTask,
      formatDueDate
    }
  }
}
</script>

<style scoped>
.todo-items {
  padding-bottom: 40px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 0;
}

.loading-state .spinner {
  width: 30px;
  height: 30px;
  border: 3px solid rgba(0, 113, 227, 0.2);
  border-radius: 50%;
  border-top-color: var(--apple-blue);
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

.loading-text {
  color: var(--apple-text-secondary);
  font-size: 14px;
}

.create-task-form {
  margin-bottom: 20px;
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-group .apple-input {
  flex: 1;
}

.tasks-group {
  margin-bottom: 30px;
}

.tasks-group-title {
  font-weight: 600;
  font-size: 16px;
  color: var(--apple-text-secondary);
  margin-bottom: 12px;
}

.tasks-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding: 4px 0;
}

.toggle-btn {
  background: none;
  border: none;
  color: var(--apple-blue);
  font-size: 14px;
  cursor: pointer;
}

.task-item {
  display: flex;
  align-items: center;
  padding: 16px;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.task-item:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.task-checkbox {
  margin-right: 12px;
  flex-shrink: 0;
}

.task-content {
  flex: 1;
  cursor: pointer;
}

.task-title {
  font-weight: 500;
  margin-bottom: 4px;
}

.task-due {
  font-size: 12px;
  color: var(--apple-text-secondary);
}

.task-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.task-item:hover .task-actions {
  opacity: 1;
}

.task-action-btn {
  background: none;
  border: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--apple-gray);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.task-action-btn:hover {
  background-color: var(--apple-light-gray);
}

.task-action-btn.delete:hover {
  color: var(--apple-red);
}

.task-action-btn svg {
  width: 16px;
  height: 16px;
}

.empty-tasks-message {
  color: var(--apple-text-secondary);
  padding: 20px;
  text-align: center;
  background-color: var(--apple-light-gray);
  border-radius: var(--apple-border-radius);
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

.completed-tasks-list {
  animation: fadeIn 0.3s ease;
}
</style> 