export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type LLMRole = "designer" | "critic" | "diagnose" | "improver" | "general";
export type LLMResult = { text: string; model: string; provider: "gemini-argon" | "muse"; ms: number };
export type CallOpts = { messages: ChatMessage[]; json?: boolean; effort?: "minimal" | "low" | "medium" | "high"; timeoutMs?: number };
