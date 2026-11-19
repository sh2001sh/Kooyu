import { createContext } from "react";

export const AgentNavigationContext = createContext<((agentId: string) => void) | undefined>(
  undefined,
);
