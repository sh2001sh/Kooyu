import { createContext } from "react";
export const FilePreviewContext = createContext<((path: string) => void) | undefined>(undefined);
export const FileChangesContext = createContext<(() => void) | undefined>(undefined);
