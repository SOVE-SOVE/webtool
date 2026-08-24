"""
Email provider adapter layer (roadmap M3's outreach send path). Mirrors
integrations/deployment.py's shape: a narrow `EmailProvider` interface
plus a factory keyed off settings, so `modules/outreach/service.py` codes
against the interface, never a concrete provider — a real host can be
swapped in later (or changed again) without touching the calling code.

Two providers exist. `MockEmailProvider` is the default — safe for local
dev and every test, it never makes a network call and never claims a
real send happened (mirrors MockDeploymentProvider's `target="mock"`
contract). `ResendEmailProvider` is the one real provider, selected via
`settings.email_provider == "resend"`; it fails loudly if
`RESEND_API_KEY` is missing rather than silently falling back to mock.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx

from app.core.settings import settings

_RESEND_API_URL = "https://api.resend.com/emails"
_REQUEST_TIMEOUT_SECONDS = 10.0


@dataclass
class EmailMessage:
    """A fully composed, ready-to-send email. Built by `compose_email()`
    — never constructed with unvalidated fields directly."""

    to: str
    subject: str
    body: str
    from_address: str
    reply_to: str | None = None


@dataclass
class EmailSendOutcome:
    """What a provider's `send()` call actually did. `success=False`
    always carries an `error_message` — there's no ambiguous "unknown"
    result, per the "never send silently and never fail silently"
    requirement this adapter exists to satisfy."""

    success: bool
    provider: str
    provider_message_id: str | None = None
    error_message: str | None = None


class EmailComposeError(ValueError):
    """Raised by `compose_email()` when a message can't be honestly
    built — e.g. no recipient address on file. Distinct from a send
    failure: this never reaches a provider at all."""


def compose_email(
    *, to: str | None, subject: str | None, body: str | None, reply_to: str | None = None
) -> EmailMessage:
    """
    Assembles an `EmailMessage` from already-drafted/approved content —
    this is the "compose" step of the integration layer, distinct from
    `agents/outreach.py`'s AI drafting. It only validates and packages
    real fields; it never invents a subject, body, or recipient.
    """
    if not to or "@" not in to:
        raise EmailComposeError("No valid recipient email address on file for this lead.")
    if not subject or not subject.strip():
        raise EmailComposeError("Outreach message has no subject to send.")
    if not body or not body.strip():
        raise EmailComposeError("Outreach message has no body to send.")
    return EmailMessage(
        to=to,
        subject=subject,
        body=body,
        from_address=settings.email_from_address,
        reply_to=reply_to,
    )


class EmailProvider:
    """Interface every email provider implements."""

    name: str = "base"

    def send(self, message: EmailMessage) -> EmailSendOutcome:
        raise NotImplementedError


class MockEmailProvider(EmailProvider):
    """
    Safe development/test implementation. "Sending" means recording the
    message on this instance and returning a synthetic success — no
    network call, so it's what every test uses by default
    (`settings.email_provider` defaults to "mock"). `sent_messages` lets
    a test assert on exactly what would have gone out.
    """

    name = "mock"

    def __init__(self) -> None:
        self.sent_messages: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> EmailSendOutcome:
        self.sent_messages.append(message)
        return EmailSendOutcome(success=True, provider=self.name, provider_message_id=f"mock-{uuid.uuid4()}")


class ResendEmailProvider(EmailProvider):
    """Real provider using the Resend REST API (docs/02_ARCHITECTURE.md
    lists Resend as the chosen email integration). Any network error or
    non-2xx response is caught and returned as a failed outcome — never
    raised past this class — so a provider hiccup is recorded like any
    other send failure, not an unhandled exception."""

    name = "resend"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def send(self, message: EmailMessage) -> EmailSendOutcome:
        payload: dict = {
            "from": message.from_address,
            "to": [message.to],
            "subject": message.subject,
            "text": message.body,
        }
        if message.reply_to:
            payload["reply_to"] = message.reply_to

        try:
            response = httpx.post(
                _RESEND_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return EmailSendOutcome(success=False, provider=self.name, error_message=f"Request to Resend failed: {exc}")

        if response.status_code >= 400:
            return EmailSendOutcome(
                success=False,
                provider=self.name,
                error_message=f"Resend returned {response.status_code}: {response.text[:500]}",
            )

        try:
            data = response.json()
        except ValueError:
            data = {}
        return EmailSendOutcome(success=True, provider=self.name, provider_message_id=data.get("id"))


class EmailProviderError(RuntimeError):
    """Raised by `get_email_provider()` for a misconfiguration — an
    unknown provider name, or "resend" selected with no API key. Never
    silently substitutes mock for a provider that was explicitly
    requested but isn't usable."""


def get_email_provider() -> EmailProvider:
    """Factory for the configured provider, mirroring
    `integrations/deployment.py`'s `get_deployment_provider()`."""
    provider = settings.email_provider
    if provider == "mock":
        return MockEmailProvider()
    if provider == "resend":
        if not settings.resend_api_key:
            raise EmailProviderError("EMAIL_PROVIDER is 'resend' but RESEND_API_KEY is not configured.")
        return ResendEmailProvider(settings.resend_api_key)
    raise EmailProviderError(f"Unknown email provider: {provider!r} — only 'mock' and 'resend' exist.")
