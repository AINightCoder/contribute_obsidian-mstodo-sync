import { type BlockCache, type DataAdapter, type Editor, type EditorPosition, Platform } from 'obsidian';
import { type SettingsManager } from '../utils/settingsManager.js';
import type MsTodoSync from '../main.js';
import { type IMsTodoSyncSettings } from '../gui/msTodoSyncSettingTab.js';
import { UserNotice } from '../lib/userNotice.js';
import { logging } from '../lib/logging.js';
import { type TodoTask } from '@microsoft/microsoft-graph-types';
import { ListsDeltaCollection, TasksDeltaCollection, TodoApi } from '../api/todoApi.js';
import { t } from '../lib/lang.js';
import { ObsidianTodoTask } from '../model/obsidianTodoTask.js';

interface ISelection {
    start: EditorPosition;
    end?: EditorPosition;
    lines: number[];
}

export class MsTodoActions {
    private userNotice = new UserNotice();
    private readonly logger = logging.getLogger('mstodo-sync.MsTodoActions');
    private settings: IMsTodoSyncSettings;
    private todoApi: TodoApi;
    private plugin: MsTodoSync;
    private deltaCachePath: string;

    constructor(
        plugin: MsTodoSync,
        private settingsManager: SettingsManager,
        todoApi: TodoApi,
    ) {
        this.settings = settingsManager.settings;
        this.plugin = plugin;
        this.todoApi = todoApi;
        
        // 修改缓存路径为Obsidian根目录下的meta目录
        this.deltaCachePath = 'meta/mstd-tasks-delta.json';
        
        this.logger.info(`Initialized MsTodoActions with delta cache path: ${this.deltaCachePath}`);
        
        // 确保meta目录存在
        this.ensureMetaDirectoryExists();
    }

    /**
     * 确保meta目录存在，不存在则创建
     */
    private async ensureMetaDirectoryExists(): Promise<void> {
        try {
            const adapter = this.plugin.app.vault.adapter;
            const dirExists = await adapter.exists('meta');
            if (!dirExists) {
                // 创建meta目录
                await adapter.mkdir('meta');
                this.logger.info('Created meta directory in vault root');
            }
        } catch (error) {
            this.logger.error('Error ensuring meta directory exists:', error);
        }
    }

    /**
     * This will get all the task updates from Microsoft To Do, then get all the block references
     * that exist in the vault. It will then use the cache to update all the block references.
     * To ensure that the sync does not over write the following logic will be used.
     * If the modified time on the page is more recent than the remote task then the remote task will be updated.
     * If the remote task is more recent than the page then the local task will be updated.
     * If the remote task properties and the local task properties are the same then no update will occur.
     * If a local task is on one ore more pages then the most recently modified page will be
     * classed as the source of truth.
     */
    public async syncVault() {
        this.userNotice.showMessage(t('CommandNotice_SyncingVault'), 3000);
        // Get all the blocks in the vault.
        const blockCache = this.getAllVaultBlocks();

        this.logger.info(`Blocks found in vault: ${Object.keys(blockCache).length}`);

        // Get the local task that is most recent in the case there are duplicate IDs in the vault.
        // The key is in the format of cacheKey-blockId. So need to pull the blockId from the key.
        const pageContentCache: Record<string, string> = {};

        const localTasks: Record<
            string,
            { mtime: number; pageHash: string; pagePath: string; block: BlockCache; taskLine: string }
        > = {};
        for (const key in blockCache) {
            if (Object.hasOwn(blockCache, key)) {
                const internalPageHash = key.split('-')[0];
                const blockId = key.split('-')[1];
                // Get the mtime.
                const mtime = blockCache[key].mtime;
                const pagePath = blockCache[key].pagePath;
                let taskContent = '';
                if (!pageContentCache[pagePath]) {
                    this.logger.info(`Reading Page: ${pagePath}`);
                    const fileReference = this.plugin.app.vault.getFileByPath(pagePath);
                    if (fileReference) {
                        pageContentCache[pagePath] = await this.plugin.app.vault.read(fileReference);
                    }
                }
                if (pageContentCache[pagePath]) {
                    taskContent = pageContentCache[pagePath].slice(
                        blockCache[key].block.position.start.offset,
                        blockCache[key].block.position.end.offset,
                    );
                } else {
                    this.logger.info(`Page content not found: ${pagePath}`, { blockId, internalPageHash });
                }

                // If the localTasks contains the block id as key, check the value
                // and update if the mtime is more recent.
                if (localTasks[blockId] && localTasks[blockId].mtime < mtime) {
                    localTasks[blockId] = {
                        mtime,
                        pageHash: internalPageHash,
                        pagePath: blockCache[key].pagePath,
                        block: blockCache[key].block,
                        taskLine: taskContent,
                    };
                } else {
                    localTasks[blockId] = {
                        mtime,
                        pageHash: internalPageHash,
                        pagePath: blockCache[key].pagePath,
                        block: blockCache[key].block,
                        taskLine: taskContent,
                    };
                }
            }
        }

        this.logger.info(`Local Tasks: ${Object.keys(localTasks).length}`);

        // Get all the tasks from the cache.
        const cachedTasksDelta = await this.getTaskDelta();

        // If there are no tasks in the cache then return.
        if (!cachedTasksDelta) {
            return;
        }

        // Get sum of all tasks in all lists.
        const countOfAllTasks = cachedTasksDelta.allLists.reduce((acc, list) => acc + list.allTasks.length, 0);

        this.logger.info(`Remote Tasks: ${countOfAllTasks}`);
        this.logger.info(`Lookups in settings: ${Object.keys(this.plugin.settings.taskIdLookup).length}`);

        // Iterate over all the tasks in internal cache and update the block references.
        let updatedTasks = 0;
        for (const blockId in this.plugin.settings.taskIdLookup) {
            // For each of the cached block items get the taskId which is used int he remote
            // system. Then get the remote task from the cached list and finally the local task
            // from the vault that was collected above.

            const taskId = this.settingsManager.getTaskIdFromBlockId(blockId);

            // Check if the task exists in the remote or local cache
            const { list, task: cachedTask } = await this.getListAndTaskFromTaskId(taskId, true);
            const localTask = localTasks[blockId.toLowerCase()];

            if (!list || !cachedTask) {
                this.logger.info(`Task not found in remote cache: ${blockId} - ${taskId}`);
                continue;
            }

            if (!localTask) {
                this.logger.info(`Block not found in local tasks: ${blockId}`);
                continue;
            }

            const block = blockCache[`${localTasks[blockId.toLowerCase()].pageHash}-${blockId.toLowerCase()}`];
            //const vaultFileReference = this.plugin.app.vault.getFileByPath(localTask.pagePath);

            if (!block || !cachedTask || !localTask || !cachedTask.lastModifiedDateTime || !localTask.taskLine) {
                if (!block) {
                    this.logger.info(`Issue with finding block in vault for: ${blockId}`);
                }
                if (!cachedTask) {
                    this.logger.info(`Issue with finding remote task for: ${blockId}`);
                }
                if (!localTask) {
                    this.logger.info(`Issue with finding local task for: ${blockId}`);
                }
                if (!cachedTask.lastModifiedDateTime) {
                    this.logger.info(`Issue with finding remote task lastModifiedDateTime for: ${blockId}`);
                }
                if (!localTask.taskLine) {
                    this.logger.info(`Issue with finding local task taskLine for: ${blockId}`, localTask);
                }
                continue;
            }

            const localTaskNewer = new Date(cachedTask.lastModifiedDateTime) < new Date(localTask.mtime);

            // Get the string from the page using the start and end provided by the block.
            const taskContent = localTask.taskLine;
            const internalTask = new ObsidianTodoTask(this.settingsManager, taskContent);
            internalTask.id = taskId;

            // If all the properties match then no update will occur.
            if (internalTask.equals(cachedTask)) {
                continue;
            }

            this.logger.info('Checking Sync Direction', { blockId });

            // Now we need to check the following:
            // If the local task is more recent than the remote task then update the remote task.
            // If the remote task is more recent than the local task then update the local task.
            // If the remote task properties and the local task properties are the same then no update will occur.
            if (localTaskNewer) {
                // Update the remote task with the local task.
                this.logger.info(`Local Newer: ${blockId}`, { internalTask, cachedTask, localTask, taskContent });

                // Push local update to remote API.
                const returnedTask = await this.todoApi.updateTaskFromToDo(
                    list.listId,
                    internalTask.id,
                    internalTask.getTodoTask(),
                );
                this.logger.debug(`Updated Task last mod: ${returnedTask.lastModifiedDateTime}`);

                updatedTasks++;
            } else {
                // Remote version is newer, need to update vault.
                this.logger.info(`Remote Newer: ${blockId}`, { internalTask, cachedTask, localTask, taskContent });

                // Update local task and get new markdown to update page.
                internalTask.updateFromTodoTask(cachedTask);
                const updatedTask = internalTask.getMarkdownTask(true);

                const vaultFileReference = this.plugin.app.vault.getFileByPath(localTask.pagePath);
                if (vaultFileReference) {
                    await this.plugin.app.vault.process(vaultFileReference, (data) => {
                        const newPageContent = data.replace(taskContent, updatedTask);

                        this.logger.debug(`Updating Task ID: ${blockId}`, newPageContent);
                        return newPageContent;
                    });
                    updatedTasks++;
                }
            }
        }

        this.logger.info(`Updated Tasks: ${updatedTasks}`);
        this.userNotice.showMessage(t('CommandNotice_SyncComplete'), 3000);
        
        // 如果有设置任务摘要文件路径，则在同步完成后自动更新
        if (this.settings.taskSummaryFilePath) {
            try {
                await this.generateTaskSummary();
            } catch (error) {
                this.logger.error('Error updating task summary after sync:', error);
            }
        }
    }

    /**
     * Retrieves a specific task and its corresponding list from the cache based on the provided task ID.
     *
     * @param taskId - The ID of the task to retrieve.
     * @returns A promise that resolves to an object containing the list and task.
     *          If the task is not found, both properties will be `undefined`.
     */
    private async getListAndTaskFromTaskId(
        taskId: string,
        skipRemoteCheck = false,
    ): Promise<{ list: TasksDeltaCollection | undefined; task: TodoTask | undefined }> {
        // Get all the tasks from the cache.
        const cachedTasksDelta = await this.getTaskDelta(false, skipRemoteCheck);

        // If there are no tasks in the cache then return.
        if (!cachedTasksDelta) {
            return { list: undefined, task: undefined };
        }
        
        // 修复类型注解问题
        for (const list of (cachedTasksDelta as any).allLists) {
            const task = list.allTasks.find((t: any) => t.id === taskId);
            if (task) {
                return { list, task };
            }
        }

        return { list: undefined, task: undefined };
    }

    /**
     * Opens the task in Microsoft To Do based on the cursor location in the editor.
     * If the task ID is found in the current line, it will open the task details either
     * using the application protocol (if not on mobile and the setting is enabled) or
     * via the web URL.
     *
     * @param editor - The editor instance where the cursor is located.
     */
    public viewTaskInTodo(editor: Editor) {
        const cursorLocation = editor.getCursor();
        const line = editor.getLine(cursorLocation.line);
        const taskId = this.getTaskIdFromLine(line, this.plugin);
        if (taskId !== '') {
            if (!Platform.isMobile && this.settings.todo_OpenUsingApplicationProtocol) {
                window.open(`ms-todo://tasks/id/${taskId}/details`, '_blank');
            } else {
                window.open(`https://to-do.live.com/tasks/id/${taskId}/details`, '_blank');
            }
        }
    }

    /**
     * Cleans up cached task IDs by comparing them with the current metadata cache.
     *
     * This method performs the following steps:
     * 1. Collects all blocks and their IDs from the metadata cache.
     * 2. Iterates over all cached task IDs in the settings.
     * 3. Checks if each cached task ID exists in the metadata cache.
     * 4. Logs whether each task ID was found or not.
     * 5. Removes task IDs from the settings if they are not found in the metadata cache.
     * 6. Saves the updated settings if any task IDs were removed.
     *
     * @returns {Promise<void>} A promise that resolves when the cleanup process is complete.
     */
    public async cleanupCachedTaskIds(): Promise<void> {
        // Collect all the blocks and ids from the metadata cache under the app.
        const blockCache: Record<string, BlockCache> = this.populateBlockCache();

        // Iterate over all the internal cached task ids in settings. If the block is not found in the metadata cache
        // we will log it. The cache is a metadata hash and block id as block ids can be reused across pages.
        for (const blockId in this.settings.taskIdLookup) {
            if (Object.hasOwn(this.settings.taskIdLookup, blockId)) {
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
                    this.logger.info(`Block found in metadata cache: ${blockId}`, block);
                } else {
                    this.logger.info(`Block not found in metadata cache: ${blockId}`);
                    // Clean up the block id from the settings.
                    delete this.settings.taskIdLookup[blockId];
                    await this.settingsManager.saveSettings();
                }
            }
        }

        this.logger.info('blockCache', blockCache);
    }

    /**
     * This will find all block references across all files.
     *
     * @param {MsTodoSync} plugin
     * @return {*}  {Record<string, BlockCache>}
     */
    private populateBlockCache(): Record<string, BlockCache> {
        const blockCache: Record<string, BlockCache> = {};
        const internalMetadataCache = this.plugin.app.metadataCache.metadataCache;
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
     * Retrieves all blocks from the vault and returns them in a record format.
     *
     * @returns {Record<string, { mtime: number; pageHash: string; pagePath: string; block: BlockCache }>}
     * A record where each key is a combination of the page hash and block key, and the value is an object containing:
     * - `mtime`: The modification time of the file.
     * - `pageHash`: The hash of the page.
     * - `pagePath`: The path of the page.
     * - `block`: The block cache.
     */
    private getAllVaultBlocks(): Record<
        string,
        { mtime: number; pageHash: string; pagePath: string; block: BlockCache }
    > {
        const blockCache: Record<string, { mtime: number; pageHash: string; pagePath: string; block: BlockCache }> = {};
        const internalMetadataCache = this.plugin.app.metadataCache.metadataCache;
        for (const cacheKey in internalMetadataCache) {
            if (Object.hasOwn(internalMetadataCache, cacheKey) && internalMetadataCache[cacheKey].blocks) {
                const blocksCache = internalMetadataCache[cacheKey].blocks;
                const file = this.findBySubProperty(this.plugin.app.metadataCache.fileCache, 'hash', cacheKey);
                // this.logger.info(`getAllVaultBlocks - File:`, file);
                for (const blockKey in blocksCache) {
                    if (Object.hasOwn(internalMetadataCache, cacheKey)) {
                        const block = blocksCache[blockKey.toLowerCase()];
                        blockCache[`${cacheKey}-${blockKey.toLowerCase()}`] = {
                            mtime: file?.value.mtime ?? 0,
                            pageHash: cacheKey,
                            pagePath: file?.key ?? '',
                            block,
                        };
                    }
                }
            }
        }

        return blockCache;
    }

    /**
     * Finds an entry in a record by a specified sub-property and its value.
     *
     * @template T - The type of the record.
     * @template K - The type of the sub-property key.
     * @param {T} record - The record to search within.
     * @param {K} subProperty - The sub-property key to search by.
     * @param {T[keyof T][K]} value - The value of the sub-property to match.
     * @returns {{ key: string; value: T[keyof T] } | undefined} - The found entry as an object containing the key and value, or undefined if not found.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findBySubProperty<T extends Record<string, any>, K extends keyof T[keyof T]>(
        record: T,
        subProperty: K,
        subPropertyValue: T[keyof T][K],
    ): { key: string; value: T[keyof T] } | undefined {
        const entry = Object.entries(record).find(([_, value]) => value[subProperty] === subPropertyValue);
        return entry ? { key: entry[0], value: entry[1] } : undefined;
    }

    public async resetTasksCache() {
        this.logger.debug('Resetting Delta Cache');

        await this.getTaskDelta(true);
    }

    public async addMissingTasksToVault(editor?: Editor) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile === null) {
            return;
        }

        this.userNotice.showMessage(t('CommandNotice_AddingMissingTasks'), 3000);
        const cachedTasksDelta = await this.getTaskDelta();

        // cachedTasksDelta?.allLists.forEach((list) => {
        //     this.logger.info(`List: ${list.name}`);
        //     list.allTasks.forEach((task) => {
        //         this.logger.info(`Task: ${task.title}`, task);
        //     });
        // });

        // For each task in the cache, check if it exists in the vault.
        // If it does not, create a new block in the vault.
        let createdTasks = 0;
        let addedTasks = '';
        for (const list of cachedTasksDelta?.allLists ?? []) {
            for (const task of list?.allTasks ?? []) {
                if (task.status === 'completed') {
                    continue;
                }
                // Check if the task ID exists in the block cache.
                const blockId = task.id ? this.settingsManager.hasTaskId(task.id) : false;
                if (blockId) {
                    this.logger.debug(`Task already tracked in vault: ${list.name} - `, task.title);
                    continue;
                }
                this.logger.debug(`Block not found in vault: ${task.id}`, task.title);

                // Create a new block in the vault.
                const newTask = new ObsidianTodoTask(this.settingsManager, '');
                newTask.listId = list.listId;
                newTask.listName = list.name;
                newTask.updateFromTodoTask(task);
                newTask.cacheTaskId(task.id ?? '');
                addedTasks += `${newTask.getMarkdownTask(true)}\n`;
                this.logger.info(`Adding Task: ${newTask.getMarkdownTask(true)}`, newTask);
                createdTasks++;
            }
        }
        if (editor) {
            this.logger.info(`Page Updates: ${createdTasks}`, addedTasks);

            editor.replaceSelection(addedTasks);
        }
        this.logger.info(`Created Tasks: ${createdTasks}`);
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
    public async postTask(editor: Editor, replace?: boolean) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile === null) {
            return;
        }

        this.userNotice.showMessage(t('CommandNotice_CreatingToDo'), 3000);

        const source = await this.plugin.app.vault.read(activeFile);
        const { lines } = await this.getCurrentLinesFromEditor(editor);

        // Single call to update the cache using the delta link.
        const cachedTasksDelta = await this.getTaskDelta();
        // If there are no tasks in the cache then return.
        if (!cachedTasksDelta) {
            return;
        }

        // Get sum of all tasks in all lists.
        const countOfAllTasks = cachedTasksDelta.allLists.reduce((acc, list) => acc + list.allTasks.length, 0);
        this.logger.info(`Remote Tasks: ${countOfAllTasks}`);

        // Get all the lines the user has selected.
        const split = source.split('\n');
        const modifiedPage = await Promise.all(
            split.map(async (line: string, index: number) => {
                // If the line is not in the selection, return the line as is.
                if (!lines.includes(index)) {
                    return line;
                }

                // Create the to do task from the line that is in the selection.
                const todo = new ObsidianTodoTask(this.settingsManager, line);

                // If there is a block link in the line, we will try to find
                // the task id from the block link and update the task instead.
                // As a user can add a block link, not all tasks will be able to
                // lookup a id from the internal cache.
                if (todo.hasBlockLink && todo.hasId) {
                    // Check for linked resource and update if there otherwise create.
                    const { list, task: cachedTask } = await this.getListAndTaskFromTaskId(todo.id);

                    if (cachedTask && !todo.equals(cachedTask)) {
                        const linkedResource = cachedTask.linkedResources?.first();
                        if (linkedResource && linkedResource.id) {
                            await this.todoApi.updateLinkedResource(
                                list?.listId ?? '',
                                todo.id,
                                linkedResource.id,
                                todo.blockLink ?? '',
                                todo.getRedirectUrl(),
                            );
                        } else {
                            await this.todoApi.createLinkedResource(
                                list?.listId ?? '',
                                todo.id,
                                todo.blockLink ?? '',
                                todo.getRedirectUrl(),
                            );
                        }
                    }

                    todo.linkedResources = cachedTask?.linkedResources;

                    // Only update if there is a need.
                    if (cachedTask && !todo.equals(cachedTask)) {
                        this.logger.info(`Updating Task: ${todo.title}`, todo.getTodoTask());

                        const returnedTask = await this.todoApi.updateTaskFromToDo(
                            list?.listId ?? '',
                            todo.id,
                            todo.getTodoTask(),
                        );
                        this.logger.debug(`updated: ${returnedTask.id}`);
                    }
                    this.logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`);
                } else {
                    this.logger.info(`Creating Task: ${todo.title}`);
                    // Check for a list id in the settings.
                    let listId = this.settingsManager.settings.todoListSync.listId;
                    if (todo.listName) {
                        // 改进列表名称匹配逻辑，使用不区分大小写的比较，并支持微软自动重命名的格式（如"列表名 (1)"）
                        const list = cachedTasksDelta.allLists.find((l) => 
                            l.name.toLowerCase() === todo.listName?.toLowerCase() || 
                            l.name.toLowerCase().startsWith(todo.listName?.toLowerCase() + ' (')
                        );
                        listId = list?.listId;
                        if (!listId) {
                            if (this.settingsManager.settings.todo_CreateToDoListIfMissing) {
                                // Make the list.
                                const newTaskList = await this.todoApi.createTaskList(todo.listName);
                                this.logger.info(`Creating List: ${todo.listName}`, newTaskList);
                                if (!newTaskList) {
                                    this.userNotice.showMessage(t('Error_UnableToCreateList'));
                                    return;
                                }
                                
                                // 创建列表后立即更新本地缓存
                                if (newTaskList.id && newTaskList.displayName) {
                                    cachedTasksDelta.allLists.push(
                                        new TasksDeltaCollection([], '', newTaskList.id, newTaskList.displayName)
                                    );
                                    await this.setDeltaCache(cachedTasksDelta);
                                    this.logger.info(`Added new list to cache: ${newTaskList.displayName} (${newTaskList.id})`);
                                }
                                
                                todo.listId = newTaskList.id ?? '';
                                listId = todo.listId;
                            } else {
                                this.userNotice.showMessage(t('Error_UnableToDetermineListId'));
                                return;
                            }
                        }
                    }

                    this.logger.debug(`Creating Task: ${listId}`);

                    const returnedTask = await this.todoApi.createTaskFromToDo(listId, todo.getTodoTask());

                    todo.status = returnedTask.status;
                    await todo.cacheTaskId(returnedTask.id ?? '');
                    this.logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`, todo);
                }

                // If false there will be a orphaned block id for this task.
                if (replace) {
                    return todo.getMarkdownTask(true);
                }

                return line;
            }),
        );

        // Update the entire page.
        await this.plugin.app.vault.modify(activeFile, modifiedPage.join('\n'));
    }

    public async getTask(listId: string | undefined, editor: Editor) {
        if (!listId) {
            this.userNotice.showMessage(t('CommandNotice_SetListName'));
            return;
        }

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile === null) {
            return;
        }

        this.userNotice.showMessage(t('CommandNotice_GettingToDo'), 3000);

        const source = await this.plugin.app.vault.read(activeFile);
        const { lines } = await this.getCurrentLinesFromEditor(editor);

        // Single call to update the cache using the delta link.
        const cachedTasksDelta = await this.getTaskDelta();
        if (!cachedTasksDelta) {
            this.userNotice.showMessage('无法获取任务缓存数据');
            return;
        }

        const split = source.split('\n');
        const modifiedPage = await Promise.all(
            split.map(async (line: string, index: number) => {
                // If the line is not in the selection, return the line as is.
                if (!lines.includes(index)) {
                    return line;
                }

                // Create the to do task from the line that is in the selection.
                const todo = new ObsidianTodoTask(this.plugin.settingsManager, line);

                // If there is a block link in the line, we will try to find
                // the task id from the block link and update the task instead.
                // As a user can add a block link, not all tasks will be able to
                // lookup a id from the internal cache.
                if (todo.hasBlockLink && todo.hasId) {
                    this.logger.debug(`Updating Task: ${todo.title}`);

                    // 修复从缓存中查找任务的逻辑
                    let returnedTask: TodoTask | undefined;
                    
                    // 遍历所有列表，找到匹配的任务
                    for (const list of (cachedTasksDelta as any).allLists) {
                        if (!list.allTasks) continue;
                        
                        const task = list.allTasks.find((t: any) => t.id === todo.id);
                        if (task) {
                            returnedTask = task;
                            break;
                        }
                    }

                    // Update if there is only a difference.
                    if (returnedTask && !todo.equals(returnedTask)) {
                        todo.updateFromTodoTask(returnedTask);
                        this.logger.debug(`blockLink: ${todo.blockLink}, taskId: ${todo.id}`);
                        this.logger.debug(`updated: ${returnedTask.id}`);
                        return todo.getMarkdownTask(true);
                    }
                }

                return line;
            }),
        );

        await this.plugin.app.vault.modify(activeFile, modifiedPage.join('\n'));
    }

    /**
     * Retrieves the cached tasks delta from the specified file path.
     *
     * This method checks if the delta cache file exists in the vault adapter.
     * If the file exists, it reads and parses the JSON content into a `TasksDeltaCollection` object.
     * If the file does not exist, it returns `undefined`.
     *
     * @returns {Promise<ListsDeltaCollection | undefined>} A promise that resolves to the cached tasks delta or `undefined` if the cache file does not exist.
     */
    private async getDeltaCache(): Promise<ListsDeltaCollection | undefined> {
        const adapter: DataAdapter = this.plugin.app.vault.adapter;
        let cachedTasksDelta: ListsDeltaCollection | undefined;

        if (await adapter.exists(this.deltaCachePath)) {
            cachedTasksDelta = JSON.parse(await adapter.read(this.deltaCachePath)) as ListsDeltaCollection;
        }

        return cachedTasksDelta;
    }

    /**
     * Resets the delta cache by removing the cache file if it exists.
     *
     * This method checks if the delta cache file exists in the vault adapter.
     * If the file exists, it removes the file to reset the cache.
     *
     * @returns {Promise<void>} A promise that resolves when the cache file is removed.
     */
    private async resetDeltaCache() {
        const adapter: DataAdapter = this.plugin.app.vault.adapter;
        if (await adapter.exists(this.deltaCachePath)) {
            await adapter.remove(this.deltaCachePath);
        }
    }

    /**
     * Asynchronously writes the provided delta of cached tasks to the specified cache path.
     *
     * @param cachedTasksDelta - The collection of task deltas to be cached.
     * @returns A promise that resolves when the cache has been successfully written.
     */
    private async setDeltaCache(cachedTasksDelta: ListsDeltaCollection) {
        const adapter: DataAdapter = this.plugin.app.vault.adapter;
        await adapter.write(this.deltaCachePath, JSON.stringify(cachedTasksDelta));
    }

    /**
     * Retrieves the delta of tasks for all lists. Optionally, the delta cache can be reset.
     *
     * @param {string | undefined} listId - The ID of the task list to retrieve the delta for.
     * @param {boolean} [reset=false] - Whether to reset the delta cache.
     * @returns {Promise<ListsDeltaCollection>} - A promise that resolves to the updated tasks delta collection.
     *
     * @throws {Error} - Throws an error if the task retrieval fails.
     */
    private async getTaskDelta(
        reset: boolean = false,
        skipRemoteCheck: boolean = false,
    ): Promise<ListsDeltaCollection | undefined> {
        // this.logger.debug('getTaskDelta', { reset, skipRemoteCheck });

        if (reset) {
            this.logger.info('Resetting Delta Cache');
            await this.resetDeltaCache();
        }

        // 增加日志以确认缓存文件路径
        this.logger.debug(`Using delta cache path: ${this.deltaCachePath}`);
        
        // 检查缓存文件是否存在
        const adapter: DataAdapter = this.plugin.app.vault.adapter;
        const cacheExists = await adapter.exists(this.deltaCachePath);
        this.logger.debug(`Delta cache file exists: ${cacheExists}`);

        let cachedTasksDelta = await this.getDeltaCache();

        if (!cachedTasksDelta) {
            this.logger.info('Cache not found, creating new cache');
            cachedTasksDelta = new ListsDeltaCollection([]);

            const allToDoLists = await this.todoApi.getLists();
            if (!allToDoLists) {
                return;
            }

            for (const list of allToDoLists) {
                if (list.id && list.displayName) {
                    cachedTasksDelta.allLists.push(new TasksDeltaCollection([], '', list.id, list.displayName));
                    this.logger.debug(`Added list to new cache: ${list.displayName} (${list.id})`);
                }
            }
        } else {
            this.logger.info(`Loaded existing cache with ${cachedTasksDelta.allLists.length} lists`);
            // 记录缓存中的列表名称，帮助诊断
            cachedTasksDelta.allLists.forEach(list => {
                this.logger.debug(`Cached list: ${list.name} (${list.listId})`);
            });
        }

        // At this point we have a new empty cache or a cache with lists. For
        // each list we will get the delta and merge the results.

        for (const list of cachedTasksDelta.allLists) {
            const deltaLink = list.deltaLink == '' ? '' : list.deltaLink;

            let returnedTask = new TasksDeltaCollection([], '', list.listId, list.name);
            if (!skipRemoteCheck) {
                returnedTask = await this.todoApi.getTasksDelta(list.listId, deltaLink);
            }

            if (list.allTasks.length > 0) {
                // this.logger.debug('Cache Details', {
                //     currentCacheCount: list.allTasks.length,
                //     returnedCount: returnedTask.allTasks.length,
                // });

                list.allTasks = this.mergeCollections(list.allTasks, returnedTask.allTasks);
                // this.logger.debug('Cache Details', { currentCacheCount: list.allTasks.length });
                list.deltaLink = returnedTask.deltaLink;
            } else {
                this.logger.info('First run or there was a reset, loading delta cache');
                list.allTasks = returnedTask.allTasks;
                list.deltaLink = returnedTask.deltaLink;
            }
        }

        if (!skipRemoteCheck) {
            // Save the updated cache.
            const countOfAllTasks = cachedTasksDelta.allLists.reduce((acc, list) => acc + list.allTasks.length, 0);

            this.logger.info(`Saving Delta Cache storing ${countOfAllTasks} tasks`);
            await this.setDeltaCache(cachedTasksDelta);
            
            // 验证缓存是否已保存
            const cacheExistsAfter = await adapter.exists(this.deltaCachePath);
            this.logger.debug(`Delta cache file exists after save: ${cacheExistsAfter}`);
        }

        return cachedTasksDelta;
    }

    // Function to merge collections
    private mergeCollections(col1: TodoTask[], col2: TodoTask[]): TodoTask[] {
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

    /**
     * Retrieves the current lines from the editor based on the cursor position or selection.
     *
     * @param editor - The editor instance from which to get the current lines.
     * @returns A promise that resolves to a Selection object containing:
     * - `start`: The starting position of the cursor or selection.
     * - `end`: The ending position of the cursor or selection.
     * - `lines`: An array of line numbers that are currently selected or where the cursor is located.
     */
    private async getCurrentLinesFromEditor(editor: Editor): Promise<ISelection> {
        this.logger.debug('Getting current lines from editor', {
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
            lines = Array.from({ length: end.line + 1 - start.line }, (_v, k) => k + start.line);
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

    private getTaskIdFromLine(line: string, plugin: MsTodoSync): string {
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

    /**
     * 格式化日期为YYYY-MM-DD格式
     * @param dateTimeStr ISO格式的日期字符串
     * @returns 格式化后的日期字符串，如果解析失败则返回空字符串
     */
    private formatDueDate(dateTimeStr: string): string {
        try {
            const dueDate = new Date(dateTimeStr);
            return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
        } catch (error) {
            this.logger.debug(`无法解析日期: ${dateTimeStr}`, error);
            return '';
        }
    }
    
    /**
     * 获取优先级对应的图标
     * @param importance 优先级（high, normal, low）
     * @returns 优先级图标
     */
    private getImportanceIcon(importance: string): string {
        if (!importance) return '';
        
        switch (importance.toLowerCase()) {
            case 'high':
                return this.settings.displayOptions_TaskImportance_High || '⏫';
            case 'normal':
                return this.settings.displayOptions_TaskImportance_Normal || '🔼';
            case 'low':
                return this.settings.displayOptions_TaskImportance_Low || '🔽';
            default:
                return '';
        }
    }

    /**
     * 从缓存中读取所有任务数据，并以Markdown格式写入到指定文件
     * 
     * @returns {Promise<void>} Promise对象，表示操作完成
     */
    public async generateTaskSummary(): Promise<void> {
        try {
            // 获取所有任务数据（从缓存）
            const cachedTasksDelta = await this.getTaskDelta(false, false);
            if (!cachedTasksDelta) {
                this.logger.warn('No tasks data found in cache');
                this.userNotice.showMessage('未找到任务数据，请先同步Microsoft To-Do');
                return;
            }

            // 生成Markdown内容
            let markdownContent = '# Microsoft To-Do 任务摘要\n\n';
            markdownContent += `> 最后更新时间：${new Date().toLocaleString()}\n\n`;

            // 按列表组织任务
            const allLists = (cachedTasksDelta as any).allLists || [];
            for (const list of allLists) {
                if (!list.name || !list.allTasks || list.allTasks.length === 0) {
                    continue;
                }
                
                markdownContent += `## ${list.name}\n\n`;
                
                // 任务分类：过滤掉已删除的任务
                const tasks = (list.allTasks || []).filter((task: any) => task && !task['@removed']);
                
                // 按任务排序：未完成的任务排在前面
                const sortedTasks = [...tasks].sort((a: any, b: any) => {
                    // 按照完成状态和标题排序
                    const aCompleted = this.isTaskCompleted(a);
                    const bCompleted = this.isTaskCompleted(b);
                    
                    if (aCompleted && !bCompleted) return 1;
                    if (!aCompleted && bCompleted) return -1;
                    return (a.title || '').localeCompare(b.title || '');
                });
                
                // 处理每个任务及其子任务(checklistItems)
                for (const task of sortedTasks) {
                    if (!task.id) continue;
                    
                    // 添加主任务
                    const isCompleted = this.isTaskCompleted(task) ? 'x' : ' ';
                    
                    // 任务标题
                    let taskTitle = task.title || '无标题任务';
                    
                    // 添加截止日期（如果有）
                    if (task.dueDateTime && task.dueDateTime.dateTime) {
                        const formattedDate = this.formatDueDate(task.dueDateTime.dateTime);
                        if (formattedDate) {
                            taskTitle += ` 📅 ${formattedDate}`;
                        }
                    }
                    
                    // 添加优先级（如果有）
                    if (task.importance) {
                        const importanceIcon = this.getImportanceIcon(task.importance);
                        if (importanceIcon) {
                            taskTitle += ` ${importanceIcon}`;
                        }
                    }
                    
                    markdownContent += `- [${isCompleted}] ${taskTitle}\n`;
                    
                    // 添加任务正文（如果有）
                    if (task.body?.content && task.body.content.trim() !== '') {
                        const bodyContent = task.body.content.replace(/\n/g, '\n  ');
                        markdownContent += `  > ${bodyContent}\n`;
                    }
                    
                    // 添加子任务(checklistItems)
                    if (task.checklistItems && task.checklistItems.length > 0) {
                        for (const item of task.checklistItems) {
                            const isItemCompleted = item.isChecked || item.isCompleted ? 'x' : ' ';
                            let itemTitle = item.displayName || item.title || '无标题子任务';
                            
                            // 添加截止日期（如果子任务有）
                            if (item.dueDateTime && item.dueDateTime.dateTime) {
                                const formattedDate = this.formatDueDate(item.dueDateTime.dateTime);
                                if (formattedDate) {
                                    itemTitle += ` 📅 ${formattedDate}`;
                                }
                            }
                            
                            // 添加优先级（如果子任务有）
                            if (item.importance) {
                                const importanceIcon = this.getImportanceIcon(item.importance);
                                if (importanceIcon) {
                                    itemTitle += ` ${importanceIcon}`;
                                }
                            }
                            
                            markdownContent += `  - [${isItemCompleted}] ${itemTitle}\n`;
                        }
                    }
                    
                    // 任务之间添加一个空行
                    markdownContent += '\n';
                }
            }
            
            // 获取任务摘要文件路径
            const filePath = this.settings.taskSummaryFilePath || 'task.md';
            
            try {
                // 检查文件是否存在，不存在则创建
                const adapter = this.plugin.app.vault.adapter;
                let fileExists = await adapter.exists(filePath);
                
                // 写入文件内容
                await adapter.write(filePath, markdownContent);
                
                // 显示成功消息
                if (fileExists) {
                    this.userNotice.showMessage(`已更新任务摘要到 ${filePath}`);
                } else {
                    this.userNotice.showMessage(`已创建任务摘要文件 ${filePath}`);
                }
                
                this.logger.info(`Task summary exported to ${filePath}`);
            } catch (error) {
                this.logger.error('Error writing task summary file:', error);
                this.userNotice.showMessage(`写入任务摘要文件失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        } catch (error) {
            this.logger.error('Error generating task summary:', error);
            this.userNotice.showMessage(`生成任务摘要失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * 检查任务是否已完成
     * 
     * @param task 任务对象
     * @returns 如果任务已完成则返回true，否则返回false
     */
    private isTaskCompleted(task: any): boolean {
        // Microsoft Graph API 中已完成的任务有 completedDateTime 属性或 status 为 "completed"
        return (
            task.status === "completed" || 
            (task.status?.completedDateTime !== undefined && task.status?.completedDateTime !== null) ||
            ((task as any).completedDateTime !== undefined && (task as any).completedDateTime !== null)
        );
    }
}
