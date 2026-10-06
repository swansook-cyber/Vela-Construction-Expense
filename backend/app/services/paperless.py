import os
import httpx


class PaperlessClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("PAPERLESS_URL", "").rstrip("/")
        self.token = os.getenv("PAPERLESS_TOKEN", "")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.token)

    async def get_document(self, document_id: int) -> dict:
        if not self.configured:
            raise RuntimeError("Paperless-ngx is not configured")
        headers = {"Authorization": f"Token {self.token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{self.base_url}/api/documents/{document_id}/", headers=headers)
            response.raise_for_status()
            return response.json()
