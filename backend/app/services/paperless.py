import os
from typing import Any

import httpx


class PaperlessClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("PAPERLESS_URL", "").rstrip("/")
        self.token = os.getenv("PAPERLESS_TOKEN", "")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.token)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Token {self.token}",
            "Accept": "application/json; version=10",
        }

    async def get_document(self, document_id: int) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("Paperless-ngx is not configured")
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/api/documents/{document_id}/",
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def upload_document(
        self,
        filename: str,
        content: bytes,
        content_type: str,
        title: str | None = None,
        created: str | None = None,
    ) -> str:
        if not self.configured:
            raise RuntimeError("Paperless-ngx is not configured")

        data: dict[str, str] = {}
        if title:
            data["title"] = title
        if created:
            data["created"] = created

        files = {"document": (filename, content, content_type or "application/octet-stream")}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.base_url}/api/documents/post_document/",
                headers=self._headers(),
                data=data,
                files=files,
            )
            response.raise_for_status()
            payload = response.json()

        if isinstance(payload, str):
            return payload
        if isinstance(payload, dict):
            task_id = payload.get("task_id") or payload.get("id") or payload.get("uuid")
            if task_id:
                return str(task_id)
        return str(payload)

    async def get_task(self, task_id: str) -> Any:
        if not self.configured:
            raise RuntimeError("Paperless-ngx is not configured")
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/api/tasks/",
                headers=self._headers(),
                params={"task_id": task_id},
            )
            response.raise_for_status()
            return response.json()
