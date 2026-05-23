from __future__ import annotations

import asyncio

from agents.app.config import get_settings
from agents.app.jobs_service import JobsService
from agents.app import store
from agents.app.schemas import (
    ChatMessageResponse,
    ConversationHistory,
    ConversationTurn,
    SavedConversation,
    SavedConversationListResponse,
    utc_now,
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
        history = store.load_conversation(user_id, conversation_id)
        user_turn = ConversationTurn(
            conversationId=conversation_id,
            turnIndex=len(history.turns),
            role="user",
            content=text,
            createdAt=utc_now(),
        )
        store.append_turns(user_id, conversation_id, [user_turn], model=None, cost_usd=0, tool_call_count=0)
        history = store.load_conversation(user_id, conversation_id)

        messages = [
            {
                "role": "assistant" if turn.role == "assistant" else "user",
                "content": str(turn.content),
            }
            for turn in history.turns
            if turn.role in {"user", "assistant"}
        ]

        reply_text = await invoke_chat_agent(
            self.settings,
            messages=messages,
            load_portfolio=lambda: store.load_portfolio(user_id),
            load_strategies=lambda: store.list_strategies(user_id),
            load_reports=lambda: store.list_report_summaries(user_id, limit=6),
            trigger_job=lambda action, ticker: self.jobs.trigger_from_chat(user_id, action, ticker),
        )

        assistant_turn = ConversationTurn(
            conversationId=conversation_id,
            turnIndex=len(history.turns),
            role="assistant",
            content=reply_text,
            model=self.settings.deep_agent_model,
            createdAt=utc_now(),
        )
        updated = store.append_turns(
            user_id, conversation_id, [assistant_turn],
            model=self.settings.deep_agent_model, cost_usd=0, tool_call_count=0,
        )
        store.set_termination_reason(conversation_id, "model_final")

        return ChatMessageResponse(
            conversationId=conversation_id,
            replyText=reply_text,
            terminationReason="model_final",
            totalCostUsd=updated.conversation.totalCostUsd,
            turnCount=updated.conversation.turnCount,
        )
