import { type BlockCache, type DataAdapter, type Editor, type EditorPosition, MarkdownView } from 'obsidian';
import { ObsidianTodoTask } from 'src/model/obsidianTodoTask.js';
import { type TodoTask } from '@microsoft/microsoft-graph-types';
import { type SettingsManager } from 'src/utils/settingsManager.js';
import type MsTodoSync from '../main.js';
import { TasksDeltaCollection, type TodoApi } from '../api/todoApi.js';
import { type IMsTodoSyncSettings } from '../gui/msTodoSyncSettingTab.js';
import { t } from '../lib/lang.js';
import { log, logging } from '../lib/logging.js';
import { UserNotice } from 'src/lib/userNotice.js';

const userNotice = new UserNotice();

export function getTaskIdFromLine(line: string, plugin: MsTodoSync): string {
    const regex = /\^(?!.*\^)([A-Za-z\d]+)/gm;
    const blocklistMatch = regex.exec(line.trim());
    if (blocklistMatch) {
        const blockLink = blocklistMatch[1];
        const taskId = plugin.settings.taskIdLookup[blockLink];
        console.log(taskId);
        return taskId;
    }

    return '';
}

interface ISelection {
    start: EditorPosition;
    end?: EditorPosition;
    lines: number[];
}

/**
 * Retrieves the current lines from the editor based on the cursor position or selection.
 *
 * @param editor - The editor instance from which to get the current lines.
 * @returns A promise that resolves to a Selection object containing:
 * - `start`: The starting position of the cursor or selection.
 * - `end`: The ending position of the cursor or selection.
 * - `lines`: An array of line numbers that are currently selected or where the cursor is located.
 */
export async function getCurrentLinesFromEditor(editor: Editor): Promise<ISelection> {
    log('info', 'Getting current lines from editor', {
        from: editor.getCursor('from'),
        to: editor.getCursor('to'),
        anchor: editor.getCursor('anchor'),
        head: editor.getCursor('head'),
        general: editor.getCursor(),
    });

    // Const activeFile = this.app.workspace.getActiveFile();
    // const source = await this.app.vault.read(activeFile);

    let start: EditorPosition;
    let end: EditorPosition;
    // Let lines: string[] = [];
    let lines: number[] = [];
    if (editor.somethingSelected()) {
        start = editor.getCursor('from');
        end = editor.getCursor('to');
        // Lines = source.split('\n').slice(start.line, end.line + 1);
        lines = Array.from({ length: end.line + 1 - start.line }, (v, k) => k + start.line);
    } else {
        start = editor.getCursor();
        end = editor.getCursor();
        // Lines = source.split('\n').slice(start.line, end.line + 1);
        lines.push(start.line);
    }

    return {
        start,
        end,
        lines,
    };
}

export async function cleanupCachedTaskIds(plugin: MsTodoSync) {
    const logger = logging.getLogger('mstodo-sync.command.lookupPluginBlocks');

    // Collect all the blocks and ids from the metadata cache under the app.
    const blockCache: Record<string, BlockCache> = populateBlockCache(plugin);

    // Iterate over all the internal cached task ids in settings. If the block is not found in the metadata cache
    // we will log it. The cache is a metadata hash and block id as block ids can be reused across pages.
    for (const blockId in plugin.settings.taskIdLookup) {
        if (Object.hasOwn(plugin.settings.taskIdLookup, blockId)) {
            // Check if the block is in the metadata cache.
            let found = false;
            let block;
            for (const key in blockCache) {
                if (key.includes(blockId.toLowerCase())) {
                    found = true;
                    block = blockCache[key];
                }
            }

            if (found) {
                logger.info(`Block found in metadata cache: ${blockId}`, block);
            } else {
                logger.info(`Block not found in metadata cache: ${blockId}`);
                // Clean up the block id from the settings.
                delete plugin.settings.taskIdLookup[blockId];
                await plugin.settingsManager.saveSettings();
            }
        }
    }

    logger.info('blockCache', blockCache);
}

/**
 * This will find all block references across all files.
 *
 * @param {MsTodoSync} plugin
 * @return {*}  {Record<string, BlockCache>}
 */
function populateBlockCache(plugin: MsTodoSync): Record<string, BlockCache> {
    const blockCache: Record<string, BlockCache> = {};
    const internalMetadataCache = plugin.app.metadataCache.metadataCache;
    for (const cacheKey in internalMetadataCache) {
        if (Object.hasOwn(internalMetadataCache, cacheKey) && internalMetadataCache[cacheKey].blocks) {
            const blocksCache = internalMetadataCache[cacheKey].blocks;
            for (const blockKey in blocksCache) {
                if (Object.hasOwn(internalMetadataCache, cacheKey)) {
                    const block = blocksCache[blockKey];
                    blockCache[`${cacheKey}-${blockKey}`] = block;
                }
            }
        }
    }

    return blockCache;
}

/**
 * Posts tasks to Microsoft To Do from the selected lines in the editor.
 *
 * @param todoApi - The TodoApi instance used to interact with Microsoft To Do.
 * @param listId - The ID of the list where the tasks will be posted. If undefined, a notice will be shown to set the list name.
 * @param editor - The editor instance from which the tasks will be extracted.
 * @param fileName - The name of the file being edited. If undefined, an empty string will be used.
 * @param plugin - The MsTodoSync plugin instance.
 * @param replace - Optional. If true, the original tasks in the editor will be replaced with the new tasks. Defaults to false.
 *
 * @returns A promise that resolves when the tasks have been posted and the file has been modified.
 */
export async function postTask(
    todoApi: TodoApi,
    listId: string | undefined,
    editor: Editor,
    fileName: string | undefined,
    plugin: MsTodoSync,
    replace?: boolean,
) {
    const logger = logging.getLogger('mstodo-sync.command.post');

    // 如果没有 listId 但有 listName，则尝试查找并设置 listId
    if (!listId && plugin.settings.todoListSync?.listName) {
        logger.info(`listId is empty, attempting to find it using listName: ${plugin.settings.todoListSync.listName}`);
        listId = await todoApi.getListIdByName(plugin.settings.todoListSync.listName);
        
        // 如果找到了 listId，更新设置
        if (listId) {
            logger.info(`Found listId: ${listId} for listName: ${plugin.settings.todoListSync.listName}`);
            plugin.settings.todoListSync.listId = listId;
            await plugin.saveSettings();
        }
    }

    if (!listId) {
        userNotice.showMessage(t('CommandNotice_SetListName'));
        return;
    }

    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile === null) {
        return;
    }

    userNotice.showMessage(t('CommandNotice_CreatingToDo'), 3000);

    const source = await plugin.app.vault.read(activeFile);
    const { lines } = await getCurrentLinesFromEditor(editor);

    // Single call to update the cache using the delta link.
    await getTaskDelta(todoApi, listId, plugin);

    const split = source.split('\n');
    const modifiedPage = await Promise.all(
        split.map(async (line: string, index: number) => {
            // If the line is not in the selection, return the line as is.
            if (!lines.includes(index)) {
                return line;
            }

            // Create the to do task from the line that is in the selection.
            const todo = new ObsidianTodoTask(plugin.settingsManager, line);

            // If there is a block link in the line, we will try to find
            // the task id from the block link and update the task instead.
            // As a user can add a block link, not all tasks will be able to
            // lookup a id from the internal cache.
            if (todo.hasBlockLink && todo.hasId) {
                logger.debug(`Updating Task: ${todo.title}`);

                // Check for linked resource and update if there otherwise create.
                const cachedTasksDelta = await getDeltaCache(plugin);
                const cachedTask = cachedTasksDelta?.allTasks.find((task) => task.id === todo.id);
                if (cachedTask) {
                    const linkedResource = cachedTask.linkedResources?.first();
                    if (linkedResource && linkedResource.id) {
                        await todoApi.updateLinkedResource(
                            listId,
                            todo.id,
                            linkedResource.id,
                            todo.blockLink ?? '',
                            todo.getRedirectUrl(),
                        );
                    } else {
                        await todoApi.createLinkedResource(
                            listId,
                            todo.id,
                            todo.blockLink ?? '',
                            todo.getRedirectUrl(),
                        );
                    }
                }

                todo.linkedResources = cachedTask?.linkedResources;

                const returnedTask = await todoApi.updateTaskFromToDo(listId, todo.id, todo.getTodoTask());
                logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`);
                logger.debug(`updated: ${returnedTask.id}`);
            } else {
                logger.debug(`Creating Task: ${todo.title}`);
                logger.debug(`Creating Task: ${listId}`);

                const returnedTask = await todoApi.createTaskFromToDo(listId, todo.getTodoTask());

                todo.status = returnedTask.status;
                await todo.cacheTaskId(returnedTask.id ?? '');
                logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`, todo);
            }

            // If false there will be a orphaned block id for this task.
            if (replace) {
                return todo.getMarkdownTask(true);
            }

            return line;
        }),
    );

    await plugin.app.vault.modify(activeFile, modifiedPage.join('\n'));
}

export async function getTask(
    todoApi: TodoApi,
    listId: string | undefined,
    editor: Editor,
    fileName: string | undefined,
    plugin: MsTodoSync,
) {
    const logger = logging.getLogger('mstodo-sync.command.get');

    // 如果没有 listId 但有 listName，则尝试查找并设置 listId
    if (!listId && plugin.settings.todoListSync?.listName) {
        logger.info(`listId is empty, attempting to find it using listName: ${plugin.settings.todoListSync.listName}`);
        listId = await todoApi.getListIdByName(plugin.settings.todoListSync.listName);
        
        // 如果找到了 listId，更新设置
        if (listId) {
            logger.info(`Found listId: ${listId} for listName: ${plugin.settings.todoListSync.listName}`);
            plugin.settings.todoListSync.listId = listId;
            await plugin.saveSettings();
        }
    }

    if (!listId) {
        userNotice.showMessage(t('CommandNotice_SetListName'));
        return;
    }

    const activeFile = plugin.app.workspace.getActiveFile();
    if (activeFile === null) {
        return;
    }

    userNotice.showMessage(t('CommandNotice_GettingToDo'), 3000);

    try {
        const source = await plugin.app.vault.read(activeFile);
        const { lines } = await getCurrentLinesFromEditor(editor);

        // 更新任务缓存
        try {
            await getTaskDelta(todoApi, listId, plugin, false);
            logger.info('Task cache updated successfully');
        } catch (error) {
            logger.error('Error updating task delta:', error);
        }
        
        const split = source.split('\n');
        const modifiedPage = await Promise.all(
            split.map(async (line: string, index: number) => {
                // If the line is not in the selection, return the line as is.
                if (!lines.includes(index)) {
                    return line;
                }

                // Create the to do task from the line that is in the selection.
                const todo = new ObsidianTodoTask(plugin.settingsManager, line);

                // 如果有区块链接和任务ID，尝试直接从API获取最新任务状态
                if (todo.hasBlockLink && todo.hasId) {
                    logger.info(`Fetching latest state for task: ${todo.title} (ID: ${todo.id})`);
                    
                    try {
                        // 直接从API获取最新任务状态，而不是依赖缓存
                        const remoteTask = await todoApi.getTask(listId, todo.id);
                        
                        if (remoteTask) {
                            logger.info(`Retrieved task from API: ${remoteTask.title} (Status: ${remoteTask.status})`);
                            todo.updateFromTodoTask(remoteTask);
                            return todo.getMarkdownTask(true);
                        } else {
                            logger.warn(`Task not found in remote: ${todo.id}`);
                            // 如果API未返回任务，尝试从缓存获取
                            return await tryGetFromCache(todo, plugin, logger);
                        }
                    } catch (error) {
                        logger.error(`Error getting task from API: ${error instanceof Error ? error.message : String(error)}`);
                        // 如果API查询失败，尝试从缓存获取
                        return await tryGetFromCache(todo, plugin, logger);
                    }
                }
                
                return line;
            }),
        );

        await plugin.app.vault.modify(activeFile, modifiedPage.join('\n'));
        logger.info('Task update completed successfully');
    } catch (error) {
        logger.error('Error in getTask:', error);
        userNotice.showMessage('处理任务时出错: ' + (error instanceof Error ? error.message : String(error)));
    }
}

// 尝试从缓存中获取任务信息的辅助函数
async function tryGetFromCache(
    todo: ObsidianTodoTask, 
    plugin: MsTodoSync, 
    logger: {
        info: (message: string, ...args: any[]) => void;
        warn: (message: string, ...args: any[]) => void;
        error: (message: string, ...args: any[]) => void;
        debug: (message: string, ...args: any[]) => void;
    }
): Promise<string> {
    logger.info(`Attempting to get task from cache: ${todo.id}`);
    const cachedTasksDelta = await getDeltaCache(plugin);
    
    if (!cachedTasksDelta) {
        logger.warn('No task cache available');
        return todo.getMarkdownTask(true); // 返回原始任务
    }
    
    // 遍历所有列表查找任务
    if (cachedTasksDelta && typeof cachedTasksDelta === 'object' && 'allLists' in cachedTasksDelta && Array.isArray(cachedTasksDelta.allLists)) {
        for (const list of cachedTasksDelta.allLists) {
            if (!list || !Array.isArray(list.allTasks)) continue;
            
            const foundTask = list.allTasks.find((task: TodoTask) => task && task.id === todo.id);
            if (foundTask) {
                logger.info(`Found task in cache: ${foundTask.title} (Status: ${foundTask.status})`);
                todo.updateFromTodoTask(foundTask);
                break;
            }
        }
    } else if (cachedTasksDelta && Array.isArray(cachedTasksDelta.allTasks)) {
        // 如果缓存结构是扁平的任务列表
        const foundTask = cachedTasksDelta.allTasks.find((task: TodoTask) => task && task.id === todo.id);
        if (foundTask) {
            logger.info(`Found task in flat cache: ${foundTask.title} (Status: ${foundTask.status})`);
            todo.updateFromTodoTask(foundTask);
        }
    }
    
    return todo.getMarkdownTask(true);
}

async function getDeltaCache(plugin: MsTodoSync) {
    // 使用与 msToDoActions.ts 相同的缓存路径格式
    const pluginId = plugin.manifest.id;
    const cachePath = `${plugin.app.vault.configDir}/plugins/${pluginId}/mstd-tasks-delta.json`;
    const adapter: DataAdapter = plugin.app.vault.adapter;
    let cachedTasksDelta: TasksDeltaCollection | undefined;

    if (await adapter.exists(cachePath)) {
        cachedTasksDelta = JSON.parse(await adapter.read(cachePath)) as TasksDeltaCollection;
    }

    return cachedTasksDelta;
}

export async function getTaskDelta(todoApi: TodoApi, listId: string | undefined, plugin: MsTodoSync, reset = false) {
    const logger = logging.getLogger('mstodo-sync.command.delta');

    try {
        // 如果没有 listId 但有 listName，则尝试查找并设置 listId
        if (!listId && plugin.settings?.todoListSync?.listName) {
            logger.info(`listId is empty, attempting to find it using listName: ${plugin.settings.todoListSync.listName}`);
            try {
                listId = await todoApi.getListIdByName(plugin.settings.todoListSync.listName);
                
                // 如果找到了 listId，更新设置
                if (listId) {
                    logger.info(`Found listId: ${listId} for listName: ${plugin.settings.todoListSync.listName}`);
                    plugin.settings.todoListSync.listId = listId;
                    await plugin.saveSettings();
                }
            } catch (error) {
                logger.error('Error finding list ID by name:', error);
            }
        }

        if (!listId) {
            userNotice.showMessage(t('CommandNotice_SetListName'));
            return;
        }

        // 使用与 msToDoActions.ts 相同的缓存路径格式
        const pluginId = plugin.manifest.id;
        const cachePath = `${plugin.app.vault.configDir}/plugins/${pluginId}/mstd-tasks-delta.json`;
        const adapter: DataAdapter = plugin.app.vault.adapter;
        
        // 如果指定重置或缓存路径不存在，则删除缓存
        if (reset && await adapter.exists(cachePath)) {
            try {
                await adapter.remove(cachePath);
                logger.info('Cache reset successfully');
            } catch (error) {
                logger.error('Failed to reset cache:', error);
            }
        }

        // 获取缓存
        let cachedTasksDelta;
        try {
            if (await adapter.exists(cachePath)) {
                const cacheContent = await adapter.read(cachePath);
                cachedTasksDelta = JSON.parse(cacheContent);
                logger.info('Cache loaded successfully');
            }
        } catch (error) {
            logger.error('Failed to load cache:', error);
        }

        // 设置默认值
        let deltaLink = '';

        // 如果缓存存在并且有 deltaLink，则使用它
        if (cachedTasksDelta && typeof cachedTasksDelta.deltaLink === 'string') {
            deltaLink = cachedTasksDelta.deltaLink;
        }

        // 如果没有有效的缓存，创建一个新的 TasksDeltaCollection
        if (!cachedTasksDelta) {
            cachedTasksDelta = new TasksDeltaCollection([], '', '', '');
            logger.info('Created new cache object');
        }

        // 确保 cachedTasksDelta.allTasks 存在
        if (!Array.isArray(cachedTasksDelta.allTasks)) {
            cachedTasksDelta.allTasks = [];
            logger.warn('Initialized empty allTasks array in cache');
        }

        // 确保 listId 是有效的字符串
        if (!listId || typeof listId !== 'string') {
            logger.error(`Invalid listId: ${String(listId)}. Expected a non-empty string.`);
            userNotice.showMessage('Invalid list ID format');
            return cachedTasksDelta;
        }

        // 调用 API
        logger.info(`Calling getTasksDelta with listId: ${listId}, deltaLink: ${deltaLink ? '(has value)' : '(empty)'}`);
        
        let returnedTask;
        try {
            returnedTask = await todoApi.getTasksDelta(listId, deltaLink || '');
            logger.info('API call successful');
        } catch (error) {
            logger.error('API call failed:', error);
            userNotice.showMessage('无法获取任务更新，请检查网络连接');
            return cachedTasksDelta;
        }

        // 确保 returnedTask 有有效的结构
        if (!returnedTask) {
            logger.error('No response from API');
            return cachedTasksDelta;
        }

        // 确保 returnedTask.allTasks 存在
        if (!Array.isArray(returnedTask.allTasks)) {
            logger.error('Invalid response: allTasks is not an array');
            return cachedTasksDelta;
        }

        const oldTasksCount = cachedTasksDelta.allTasks.length;
        const newTasksCount = returnedTask.allTasks.length;
        
        logger.info(`Merging tasks - Old tasks: ${oldTasksCount}, New tasks: ${newTasksCount}`);
        
        // 合并任务
        cachedTasksDelta.allTasks = mergeCollections(
            cachedTasksDelta.allTasks || [],
            returnedTask.allTasks || []
        );
        
        // 更新 deltaLink
        if (returnedTask.deltaLink) {
            cachedTasksDelta.deltaLink = returnedTask.deltaLink;
        }

        // 保存更新后的缓存
        try {
            await adapter.write(cachePath, JSON.stringify(cachedTasksDelta));
            logger.info('Cache updated successfully');
        } catch (error) {
            logger.error('Failed to write cache:', error);
        }

        return cachedTasksDelta;
    } catch (error) {
        logger.error('Unexpected error in getTaskDelta:', error);
        userNotice.showMessage('处理任务数据时发生错误');
        return new TasksDeltaCollection([], '', '', '');
    }
}

// Function to merge collections
function mergeCollections(col1: TodoTask[], col2: TodoTask[]): TodoTask[] {
    const map = new Map<string, TodoTask>();

    // Helper function to add items to the map
    function addToMap(item: TodoTask) {
        if (item.id && item.lastModifiedDateTime) {
            const existingItem = map.get(item.id);
            // If there is no last modified then just use the current item.
            if (
                !existingItem ||
                new Date(item.lastModifiedDateTime) > new Date(existingItem.lastModifiedDateTime ?? 0)
            ) {
                map.set(item.id, item);
            }
        }
    }

    // Add items from both collections to the map
    for (const item of col1) {
        addToMap(item);
    }

    for (const item of col2) {
        addToMap(item);
    }

    // Convert map values back to an array
    return Array.from(map.values());
}

// Experimental
// Should handle the following cases:
// - [ ] Task
// - [ ] Task with indented note
//   note
// - [ ] Task with subtasks
//   - [ ] Task One
//   - [ ] Task Two
// - [ ] Task with subtasks and notes
//   Need to think about this one. Perhaps a task 3?
//   - [ ] Task One
//   - [ ] Task Two
// Lines are processed until the next line is blank or not indented by two spaces.
// Also EOF will stop processing.
// Allow variable depth or match column of first [
export async function postTaskAndChildren(
    todoApi: TodoApi,
    listId: string | undefined,
    editor: Editor,
    fileName: string | undefined,
    plugin: MsTodoSync,
    push = true,
) {
    const logger = logging.getLogger('mstodo-sync.command.post');

    // 如果没有 listId 但有 listName，则尝试查找并设置 listId
    if (!listId && plugin.settings.todoListSync?.listName) {
        logger.info(`listId is empty, attempting to find it using listName: ${plugin.settings.todoListSync.listName}`);
        listId = await todoApi.getListIdByName(plugin.settings.todoListSync.listName);
        
        // 如果找到了 listId，更新设置
        if (listId) {
            logger.info(`Found listId: ${listId} for listName: ${plugin.settings.todoListSync.listName}`);
            plugin.settings.todoListSync.listId = listId;
            await plugin.saveSettings();
        }
    }

    if (!listId) {
        userNotice.showMessage(t('CommandNotice_SetListName'));
        return;
    }

    userNotice.showMessage(t('CommandNotice_CreatingToDo'), 3000);

    const cursorLocation = editor.getCursor();
    const topLevelTask = editor.getLine(cursorLocation.line);
    logger.debug(`topLevelTask: ${topLevelTask}`);
    // Logger.debug(`cursorLocation: ${cursorLocation.line}`, cursorLocation);

    let body = '';
    const childTasks: string[] = [];

    // Get all lines including the line the cursor is on.
    const lines = editor.getValue().split('\n').slice(cursorLocation.line);
    // Logger.debug(`editor: ${cursorLocation}`, lines);

    // Find the end of section which a blank line or a line that is not indented by two spaces.
    const endLine = lines.findIndex(
        // (line, index) => !/[ ]{2,}- \[(.)\]/.test(line) && !line.startsWith('  ') && index > 0,
        (line, index) => line.length === 0 && index > 0,
    );
    logger.debug(`endLine: ${endLine}`);

    // Scan lines below task for sub tasks and body.
    for (const [index, line] of lines.slice(1, endLine).entries()) {
        // Logger.debug(`processing line: ${index} -- ${line}`);

        if (line.startsWith('  - [')) {
            childTasks.push(line.trim());
        } else {
            // Remove the two spaces at the beginning of the line, will be added back on sync.
            // on sync the body will be indented by two spaces and the tasks will be appended at this point.
            body += line.trim() + '\n';
        }
    }

    logger.debug(`body: ${body}`);
    logger.debug(`childTasks: ${childTasks}`, childTasks);

    const todo = new ObsidianTodoTask(plugin.settingsManager, topLevelTask);
    todo.setBody(body);
    for (const childTask of childTasks) {
        todo.addChecklistItem(childTask);
    }

    logger.debug(`updated: ${todo.title}`, todo);

    if (todo.hasBlockLink && todo.id) {
        logger.debug(`Updating Task: ${todo.title}`, todo.getTodoTask());

        // Const currentTaskState = await todoApi.getTask(listId, todo.id);
        let returnedTask;
        if (push) {
            returnedTask = await todoApi.updateTaskFromToDo(listId, todo.id, todo.getTodoTask());
            // Push the checklist items...
            todo.checklistItems = returnedTask.checklistItems;
            todo.status = returnedTask.status;
            todo.body = returnedTask.body;
        } else {
            returnedTask = await todoApi.getTask(listId, todo.id);
            if (returnedTask) {
                todo.checklistItems = returnedTask.checklistItems;
                todo.status = returnedTask.status;
                todo.body = returnedTask.body;
            }
        }

        logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`);
        logger.debug(`updated: ${returnedTask?.id}`, returnedTask);
    } else {
        logger.debug(`Creating Task: ${todo.title}`);

        const returnedTask = await todoApi.createTaskFromToDo(listId, todo.getTodoTask(true));

        todo.status = returnedTask.status;
        await todo.cacheTaskId(returnedTask.id ?? '');
        logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`, todo);
    }

    // Update the task on the page.
    const start = getLineStartPos(cursorLocation.line);
    const end = getLineEndPos(cursorLocation.line + endLine, editor);

    editor.replaceRange(todo.getMarkdownTask(false), start, end);
}

function getLineStartPos(line: number): EditorPosition {
    return {
        line,
        ch: 0,
    };
}

function getLineEndPos(line: number, editor: Editor): EditorPosition {
    return {
        line,
        ch: editor.getLine(line).length,
    };
}

export async function getAllTasksInList(
    todoApi: TodoApi,
    listId: string | undefined,
    editor: Editor,
    plugin: MsTodoSync,
    withBody: boolean,
) {
    const now = globalThis.moment();
    const settings = plugin.settingsManager.settings;

    // 如果没有 listId 但有 listName，则尝试查找并设置 listId
    if (!listId && plugin.settings.todoListSync?.listName) {
        const logger = logging.getLogger('mstodo-sync.command.getAllTasksInList');
        logger.info(`listId is empty, attempting to find it using listName: ${plugin.settings.todoListSync.listName}`);
        listId = await todoApi.getListIdByName(plugin.settings.todoListSync.listName);
        
        // 如果找到了 listId，更新设置
        if (listId) {
            logger.info(`Found listId: ${listId} for listName: ${plugin.settings.todoListSync.listName}`);
            plugin.settings.todoListSync.listId = listId;
            await plugin.saveSettings();
        }
    }

    if (!listId) {
        userNotice.showMessage(t('CommandNotice_SetListName'));
        return;
    }

    // Single call to update the cache using the delta link.
    await getTaskDelta(todoApi, listId, plugin);
    const cachedTasksDelta = await getDeltaCache(plugin);

    if (!cachedTasksDelta) {
        userNotice.showMessage('No tasks found in cache');
        return;
    }

    // 修复: 从 ListsDeltaCollection 中正确获取任务
    // 首先找到匹配的列表
    const targetList = cachedTasksDelta.allLists?.find(list => list.listId === listId);
    if (!targetList) {
        userNotice.showMessage('List not found in cache');
        return;
    }

    // 对任务进行排序
    targetList.allTasks.sort((a, b) => (a.status === 'completed' ? 1 : -1));

    // 处理任务
    const lines = targetList.allTasks
        .filter((task) => task.status !== 'completed')
        .map((task) => {
            const formattedCreateDate = globalThis
                .moment(task.createdDateTime)
                .format(settings.displayOptions_DateFormat);
            const done = task.status === 'completed' ? 'x' : ' ';
            const createDate =
                formattedCreateDate === now.format(settings.displayOptions_DateFormat)
                    ? ''
                    : `${settings.displayOptions_TaskCreatedPrefix}[[${formattedCreateDate}]]`;

            let blockId = '';
            for (const key in settings.taskIdLookup) {
                if (Object.hasOwn(plugin.settings.taskIdLookup, key) && settings.taskIdLookup[key] === task.id) {
                    blockId = `^${key}`;
                }
            }

            if (blockId === '') {
                const newId = cacheTaskId(task.id ?? '', plugin.settingsManager);
                blockId = `^${newId}`;
            }

            if (task.body?.content && withBody) {
                // If the body has multiple lines then indent slightly on a new line.
                const bodyLines = task.body.content.split('\r\n');
                const newBody = bodyLines.map((line, index) => `  ${stripHtml(line).trimEnd()}`);
                return `- [${done}] ${task.title}  ${createDate} ${blockId}\n${newBody.join('\n')}`.trimEnd();
            }

            return `- [${done}] ${task.title}  ${createDate} ${blockId}`.trimEnd();
        });

    const allTasks = lines?.join('\n');

    if (editor) {
        editor.replaceSelection(allTasks ?? '');
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        view?.leaf.view.tree.setCollapseAll(true);

        // GetActiveViewOfType will return null if the active view is null, or if it's not a MarkdownView.
        if (view?.tree) {
            view.tree.setCollapseAll(true);
            // ...
        }
    }
}

/**
 * Cache the ID internally and generate block link.
 *
 * @param {string} [id]
 * @return {*}  {Promise<void>}
 * @memberof ObsidianTodoTask
 */
async function cacheTaskId(id: string, settingsManager: SettingsManager): Promise<string> {
    settingsManager.settings.taskIdIndex += 1;

    const index = `MSTD${Math.random().toString(20).slice(2, 6)}${settingsManager.settings.taskIdIndex
        .toString()
        .padStart(5, '0')}`;

    settingsManager.settings.taskIdLookup[index] = id ?? '';

    settingsManager.saveSettings().catch((error) => {
        console.error('Error saving settings', error);
    });

    return index;
}

function stripHtml(html: string): string {
    return html.replaceAll(/<[^>]*>/g, '');
}

export async function createTodayTasks(todoApi: TodoApi, settings: IMsTodoSyncSettings, editor?: Editor) {
    userNotice.showMessage('Getting Microsoft To Do tasks for today', 3000);
    const now = globalThis.moment();
    
    // 获取所有列表，不传递参数
    const taskLists = await todoApi.getLists();
    if (!taskLists || taskLists.length === 0) {
        userNotice.showMessage('Task list is empty');
        return;
    }
    
    // 创建后续处理任务的方式需要修改，因为 TodoTaskList 不包含任务信息
    // 需要为每个列表获取今天的任务
    const listsWithTasks = await Promise.all(
        taskLists.map(async (list) => {
            if (!list.id) return { ...list, tasks: [] };
            
            // 使用 getListTasks 并传递过滤条件
            const pattern = `status ne 'completed' or completedDateTime/dateTime ge '${now.format('yyyy-MM-DD')}'`;
            const tasks = await todoApi.getListTasks(list.id, pattern);
            return { 
                ...list, 
                tasks: tasks || [] 
            };
        })
    );

    const segments = listsWithTasks
        .map((taskList) => {
            if (!taskList.tasks || taskList.tasks.length === 0) {
                return;
            }

            taskList.tasks.sort((a, b) => (a.status === 'completed' ? 1 : -1));
            const lines = taskList.tasks?.map((task) => {
                const formattedCreateDate = globalThis
                    .moment(task.createdDateTime)
                    .format(settings.displayOptions_DateFormat);
                const done = task.status === 'completed' ? 'x' : ' ';
                const createDate =
                    formattedCreateDate === now.format(settings.displayOptions_DateFormat)
                        ? ''
                        : `${settings.displayOptions_TaskCreatedPrefix}[[${formattedCreateDate}]]`;
                const body = task.body?.content ? `${settings.displayOptions_TaskBodyPrefix}${task.body.content}` : '';

                return `- [${done}] ${task.title}  ${createDate}  ${body}`;
            });
            return `**${taskList.displayName}**
${lines?.join('\n')}
`;
        })
        .filter((s) => s != undefined)
        .join('\n\n');

    if (editor) {
        editor.replaceSelection(segments);
    } else {
        return segments;
    }
}
