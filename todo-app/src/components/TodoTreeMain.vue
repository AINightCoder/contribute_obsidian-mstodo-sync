<template>
  <div class="todo-tree-main">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>
    
    <!-- 主要内容 -->
    <todo-tree 
      v-else
      :lists="lists"
      :selectedList="selectedList"
      :tasks="tasks"
      @select-list="selectList"
      @add-list="showAddListModal = true"
      @update-task="updateTask"
      @delete-task="deleteTask"
      @create-task="createTask"
      @add-subtask="showAddSubtaskModal"
    />
    
    <!-- 添加列表对话框 -->
    <div v-if="showAddListModal" class="modal-overlay" @click.self="showAddListModal = false">
      <div class="modal-container">
        <h3 class="modal-title">创建新列表</h3>
        <form @submit.prevent="createList">
          <div class="form-group">
            <label for="list-name">列表名称</label>
            <input 
              id="list-name" 
              v-model="newListName" 
              class="input-field" 
              placeholder="输入列表名称"
              required 
              autofocus
            />
          </div>
          <div class="form-actions">
            <button 
              type="button" 
              class="button secondary-button" 
              @click="showAddListModal = false"
            >
              取消
            </button>
            <button 
              type="submit" 
              class="button primary-button"
              :disabled="!newListName.trim() || isCreatingList"
            >
              {{ isCreatingList ? '创建中...' : '创建列表' }}
            </button>
          </div>
        </form>
      </div>
    </div>
    
    <!-- 添加子任务对话框 -->
    <div v-if="addSubtaskModal.visible" class="modal-overlay" @click.self="cancelAddSubtask">
      <div class="modal-container">
        <h3 class="modal-title">添加子任务</h3>
        <form @submit.prevent="saveSubtask">
          <div class="form-group">
            <label for="subtask-title">子任务标题</label>
            <input 
              id="subtask-title" 
              v-model="addSubtaskModal.title" 
              class="input-field" 
              placeholder="子任务标题" 
              required
              autofocus
            />
          </div>
          <div class="form-actions">
            <button 
              type="button" 
              class="button secondary-button" 
              @click="cancelAddSubtask"
            >
              取消
            </button>
            <button 
              type="submit" 
              class="button primary-button"
              :disabled="!addSubtaskModal.title.trim()"
            >
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch } from 'vue';
import TodoTree from './TodoTree.vue';
import todoApi from '../services/api';

export default {
  name: 'TodoTreeMain',
  
  components: {
    TodoTree
  },
  
  setup() {
    // 状态
    const isLoading = ref(true);
    const lists = ref([]);
    const selectedList = ref(null);
    const tasks = ref([]);
    
    // 列表相关
    const showAddListModal = ref(false);
    const newListName = ref('');
    const isCreatingList = ref(false);
    
    // 子任务相关
    const addSubtaskModal = ref({
      visible: false,
      parentTaskId: null,
      title: ''
    });
    
    // 加载所有列表
    const loadLists = async () => {
      isLoading.value = true;
      try {
        const response = await todoApi.lists.getLists();
        lists.value = response;
        
        // 如果有列表，默认选择第一个
        if (response && response.length > 0) {
          selectList(response[0]);
        }
      } catch (error) {
        console.error('加载列表失败:', error);
      } finally {
        isLoading.value = false;
      }
    };
    
    // 选择列表并加载任务
    const selectList = async (list) => {
      selectedList.value = list;
      
      if (list) {
        isLoading.value = true;
        try {
          const response = await todoApi.tasks.getTasks(list.id);
          tasks.value = response || [];
        } catch (error) {
          console.error(`加载任务失败:`, error);
          tasks.value = [];
        } finally {
          isLoading.value = false;
        }
      } else {
        tasks.value = [];
      }
    };
    
    // 创建列表
    const createList = async () => {
      if (!newListName.value.trim()) return;
      
      isCreatingList.value = true;
      try {
        const createdList = await todoApi.lists.createList(newListName.value.trim());
        lists.value.push(createdList);
        showAddListModal.value = false;
        newListName.value = '';
        
        // 自动选择新创建的列表
        selectList(createdList);
      } catch (error) {
        console.error('创建列表失败:', error);
        alert('创建列表失败: ' + (error.response?.data?.message || error.message));
      } finally {
        isCreatingList.value = false;
      }
    };
    
    // 创建任务
    const createTask = async (listId, taskData) => {
      try {
        const newTask = await todoApi.tasks.createTask(listId, taskData);
        
        // 添加到本地任务列表
        tasks.value.unshift(newTask);
      } catch (error) {
        console.error('创建任务失败:', error);
        alert('创建任务失败: ' + (error.response?.data?.message || error.message));
      }
    };
    
    // 更新任务
    const updateTask = async (listId, taskId, updatedTask) => {
      try {
        await todoApi.tasks.updateTask(listId, taskId, updatedTask);
        
        // 更新本地任务
        const index = tasks.value.findIndex(task => task.id === taskId);
        if (index !== -1) {
          tasks.value[index] = { ...tasks.value[index], ...updatedTask };
        }
      } catch (error) {
        console.error('更新任务失败:', error);
        alert('更新任务失败: ' + (error.response?.data?.message || error.message));
      }
    };
    
    // 删除任务
    const deleteTask = async (listId, taskId) => {
      // 实际API中缺少删除任务的endpoint，这里模拟删除
      try {
        // 从本地列表中删除
        const index = tasks.value.findIndex(task => task.id === taskId);
        if (index !== -1) {
          tasks.value.splice(index, 1);
        }
        
        // 理想情况下应该调用API删除
        // await todoApi.tasks.deleteTask(listId, taskId);
        
        // 既然没有API，可以标记为已完成
        await todoApi.tasks.completeTask(listId, taskId);
      } catch (error) {
        console.error('删除任务失败:', error);
      }
    };
    
    // 显示添加子任务表单
    const showAddSubtaskModal = (taskInfo) => {
      addSubtaskModal.value = {
        visible: true,
        listId: selectedList.value.id,
        parentTaskId: taskInfo.id,
        title: ''
      };
    };
    
    // 保存子任务
    const saveSubtask = async () => {
      const { listId, parentTaskId, title } = addSubtaskModal.value;
      
      if (!title.trim()) return;
      
      try {
        const newSubtask = await todoApi.tasks.addChecklistItem(
          listId || selectedList.value.id,
          parentTaskId,
          title.trim()
        );
        
        // 更新本地任务的子任务列表
        const taskIndex = tasks.value.findIndex(task => task.id === parentTaskId);
        if (taskIndex !== -1) {
          const task = tasks.value[taskIndex];
          if (!task.checklistItems) {
            task.checklistItems = [];
          }
          task.checklistItems.push(newSubtask);
          // 触发视图更新
          tasks.value = [...tasks.value];
        }
        
        cancelAddSubtask();
      } catch (error) {
        console.error('添加子任务失败:', error);
        alert('添加子任务失败: ' + (error.response?.data?.message || error.message));
      }
    };
    
    // 取消添加子任务
    const cancelAddSubtask = () => {
      addSubtaskModal.value.visible = false;
    };
    
    // 初始化
    onMounted(() => {
      loadLists();
    });
    
    return {
      isLoading,
      lists,
      selectedList,
      tasks,
      showAddListModal,
      newListName,
      isCreatingList,
      addSubtaskModal,
      selectList,
      createList,
      createTask,
      updateTask,
      deleteTask,
      showAddSubtaskModal,
      saveSubtask,
      cancelAddSubtask
    };
  }
};
</script>

<style scoped>
.todo-tree-main {
  height: 100%;
  position: relative;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 0;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 105, 180, 0.1);
  border-radius: 50%;
  border-top-color: #ff69b4;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: #666;
  font-size: 16px;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-container {
  background-color: white;
  border-radius: 12px;
  padding: 20px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}

.modal-title {
  margin-top: 0;
  margin-bottom: 20px;
  font-size: 18px;
  color: #333;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  color: #555;
}

.input-field {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #ddd;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease;
}

.input-field:focus {
  border-color: #ff69b4;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.button {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s ease;
}

.primary-button {
  background-color: #ff69b4;
  color: white;
}

.primary-button:hover {
  background-color: #ff5ba7;
}

.primary-button:disabled {
  background-color: #ffc0cb;
  cursor: not-allowed;
}

.secondary-button {
  background-color: #f0f0f0;
  color: #333;
}

.secondary-button:hover {
  background-color: #e0e0e0;
}
</style> 