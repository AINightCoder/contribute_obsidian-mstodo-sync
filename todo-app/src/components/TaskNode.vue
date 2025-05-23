<template>
  <div class="task-node" :class="{ 'completed': task.status === 'completed' }">
    <div class="task-node-content" 
      @click="handleTaskClick"
      @contextmenu.prevent="openTaskMenu">
      <div class="task-controls">
        <div class="task-checkbox" @click.stop="toggleStatus">
          <div class="checkbox" :class="{ 'checked': task.status === 'completed' }">
            <svg v-if="task.status === 'completed'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
              <path d="M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z" fill="currentColor"></path>
            </svg>
          </div>
        </div>
        <div class="task-title" 
          :class="{ 'editing': isEditing }"
          @dblclick="startEditing">
          <input 
            v-if="isEditing" 
            ref="titleInput"
            v-model="editedTitle" 
            @blur="saveEdit"
            @keyup.enter="saveEdit"
            @keyup.esc="cancelEdit"
            type="text"
            class="title-input"
          />
          <span v-else>{{ task.title }}</span>
          <span 
            v-if="task.dueDateTime" 
            class="due-date" 
            :class="{ 'overdue': isOverdue }">
            {{ formatDate(task.dueDateTime) }}
          </span>
        </div>
        <div class="task-actions">
          <button class="action-icon add-subtask-btn" @click.stop="$emit('add-subtask', task)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fill-rule="evenodd" d="M10 3a1 1 0 00-1 1v5H4a1 1 0 100 2h5v5a1 1 0 102 0v-5h5a1 1 0 100-2h-5V4a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
          </button>
          <button class="action-icon edit-btn" @click.stop="$emit('edit', task)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path>
            </svg>
          </button>
          <button class="action-icon delete-btn" @click.stop="$emit('delete', task)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
    
    <!-- 子任务 -->
    <div v-if="hasSubtasks" class="subtasks-container">
      <draggable 
        v-model="subtasks" 
        group="subtasks"
        item-key="id"
        :animation="150" 
        handle=".task-node-content"
        ghost-class="ghost-task"
        chosen-class="chosen-task"
        @change="handleSubtaskChange"
      >
        <template #item="{ element: subtask }">
          <div class="subtask-item">
            <div class="subtask-checkbox" @click.stop="toggleSubtaskStatus(subtask)">
              <div class="checkbox small" :class="{ 'checked': subtask.isChecked || subtask.isCompleted }">
                <svg v-if="subtask.isChecked || subtask.isCompleted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12">
                  <path d="M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z" fill="currentColor"></path>
                </svg>
              </div>
            </div>
            <div
              class="subtask-title"
              :class="{ 'completed': subtask.isChecked || subtask.isCompleted, 'editing': subtask.editing }"
              @dblclick="startSubtaskEditing(subtask)"
            >
              <input 
                v-if="subtask.editing" 
                :ref="'subtask_' + subtask.id"
                v-model="subtask.editedTitle" 
                @blur="saveSubtaskEdit(subtask)"
                @keyup.enter="saveSubtaskEdit(subtask)"
                @keyup.esc="cancelSubtaskEdit(subtask)"
                type="text"
                class="title-input small"
              />
              <span v-else>{{ subtask.displayName || subtask.title }}</span>
            </div>
            <div class="subtask-actions">
              <button class="action-icon small delete-btn" @click.stop="deleteSubtask(subtask)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                </svg>
              </button>
            </div>
          </div>
        </template>
      </draggable>
      
      <!-- 添加子任务按钮 -->
      <div class="add-subtask-button" @click.stop="$emit('add-subtask', task)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path fill-rule="evenodd" d="M10 3a1 1 0 00-1 1v5H4a1 1 0 100 2h5v5a1 1 0 102 0v-5h5a1 1 0 100-2h-5V4a1 1 0 00-1-1z" clip-rule="evenodd"></path>
        </svg>
        <span>添加子任务</span>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import draggable from 'vuedraggable';
import todoApi from '../services/api';

export default {
  name: 'TaskNode',
  
  components: {
    draggable
  },
  
  props: {
    task: {
      type: Object,
      required: true
    },
    listId: {
      type: String,
      required: true
    }
  },
  
  emits: ['toggle-status', 'edit', 'delete', 'add-subtask'],
  
  setup(props, { emit }) {
    // 编辑状态
    const isEditing = ref(false);
    const editedTitle = ref('');
    const titleInput = ref(null);
    
    // 子任务状态
    const subtasks = ref([]);
    
    // 初始化子任务
    const initSubtasks = () => {
      if (props.task.checklistItems && props.task.checklistItems.length > 0) {
        // 为每个子任务添加编辑状态
        subtasks.value = props.task.checklistItems.map(item => ({
          ...item,
          editing: false,
          editedTitle: item.displayName || item.title || ''
        }));
      } else {
        subtasks.value = [];
      }
    };
    
    // 监听任务变化，更新子任务
    watch(() => props.task, () => {
      initSubtasks();
    }, { deep: true, immediate: true });
    
    // 计算属性：是否有子任务
    const hasSubtasks = computed(() => {
      return subtasks.value && subtasks.value.length > 0;
    });
    
    // 计算属性：是否逾期
    const isOverdue = computed(() => {
      if (!props.task.dueDateTime) return false;
      const dueDate = new Date(props.task.dueDateTime);
      return dueDate < new Date() && props.task.status !== 'completed';
    });
    
    // 日期格式化
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      const options = { month: 'short', day: 'numeric' };
      if (date.getFullYear() !== new Date().getFullYear()) {
        options.year = 'numeric';
      }
      const dateStr = date.toLocaleDateString('zh-CN', options);
      
      // 如果时间不是00:00，显示时间
      if (date.getHours() !== 0 || date.getMinutes() !== 0) {
        return `${dateStr} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      }
      return dateStr;
    };
    
    // 切换任务状态
    const toggleStatus = () => {
      emit('toggle-status', props.task);
    };
    
    // 处理任务点击事件
    const handleTaskClick = (event) => {
      // 如果不是编辑状态，可以展开/折叠
      if (!isEditing.value) {
        // 这里可以实现展开/折叠子任务的逻辑
      }
    };
    
    // 右键菜单事件
    const openTaskMenu = (event) => {
      emit('open-menu', props.task, event);
    };
    
    // 开始编辑任务
    const startEditing = () => {
      editedTitle.value = props.task.title;
      isEditing.value = true;
      nextTick(() => {
        titleInput.value.focus();
      });
    };
    
    // 保存编辑
    const saveEdit = () => {
      if (editedTitle.value.trim() !== props.task.title) {
        const updatedTask = { ...props.task, title: editedTitle.value.trim() };
        emit('edit', updatedTask);
      }
      isEditing.value = false;
    };
    
    // 取消编辑
    const cancelEdit = () => {
      editedTitle.value = props.task.title;
      isEditing.value = false;
    };
    
    // 处理子任务拖拽变化
    const handleSubtaskChange = (evt) => {
      console.log('子任务拖拽变化:', evt);
      // 这里可以更新后端数据
    };
    
    // 切换子任务状态
    const toggleSubtaskStatus = async (subtask) => {
      try {
        const isCompleted = subtask.isChecked || subtask.isCompleted;
        const updatedSubtask = { ...subtask, isChecked: !isCompleted, isCompleted: !isCompleted };
        
        // 更新子任务
        if (isCompleted) {
          await todoApi.tasks.uncompleteChecklistItem(props.listId, props.task.id, subtask.id);
        } else {
          await todoApi.tasks.completeChecklistItem(props.listId, props.task.id, subtask.id);
        }
        
        // 更新本地数据
        const index = subtasks.value.findIndex(item => item.id === subtask.id);
        if (index !== -1) {
          subtasks.value[index] = { 
            ...subtasks.value[index], 
            isChecked: !isCompleted, 
            isCompleted: !isCompleted 
          };
        }
      } catch (error) {
        console.error('切换子任务状态失败:', error);
      }
    };
    
    // 开始编辑子任务
    const startSubtaskEditing = (subtask) => {
      subtask.editing = true;
      subtask.editedTitle = subtask.displayName || subtask.title || '';
      
      nextTick(() => {
        const inputRef = 'subtask_' + subtask.id;
        if (inputRef) {
          document.querySelector(`input[ref="${inputRef}"]`)?.focus();
        }
      });
    };
    
    // 保存子任务编辑
    const saveSubtaskEdit = async (subtask) => {
      if (subtask.editedTitle.trim() !== (subtask.displayName || subtask.title)) {
        try {
          // 更新子任务
          await todoApi.tasks.updateChecklistItem(
            props.listId, 
            props.task.id, 
            subtask.id, 
            { title: subtask.editedTitle.trim() }
          );
          
          // 更新本地数据
          subtask.displayName = subtask.editedTitle.trim();
          subtask.title = subtask.editedTitle.trim();
        } catch (error) {
          console.error('保存子任务编辑失败:', error);
        }
      }
      
      subtask.editing = false;
    };
    
    // 取消子任务编辑
    const cancelSubtaskEdit = (subtask) => {
      subtask.editing = false;
      subtask.editedTitle = subtask.displayName || subtask.title || '';
    };
    
    // 删除子任务
    const deleteSubtask = async (subtask) => {
      if (confirm(`确定要删除子任务 "${subtask.displayName || subtask.title}" 吗？`)) {
        try {
          // 删除子任务
          await todoApi.tasks.deleteChecklistItem(props.listId, props.task.id, subtask.id);
          
          // 更新本地数据
          const index = subtasks.value.findIndex(item => item.id === subtask.id);
          if (index !== -1) {
            subtasks.value.splice(index, 1);
          }
        } catch (error) {
          console.error('删除子任务失败:', error);
        }
      }
    };
    
    // 组件挂载时初始化子任务
    onMounted(() => {
      initSubtasks();
    });
    
    return {
      isEditing,
      editedTitle,
      titleInput,
      subtasks,
      hasSubtasks,
      isOverdue,
      formatDate,
      toggleStatus,
      handleTaskClick,
      openTaskMenu,
      startEditing,
      saveEdit,
      cancelEdit,
      handleSubtaskChange,
      toggleSubtaskStatus,
      startSubtaskEditing,
      saveSubtaskEdit,
      cancelSubtaskEdit,
      deleteSubtask
    };
  }
};
</script>

<style scoped>
.task-node {
  margin-bottom: 10px;
  transition: all 0.2s ease;
}

.task-node-content {
  background-color: white;
  border-radius: 8px;
  padding: 12px 15px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.task-node-content:hover {
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

.task-node.completed .task-node-content {
  background-color: #f8f9fa;
}

.task-controls {
  display: flex;
  align-items: center;
}

.task-checkbox {
  margin-right: 12px;
  flex-shrink: 0;
}

.checkbox {
  width: 20px;
  height: 20px;
  border: 2px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.checkbox:hover {
  border-color: #ff69b4;
}

.checkbox.checked {
  border-color: #ff69b4;
  background-color: #ff69b4;
  color: white;
}

.checkbox.small {
  width: 16px;
  height: 16px;
  border-width: 1.5px;
}

.task-title {
  flex: 1;
  font-size: 15px;
  color: #333;
  position: relative;
  line-height: 1.4;
}

.task-node.completed .task-title {
  color: #999;
  text-decoration: line-through;
}

.due-date {
  display: inline-block;
  font-size: 12px;
  color: #666;
  margin-left: 8px;
  padding: 2px 6px;
  background-color: #f0f0f0;
  border-radius: 4px;
}

.due-date.overdue {
  color: #e53935;
  background-color: #ffebee;
}

.task-title.editing {
  padding: 0;
}

.title-input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid #ddd;
  outline: none;
  font-size: 15px;
  padding: 4px 0;
  color: #333;
}

.title-input.small {
  font-size: 14px;
}

.title-input:focus {
  border-bottom-color: #ff69b4;
}

.task-actions {
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.task-node-content:hover .task-actions {
  opacity: 1;
}

.action-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  margin-left: 4px;
  color: #666;
  transition: all 0.2s ease;
}

.action-icon:hover {
  background-color: #f0f0f0;
  color: #333;
}

.action-icon.small {
  width: 24px;
  height: 24px;
}

.action-icon.edit-btn:hover {
  color: #007bff;
}

.action-icon.delete-btn:hover {
  color: #dc3545;
}

.action-icon.add-subtask-btn:hover {
  color: #28a745;
}

/* 子任务样式 */
.subtasks-container {
  margin-left: 32px;
  margin-top: 8px;
  border-left: 1px dashed #ddd;
  padding-left: 12px;
}

.subtask-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  background-color: #f9f9f9;
  transition: all 0.2s ease;
}

.subtask-item:hover {
  background-color: #f0f0f0;
}

.subtask-checkbox {
  margin-right: 10px;
}

.subtask-title {
  flex: 1;
  font-size: 14px;
  color: #444;
}

.subtask-title.completed {
  color: #999;
  text-decoration: line-through;
}

.subtask-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.subtask-item:hover .subtask-actions {
  opacity: 1;
}

/* 添加子任务按钮 */
.add-subtask-button {
  display: flex;
  align-items: center;
  color: #666;
  font-size: 14px;
  margin-top: 6px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.add-subtask-button:hover {
  background-color: #f0f0f0;
  color: #ff69b4;
}

.add-subtask-button svg {
  margin-right: 6px;
}

/* 拖拽相关 */
.ghost-task {
  opacity: 0.5;
  background: #c8ebfb;
}

.chosen-task {
  background-color: #f0f0f0;
}
</style> 