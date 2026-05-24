from __future__ import annotations

import asyncio

from agents.app.config import get_settings
from agents.app.jobs_service import JobsService
from agents.app.points import POINT_COSTS, require_points
from agents.app import store
from agents.app.schemas import (
    ChatMessageResponse,
    ConversationHistory,
    SavedConversation,
    SavedConversationListResponse,
)
from agents.chat_agent import invoke_chat_agent


class ChatService:
    def __init__(self, jobs: JobsService) -> None:
        self.settings = get_settings()
        self.jobs = jobs

    def list_conversations(self, user_id: str, limit: int, offset: int) -> SavedConversationListResponse:
        items = store.list_conversations(user_id, limit, offset)
        return SavedConversationListResponse(items=items, limit=limit, offset=offset)

    def create_conversation(self, user_id: str, title: str | None) -> SavedConversation:
        return store.create_conversation(user_id, title)

    def get_conversation(self, user_id: str, conversation_id: str) -> ConversationHistory:
        return store.load_conversation(user_id, conversation_id)

    def rename_conversation(self, user_id: str, conversation_id: str, title: str) -> SavedConversation:
        return store.rename_conversation(user_id, conversation_id, title)

    def archive_conversation(self, user_id: str, conversation_id: str) -> SavedConversation:
        return store.archive_conversation(user_id, conversation_id)

    async def send_message(self, user_id: str, text: str, conversation_id: str) -> ChatMessageResponse:
        self.jobs._loop = asyncio.get_running_loop()
        require_points(
            user_id,
            POINT_COSTS["chat_message"],
            source="agents",
            action="chat_message",
            ref_id=conversation_id,
            note="Chat message sent from dashboard",
        )

        store.append_message(conversation_id, "user", text)
        history = store.load_conversation(user_id, conversation_id)

        messages = [
            {"role": entry.role, "content": entry.content}
            for entry in history.turns
            if entry.role in {"user", "assistant"}
        ]

        reply_text = await invoke_chat_agent(
            self.settings,
            user_id=user_id,
            jobs_service=self.jobs,
            messages=messages,
        )

        store.append_message(conversation_id, "assistant", reply_text)

        return ChatMessageResponse(
            conversationId=conversation_id,
            replyText=reply_text,
        )
