/** Native task state, shared by the desktop and paired clients. */
export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked" | "unknown";
  priority?: string;
}
export interface TodoList {
  items: TodoItem[];
  explanation?: string;
  updatedAt: string;
}
export interface AgentSummary {
  agentId: string;
  parentAgentId?: string;
  name?: string;
  status?: string;
  updatedAt: string;
  todos?: TodoList;
}
export interface SessionActivity {
  sessionId: string;
  cursor: number;
  todos?: TodoList;
  agents: AgentSummary[];
}
