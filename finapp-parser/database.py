import os
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.environ.get('SUPABASE_URL', '')
        key = os.environ.get('SUPABASE_KEY', '')
        if not url or not key:
            raise EnvironmentError('SUPABASE_URL and SUPABASE_KEY must be set in .env')
        _client = create_client(url, key)
    return _client


def upsert_transactions(records: list[dict[str, Any]]) -> int:
    """Insert or update transactions by source_document. Returns the count of affected rows."""
    if not records:
        return 0

    client = get_client()
    response = (
        client.table('transactions')
        .upsert(records, on_conflict='source_document')
        .execute()
    )
    return len(response.data) if response.data else 0


def insert_transactions(records: list[dict[str, Any]]) -> int:
    """Insert new transactions without upsert logic. Returns the count of inserted rows."""
    if not records:
        return 0

    client = get_client()
    response = client.table('transactions').insert(records).execute()
    return len(response.data) if response.data else 0
