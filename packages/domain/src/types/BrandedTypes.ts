export type UserId = string & { readonly _brand: 'UserId' };
export type AgentId = string & { readonly _brand: 'AgentId' };
export type MissionId = string & { readonly _brand: 'MissionId' };
export type TaskId = string & { readonly _brand: 'TaskId' };

export const createUserId = (id: string): UserId => id as UserId;
export const createAgentId = (id: string): AgentId => id as AgentId;
export const createMissionId = (id: string): MissionId => id as MissionId;
export const createTaskId = (id: string): TaskId => id as TaskId;
