import { apiClient as agentsApiClient } from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export interface SendMessageResponse {
  conversationId: string;
  replyText: string;
  terminationReason: string;
  totalCostUsd: number;
  turnCount: number;
}

export interface SavedConversation {
  id: string;
  userId: string;
  channel: string;
  title: string | null;
  startedAt: string;
  updatedAt: string;
  lastActivityAt: string;
  archivedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  turnCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  terminationReason: string | null;
  toolCallCount: number;
  model: string | null;
  accessState?: "active" | "archived" | "expired";
  isArchived?: boolean;
  isExpired?: boolean;
}

export interface SavedConversationListResponse {
  items: SavedConversation[];
  limit: number;
  offset: number;
}

export interface SavedConversationResponse {
  conversation: SavedConversation;
}

export interface ConversationTurn {
  conversationId: string;
  turnIndex: number;
  role: string;
  content: unknown;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface ConversationHistory {
  conversation: SavedConversation;
  turns: ConversationTurn[];
}

export async function sendChatMessage(
  text: string,
  conversationId?: string
): Promise<SendMessageResponse> {
  const res = await agentsApiClient.post<SendMessageResponse>("/agents/chat/messages", {
    text,
    conversationId,
  });
  return res.data;
}

export async function listSavedConversations(options: { limit?: number; offset?: number } = {}): Promise<SavedConversationListResponse> {
  const res = await agentsApiClient.get<SavedConversationListResponse>("/agents/chat/conversations", {
    params: options,
  });
  return res.data;
}

export async function createSavedConversation(title?: string | null): Promise<SavedConversation> {
  const res = await agentsApiClient.post<SavedConversationResponse>("/agents/chat/conversations", {
    ...(title !== undefined ? { title } : {}),
  });
  return res.data.conversation;
}

export async function getConversationHistory(
  conversationId: string
): Promise<ConversationHistory> {
  const res = await agentsApiClient.get<ConversationHistory>(
    `/chat/conversations/${conversationId}`
  );
  return res.data;
}

export async function renameSavedConversation(conversationId: string, title: string): Promise<SavedConversation> {
  const res = await agentsApiClient.patch<SavedConversationResponse>(
    `/chat/conversations/${conversationId}`,
    { title }
  );
  return res.data.conversation;
}

export async function archiveSavedConversation(conversationId: string): Promise<SavedConversation> {
  const res = await agentsApiClient.delete<SavedConversationResponse>(
    `/chat/conversations/${conversationId}`
  );
  return res.data.conversation;
}
