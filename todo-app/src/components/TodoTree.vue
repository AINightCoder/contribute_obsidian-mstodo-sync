<template>
  <div class="todo-tree">
    <!-- 拖拽区域 -->
    <div class="tree-container">
      <!-- 任务列表 -->
      <div class="task-lists">
        <div 
          v-for="list in lists" 
          :key="list.id" 
          class="task-list"
          :class="{ 'active': selectedList && selectedList.id === list.id }"
          @click="selectList(list)"
        >
          <div class="list-content">
            <div class="list-title" :style="{ color: list.id === selectedList?.id ? '#fff' : '#333' }">
              {{ list.displayName }}
            </div>
          </div>
        </div>
        
        <!-- 添加新列表按钮 -->
        <div class="task-list add-list" @click="$emit('add-list')">
          <div class="list-content">
            <div class="list-title">
              <span class="add-icon">+</span> 添加列表
            </div>
          </div>
        </div>
      </div>
      
      <!-- 选中列表的任务树形结构 -->
      <div v-if="selectedList" class="task-tree-view">
        <!-- 任务搜索框 -->
        <div class="task-search">
          <input 
            v-model="searchText" 
            placeholder="搜索任务..." 
            class="search-input"
          />
        </div>
        
        <!-- 树形结构 -->
        <div class="tree-structure">
          <div class="new-task-node">
            <div class="new-task-input-container">
              <input 
                v-model="newTaskTitle" 
                placeholder="添加新任务..."
                class="new-task-input"
                @keyup.enter="createTask" 
              />
              <button 
                class="action-button add-task-btn" 
                :disabled="!newTaskTitle.trim()"
                @click="createTask"
              >
                <span class="add-icon">+</span>
              </button>
            </div>
          </div>
          
          <!-- 使用递归组件渲染树 -->
          <div class="task-node-container">
            <draggable 
              v-model="filteredTasks" 
              group="tasks"
              item-key="id"
              :animation="150"
              ghost-class="ghost-task"
              chosen-class="chosen-task"
              @change="handleDragChange"
            >
              <template #item="{ element: task }">
                <task-node 
                  :task="task" 
                  :list-id="selectedList.id"
                  @toggle-status="toggleTaskStatus"
                  @edit="startEditTask"
                  @delete="deleteTask"
                  @add-subtask="showAddSubtaskForm"
                />
              </template>
            </draggable>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 任务操作菜单 -->
    <div v-if="activeTaskMenu" class="task-menu" :style="menuPosition">
      <div class="menu-item edit" @click="editTask(activeTaskMenu.task)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M16.757 3.743l3.5 3.5a1 1 0 0 1 0 1.414l-10.5 10.5a1 1 0 0 1-.39.242l-4 1a1 1 0 0 1-1.21-1.21l1-4a1 1 0 0 1 .242-.39l10.5-10.5a1 1 0 0 1 1.414 0zM16.05 5.864L5.93 15.984l-.45 1.786 1.786-.45L17.386 7.2l-1.336-1.336zM18.172 6.05l-.465-.465 1.415-1.414.464.464-1.414 1.415z" fill="currentColor"></path></svg>
        编辑
      </div>
      <div class="menu-item delete" @click="deleteTask(activeTaskMenu.task)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M17 6h5v2h-2v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8H2V6h5V3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v3zm1 2H6v12h12V8zm-9 3h2v6H9v-6zm4 0h2v6h-2v-6zM9 4v2h6V4H9z" fill="currentColor"></path></svg>
        删除
      </div>
      <div class="menu-item add-subtask" @click="showAddSubtaskForm(activeTaskMenu.task)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z" fill="currentColor"></path></svg>
        添加子任务
      </div>
      <div class="menu-item complete-task" @click="toggleTaskStatus(activeTaskMenu.task)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm-.997-4L6.76 11.757l1.414-1.414 2.829 2.829 5.656-5.657 1.415 1.414L11.003 16z" fill="currentColor"></path></svg>
        {{ activeTaskMenu.task.status === 'completed' ? '标记为未完成' : '标记为已完成' }}
      </div>
    </div>
    
    <!-- 编辑任务对话框 -->
    <div v-if="editTaskModal.visible" class="modal-overlay" @click.self="cancelEditTask">
      <div class="modal-container">
        <h3 class="modal-title">{{ editTaskModal.isNew ? '新建任务' : '编辑任务' }}</h3>
        <form @submit.prevent="saveTaskEdit">
          <div class="form-group">
            <label for="edit-task-title">任务标题</label>
            <input 
              id="edit-task-title" 
              v-model="editTaskModal.task.title" 
              class="input-field" 
              placeholder="任务标题" 
              required
              autofocus
            />
          </div>
          <div class="form-group">
            <label for="edit-task-due">截止日期</label>
            <input 
              id="edit-task-due" 
              type="datetime-local" 
              v-model="editTaskModal.dueDate" 
              class="input-field" 
            />
          </div>
          <div class="form-actions">
            <button 
              type="button" 
              class="button secondary-button" 
              @click="cancelEditTask"
            >
              取消
            </button>
            <button 
              type="submit" 
              class="button primary-button"
              :disabled="!editTaskModal.task.title.trim()"
            >
              保存
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
import { ref, computed, watch } from 'vue';
import TaskNode from './TaskNode.vue';
import draggable from 'vuedraggable';
import todoApi from '../services/api';

export default {
  name: 'TodoTree',
  
  components: {
    TaskNode,
    draggable
  },
  
  props: {
    lists: {
      type: Array,
      required: true
    },
    selectedList: {
      type: Object,
      default: null
    },
    tasks: {
      type: Array,
      default: () => []
    }
  },
  
  emits: ['select-list', 'add-list', 'update-task', 'delete-task', 'create-task', 'add-subtask'],
  
  setup(props, { emit }) {
    // 任务相关状态
    const filteredTasks = ref([]);
    const searchText = ref('');
    const newTaskTitle = ref('');
    
    // 控制弹出菜单
    const activeTaskMenu = ref(null);
    const menuPosition = computed(() => {
      if (!activeTaskMenu.value) return {};
      return {
        top: `${activeTaskMenu.value.y}px`,
        left: `${activeTaskMenu.value.x}px`
      };
    });
    
    // 编辑任务模态框
    const editTaskModal = ref({
      visible: false,
      isNew: false,
      task: { title: '', status: 'notStarted' },
      dueDate: ''
    });
    
    // 添加子任务模态框
    const addSubtaskModal = ref({
      visible: false,
      parentTaskId: null,
      title: ''
    });
    
    // 监听搜索和任务变化
    watch([() => props.tasks, searchText], () => {
      if (!searchText.value.trim()) {
        filteredTasks.value = [...props.tasks];
      } else {
        const searchLower = searchText.value.toLowerCase();
        filteredTasks.value = props.tasks.filter(task => 
          task.title.toLowerCase().includes(searchLower)
        );
      }
    }, { immediate: true, deep: true });
    
    // 处理拖拽事件
    const handleDragChange = (evt) => {
      console.log('拖拽变化:', evt);
      // 更新后端数据
      if (evt.added || evt.moved) {
        emit('update-task', filteredTasks.value);
      }
    };
    
    // 列表选择
    const selectList = (list) => {
      emit('select-list', list);
    };
    
    // 创建新任务
    const createTask = () => {
      if (!newTaskTitle.value.trim()) return;
      
      const newTask = {
        title: newTaskTitle.value.trim(),
        status: 'notStarted'
      };
      
      emit('create-task', props.selectedList.id, newTask);
      newTaskTitle.value = '';
    };
    
    // 切换任务状态
    const toggleTaskStatus = (task) => {
      const updatedTask = { ...task };
      updatedTask.status = task.status === 'completed' ? 'notStarted' : 'completed';
      
      emit('update-task', props.selectedList.id, task.id, updatedTask);
      hideTaskMenu();
    };
    
    // 显示任务菜单
    const showTaskMenu = (task, event) => {
      // 防止冒泡
      event.stopPropagation();
      
      // 设置菜单位置和任务
      activeTaskMenu.value = {
        task,
        x: event.clientX,
        y: event.clientY
      };
      
      // 添加点击事件监听器以关闭菜单
      document.addEventListener('click', hideTaskMenu, { once: true });
    };
    
    // 隐藏任务菜单
    const hideTaskMenu = () => {
      activeTaskMenu.value = null;
    };
    
    // 开始编辑任务
    const startEditTask = (task) => {
      editTaskModal.value = {
        visible: true,
        isNew: false,
        task: { ...task },
        dueDate: task.dueDateTime ? new Date(task.dueDateTime).toISOString().slice(0, 16) : ''
      };
      hideTaskMenu();
    };
    
    // 编辑任务
    const editTask = (task) => {
      startEditTask(task);
    };
    
    // 保存任务编辑
    const saveTaskEdit = () => {
      const updatedTask = { ...editTaskModal.value.task };
      
      // 处理截止日期
      if (editTaskModal.value.dueDate) {
        updatedTask.dueDateTime = new Date(editTaskModal.value.dueDate).toISOString();
      } else {
        updatedTask.dueDateTime = null;
      }
      
      emit('update-task', props.selectedList.id, updatedTask.id, updatedTask);
      cancelEditTask();
    };
    
    // 取消编辑任务
    const cancelEditTask = () => {
      editTaskModal.value.visible = false;
    };
    
    // 删除任务
    const deleteTask = (task) => {
      if (confirm(`确定要删除任务 "${task.title}" 吗？`)) {
        emit('delete-task', props.selectedList.id, task.id);
      }
      hideTaskMenu();
    };
    
    // 显示添加子任务表单
    const showAddSubtaskForm = (parentTask) => {
      addSubtaskModal.value = {
        visible: true,
        parentTaskId: parentTask.id,
        title: ''
      };
      hideTaskMenu();
    };
    
    // 保存子任务
    const saveSubtask = () => {
      const { parentTaskId, title } = addSubtaskModal.value;
      if (title.trim()) {
        emit('add-subtask', props.selectedList.id, parentTaskId, title.trim());
        cancelAddSubtask();
      }
    };
    
    // 取消添加子任务
    const cancelAddSubtask = () => {
      addSubtaskModal.value.visible = false;
    };
    
    return {
      filteredTasks,
      searchText,
      newTaskTitle,
      activeTaskMenu,
      menuPosition,
      editTaskModal,
      addSubtaskModal,
      selectList,
      createTask,
      toggleTaskStatus,
      showTaskMenu,
      startEditTask,
      editTask,
      saveTaskEdit,
      cancelEditTask,
      deleteTask,
      showAddSubtaskForm,
      saveSubtask,
      cancelAddSubtask,
      handleDragChange
    };
  }
};
</script>

<style scoped>
.todo-tree {
  display: flex;
  height: 100%;
  position: relative;
}

.tree-container {
  display: flex;
  width: 100%;
  height: 100%;
}

/* 任务列表样式 */
.task-lists {
  width: 250px;
  background-color: #f5f5f5;
  padding: 15px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
}

.task-list {
  padding: 12px 15px;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: #ffd6e7;
}

.task-list.active {
  background-color: #ff69b4;
  color: white;
}

.task-list:hover:not(.active) {
  background-color: #ffb6c1;
}

.list-content {
  display: flex;
  align-items: center;
}

.list-title {
  font-weight: 500;
  font-size: 16px;
}

.add-list {
  background-color: #f0f0f0;
  border: 1px dashed #ccc;
}

.add-list:hover {
  background-color: #e5e5e5;
}

.add-icon {
  font-size: 16px;
  margin-right: 5px;
  font-weight: bold;
}

/* 任务树视图样式 */
.task-tree-view {
  flex: 1;
  padding: 15px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.task-search {
  margin-bottom: 15px;
}

.search-input {
  width: 100%;
  padding: 10px 15px;
  border-radius: 20px;
  border: 1px solid #ddd;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease;
}

.search-input:focus {
  border-color: #ff69b4;
}

.tree-structure {
  flex: 1;
}

.new-task-node {
  margin-bottom: 20px;
}

.new-task-input-container {
  display: flex;
  border-radius: 8px;
  border: 1px solid #ddd;
  overflow: hidden;
}

.new-task-input {
  flex: 1;
  padding: 12px 15px;
  border: none;
  outline: none;
  font-size: 14px;
}

.action-button {
  border: none;
  background-color: #ff69b4;
  color: white;
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.action-button:hover {
  background-color: #ff5ba7;
}

.action-button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

/* 拖拽样式 */
.ghost-task {
  opacity: 0.5;
  background: #c8ebfb;
}

.chosen-task {
  background-color: #ffeef6;
}

/* 任务菜单样式 */
.task-menu {
  position: fixed;
  z-index: 1000;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  min-width: 160px;
  overflow: hidden;
}

.menu-item {
  padding: 10px 15px;
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.menu-item:hover {
  background-color: #f5f5f5;
}

.menu-item svg {
  margin-right: 8px;
}

.menu-item.edit {
  color: #007bff;
}

.menu-item.delete {
  color: #dc3545;
}

.menu-item.add-subtask {
  color: #28a745;
}

.menu-item.complete-task {
  color: #6c757d;
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