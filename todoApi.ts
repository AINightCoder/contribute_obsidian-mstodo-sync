import { MicrosoftClientProvider } from "./clientProvider";
import { TodoTask, TodoTaskList } from '@microsoft/microsoft-graph-types';


export class TodoApi {
    constructor(private readonly clientProvider: MicrosoftClientProvider) {

    }
    async getAllTodoLists(): Promise<TodoTaskList[] | undefined> {
        const endpoint = "/me/todo/lists";
        const client = await this.clientProvider.getClient();
        const todoLists = (await client.api(endpoint).get()).value as TodoTaskList[];
        return todoLists;
    }
    async getListIdByName(listName: string | undefined): Promise<string | undefined> {
        if (!listName) return;
        const endpoint = `/me/todo/lists`;
        const client = await this.clientProvider.getClient();
        const res: TodoTaskList[] = (await client.api(endpoint).filter(`displayName eq '${listName}'`).get()).value;
        if (!res || res.length == 0) return;
        const target = res[0] as TodoTaskList;
        return target.id;
    }
    async getTodoList(listId: string | undefined): Promise<TodoTaskList | undefined> {
        if (!listId) return;
        const endpoint = `/me/todo/lists/${listId}`;
        const client = await this.clientProvider.getClient();
        return (await client.api(endpoint).get()) as TodoTaskList;
    }
    async getListTasks(listId: string | undefined): Promise<TodoTask[] | undefined> {
        const endpoint = `/me/todo/lists/${listId}/tasks`;
        const client = await this.clientProvider.getClient();
        return (await client.api(endpoint).get()).value as TodoTask[];
    }

    async getTask(listId: string, taskId: string): Promise<TodoTask | undefined> {
        const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}`;
        const client = await this.clientProvider.getClient();
        return (await client.api(endpoint).get()) as TodoTask;
    }

    // Create tasks 
    async createTask(listId: string | undefined, title: string): Promise<undefined> {
        if (!listId) return;
        const endpoint = `/me/todo/lists/${listId}/tasks`;
        const client = await this.clientProvider.getClient();
        await client.api(endpoint).post({
            title: title,
            body: {
                content: '',
                contentType: 'text'
            }
        });
    }
}