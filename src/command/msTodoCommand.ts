import { Editor, Notice } from 'obsidian';
import { formatTask } from 'src/utils/formatter';
import { ObsidianTodoTask } from 'src/model/ObsidianTodoTask';
import MsTodoSync from '../main';
import { TodoApi } from '../api/todoApi';
import { MsTodoSyncSettings } from '../gui/msTodoSyncSettingTab';
import { t } from './../lib/lang';
import { log } from './../lib/logging';

export function getTaskIdFromLine(line: string, plugin: MsTodoSync): string {
	const regex = /\^(?!.*\^)([A-Za-z0-9]+)/gm;
	const blocklistMatch = regex.exec(line.trim());
	if (blocklistMatch) {
		const blocklink = blocklistMatch[1];
		const taskId = plugin.settings.taskIdLookup[blocklink];
		console.log(taskId);
		return taskId;
	}
	return '';
}

export async function postTask(
	todoApi: TodoApi,
	listId: string | undefined,
	editor: Editor,
	fileName: string | undefined,
	plugin: MsTodoSync,
	replace?: boolean,
) {
	if (!editor.somethingSelected()) {
		new Notice('好像没有选中什么');
		return;
	}
	if (!listId) {
		new Notice('请先设置同步列表');
		return;
	}
	new Notice('创建待办中...', 3000);
	const formatted = editor
		.getSelection()
		.replace(/(- \[ \] )|\*|^> |^#* |- /gm, '')
		.split('\n')
		.filter((s) => s != '');
	log('debug', formatted.join(' :: '));
	Promise.all(
		formatted.map(async (s) => {
			const todo = new ObsidianTodoTask(plugin, s, fileName ?? '');

			// If there is a block link in the line, we will try to find
			// the task id from the block link and update the task instead.
			if (todo.hasBlockLink && todo.id) {
				log('debug', `blocklink: ${todo.blockLink}, taskId: ${todo.id}`);

				const returnedTask = await todoApi.updateTaskFromToDo(listId, todo.id, todo);
				log('debug', `blocklink: ${todo.blockLink}, taskId: ${todo.id}`);
				log('debug', `updated: ${returnedTask.id}`);

				return { line: todo.title, index: todo.blockLink };
			} else {
				const returnedTask = await todoApi.createTaskFromToDo(listId, todo);

				todo.cacheTaskId(returnedTask.id);
				log('debug', `blocklink: ${todo.blockLink}, taskId: ${todo.id}`);

				return { line: todo.title, index: todo.blockLink };
			}
		}),
	).then((res) => {
		new Notice('创建待办成功√');
		if (replace) {
			editor.replaceSelection(
				res
					.map((i) => {
						let createdAt = '';
						const blocklink = `^${i.index}`;
						const formattedTask = formatTask(plugin, i.line);
						if (plugin.settings.displayOptions_ReplaceAddCreatedAt) {
							createdAt = `${t('displayOptions_CreatedAtTime')} ${window
								.moment()
								.format(plugin.settings.displayOptions_TimeFormat)}`;
						}
						return `${formattedTask} ${createdAt} ${blocklink}`;
					})
					.join('\n'),
			);
		}
	});
}

export async function createTodayTasks(todoApi: TodoApi, settings: MsTodoSyncSettings, editor?: Editor) {
	new Notice('获取微软待办中', 3000);
	const now = window.moment();
	const pattern = `status ne 'completed' or completedDateTime/dateTime ge '${now.format('yyyy-MM-DD')}'`;
	const taskLists = await todoApi.getLists(pattern);
	if (!taskLists || taskLists.length == 0) {
		new Notice('任务列表为空');
		return;
	}
	const segments = taskLists
		.map((taskList) => {
			if (!taskList.tasks || taskList.tasks.length == 0) return;
			taskList.tasks.sort((a, b) => (a.status == 'completed' ? 1 : -1));
			const lines = taskList.tasks?.map((task) => {
				const formattedCreateDate = window
					.moment(task.createdDateTime)
					.format(settings.displayOptions_DateFormat);
				const done = task.status == 'completed' ? 'x' : ' ';
				const createDate =
					formattedCreateDate == now.format(settings.displayOptions_DateFormat)
						? ''
						: `${settings.displayOptions_TaskCreatedPrefix}[[${formattedCreateDate}]]`;
				const body = !task.body?.content ? '' : `${settings.displayOptions_TaskBodyPrefix}${task.body.content}`;

				return `- [${done}] ${task.title}  ${createDate}  ${body}`;
			});
			return `**${taskList.displayName}**
${lines?.join('\n')}
`;
		})
		.filter((s) => s != undefined)
		.join('\n\n');

	new Notice('待办列表已获取');
	if (editor) editor.replaceSelection(segments);
	else return segments;
}
