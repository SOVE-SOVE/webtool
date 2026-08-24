"""
Tests for the email outreach integration layer: the adapter
(app/integrations/email.py) plus the send/history routes in
modules/outreach/. Reuses test_outreach.py's lead/outreach helpers.
"""

from app.integrations.email import EmailComposeError, EmailSendOutcome, ResendEmailProvider, compose_email

FAKE_EMAIL = {
    "subject": "A note about riversideplumbing.example",
    "body": "Hi, I came across Riverside Plumbing while looking at local trade sites. "
    "Your site doesn't have a mobile viewport tag set. Worth a quick call this week?",
}


def _patch_email(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(output or FAKE_EMAIL))


def _create_qualified_lead(authed_client, **overrides):
    payload = {"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    payload.update(overrides)
    lead = authed_client.post("/api/v1/leads", json=payload).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})
    return lead


def _approved_email_message(authed_client, monkeypatch, lead):
    _patch_email(monkeypatch)
    message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()
    authed_client.post(f"/api/v1/outreach/{message['id']}/approve")
    return message


# --- integrations/email.py: compose_email --------------------------------


class TestComposeEmail:
    def test_requires_a_valid_recipient(self):
        try:
            compose_email(to=None, subject="Hi", body="Body")
            assert False, "expected EmailComposeError"
        except EmailComposeError as exc:
            assert "recipient" in str(exc)

        try:
            compose_email(to="not-an-email", subject="Hi", body="Body")
            assert False, "expected EmailComposeError"
        except EmailComposeError:
            pass

    def test_requires_a_subject_and_body(self):
        try:
            compose_email(to="lead@example.com", subject=None, body="Body")
            assert False, "expected EmailComposeError"
        except EmailComposeError as exc:
            assert "subject" in str(exc)

        try:
            compose_email(to="lead@example.com", subject="Hi", body="   ")
            assert False, "expected EmailComposeError"
        except EmailComposeError as exc:
            assert "body" in str(exc)

    def test_happy_path_uses_the_configured_from_address(self):
        email = compose_email(to="lead@example.com", subject="Hi", body="Body")
        assert email.to == "lead@example.com"
        assert email.subject == "Hi"
        assert email.body == "Body"
        assert email.from_address  # settings.email_from_address default


# --- integrations/email.py: providers -------------------------------------


class TestMockEmailProvider:
    def test_send_records_the_message_and_never_hits_the_network(self):
        from app.integrations.email import MockEmailProvider

        provider = MockEmailProvider()
        email = compose_email(to="lead@example.com", subject="Hi", body="Body")
        outcome = provider.send(email)

        assert outcome.success is True
        assert outcome.provider == "mock"
        assert outcome.provider_message_id.startswith("mock-")
        assert provider.sent_messages == [email]


class TestGetEmailProvider:
    def test_defaults_to_mock(self):
        from app.integrations.email import MockEmailProvider, get_email_provider

        assert isinstance(get_email_provider(), MockEmailProvider)

    def test_unknown_provider_name_raises_instead_of_silently_falling_back(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.email import EmailProviderError, get_email_provider

        monkeypatch.setattr(settings, "email_provider", "sendgrid")
        try:
            get_email_provider()
            assert False, "expected EmailProviderError"
        except EmailProviderError:
            pass

    def test_resend_without_an_api_key_raises_instead_of_silently_falling_back_to_mock(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.email import EmailProviderError, get_email_provider

        monkeypatch.setattr(settings, "email_provider", "resend")
        monkeypatch.setattr(settings, "resend_api_key", "")
        try:
            get_email_provider()
            assert False, "expected EmailProviderError"
        except EmailProviderError:
            pass

    def test_resend_with_an_api_key_returns_a_resend_provider(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.email import ResendEmailProvider, get_email_provider

        monkeypatch.setattr(settings, "email_provider", "resend")
        monkeypatch.setattr(settings, "resend_api_key", "test-key")
        assert isinstance(get_email_provider(), ResendEmailProvider)


class TestResendEmailProvider:
    def test_a_network_error_is_returned_as_a_failed_outcome_not_raised(self, monkeypatch):
        import httpx

        from app.integrations.email import ResendEmailProvider

        def _boom(*args, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr("httpx.post", _boom)
        provider = ResendEmailProvider("test-key")
        outcome = provider.send(compose_email(to="lead@example.com", subject="Hi", body="Body"))

        assert outcome.success is False
        assert "connection refused" in outcome.error_message

    def test_a_non_2xx_response_is_returned_as_a_failed_outcome(self, monkeypatch):
        class _Resp:
            status_code = 422
            text = '{"message": "Invalid `from` field"}'

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        provider = ResendEmailProvider("test-key")
        outcome = provider.send(compose_email(to="lead@example.com", subject="Hi", body="Body"))

        assert outcome.success is False
        assert "422" in outcome.error_message

    def test_a_successful_response_returns_the_provider_message_id(self, monkeypatch):
        class _Resp:
            status_code = 200
            text = "{}"

            def json(self):
                return {"id": "re_abc123"}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        provider = ResendEmailProvider("test-key")
        outcome = provider.send(compose_email(to="lead@example.com", subject="Hi", body="Body"))

        assert outcome.success is True
        assert outcome.provider_message_id == "re_abc123"


# --- send-email route -------------------------------------------------


class TestSendOutreachEmail:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/outreach/00000000-0000-0000-0000-000000000000/send-email")
        assert res.status_code == 401

    def test_unknown_message_404s(self, authed_client):
        res = authed_client.post("/api/v1/outreach/00000000-0000-0000-0000-000000000000/send-email")
        assert res.status_code == 404

    def test_cannot_send_a_message_that_has_not_been_approved(self, authed_client, monkeypatch):
        _patch_email(monkeypatch)
        lead = _create_qualified_lead(authed_client)
        message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()

        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 400
        assert "APPROVED" in res.json()["detail"]

    def test_cannot_send_a_non_email_channel_message(self, authed_client, monkeypatch):
        monkeypatch.setattr(
            "app.agents.outreach.generate_structured",
            lambda **kwargs: dict(
                opening_line="Hi", key_points=["a"], objection_handling=["b"], suggested_close="c"
            ),
        )
        lead = _create_qualified_lead(authed_client)
        message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "phone"}).json()
        authed_client.post(f"/api/v1/outreach/{message['id']}/approve")

        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 400
        assert "EMAIL" in res.json()["detail"]

    def test_fails_cleanly_with_no_recipient_email_on_file(self, authed_client, monkeypatch):
        lead = _create_qualified_lead(authed_client)  # no business email, no contact
        message = _approved_email_message(authed_client, monkeypatch, lead)

        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 400
        assert "recipient" in res.json()["detail"]

        # Never attempted a send — no EmailSend row created for this non-attempt.
        history = authed_client.get(f"/api/v1/leads/{lead['id']}/emails").json()
        assert history == []

    def test_happy_path_sends_records_the_send_and_advances_the_message_and_lead(self, authed_client, monkeypatch):
        lead = _create_qualified_lead(authed_client)
        authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"email": "owner@riversideplumbing.example"})
        message = _approved_email_message(authed_client, monkeypatch, lead)

        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 201
        body = res.json()
        assert body["status"] == "sent"
        assert body["provider"] == "mock"
        assert body["provider_message_id"].startswith("mock-")
        assert body["to_email"] == "owner@riversideplumbing.example"
        assert body["subject"] == FAKE_EMAIL["subject"]
        assert body["error_message"] is None
        assert body["sent_by_user_name"] is not None

        outreach_after = authed_client.get(f"/api/v1/outreach/{message['id']}").json()
        assert outreach_after["status"] == "sent"
        assert outreach_after["sent_by_user_name"] is not None

        assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "contacted"

        activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
        assert any(a["action"] == "email_sent" for a in activity)

    def test_prefers_the_primary_contact_email_over_the_business_email(self, authed_client, db_session, monkeypatch):
        from app.modules.contacts.models import Contact

        lead = _create_qualified_lead(authed_client)
        authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"email": "info@riversideplumbing.example"})
        db_session.add(Contact(business_id=lead["business_id"], name="Riley Owner", email="riley@riversideplumbing.example"))
        db_session.commit()
        message = _approved_email_message(authed_client, monkeypatch, lead)

        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 201
        assert res.json()["to_email"] == "riley@riversideplumbing.example"

    def test_a_provider_failure_is_recorded_and_leaves_the_message_approved_and_retryable(
        self, authed_client, monkeypatch
    ):
        lead = _create_qualified_lead(authed_client)
        authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"email": "owner@riversideplumbing.example"})
        message = _approved_email_message(authed_client, monkeypatch, lead)

        class _FailingProvider:
            name = "mock"

            def send(self, message):
                return EmailSendOutcome(success=False, provider=self.name, error_message="mailbox rejected the message")

        monkeypatch.setattr("app.modules.outreach.service.get_email_provider", lambda: _FailingProvider())
        res = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 201  # the attempt was recorded — it just failed
        body = res.json()
        assert body["status"] == "failed"
        assert body["error_message"] == "mailbox rejected the message"

        # The message was never marked sent, so it's still retryable.
        outreach_after = authed_client.get(f"/api/v1/outreach/{message['id']}").json()
        assert outreach_after["status"] == "approved"
        assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] != "contacted"

        activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
        assert any(a["action"] == "email_send_failed" for a in activity)

        # Retrying with a working provider succeeds, and both attempts show up in history.
        from app.integrations.email import get_email_provider

        monkeypatch.setattr("app.modules.outreach.service.get_email_provider", get_email_provider)
        retry = authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert retry.status_code == 201
        assert retry.json()["status"] == "sent"

        history = authed_client.get(f"/api/v1/leads/{lead['id']}/emails").json()
        assert len(history) == 2
        assert [h["status"] for h in history] == ["sent", "failed"]  # newest first

    def test_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        lead = _create_qualified_lead(authed_client)
        authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"email": "owner@riversideplumbing.example"})
        message = _approved_email_message(authed_client, monkeypatch, lead)

        res = other_authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")
        assert res.status_code == 404


# --- email history route -----------------------------------------------


class TestEmailHistory:
    def test_requires_auth(self, client):
        res = client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/emails")
        assert res.status_code == 401

    def test_unknown_lead_404s(self, authed_client):
        res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/emails")
        assert res.status_code == 404

    def test_empty_before_any_send_attempt(self, authed_client):
        lead = _create_qualified_lead(authed_client)
        res = authed_client.get(f"/api/v1/leads/{lead['id']}/emails")
        assert res.status_code == 200
        assert res.json() == []

    def test_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        lead = _create_qualified_lead(authed_client)
        authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"email": "owner@riversideplumbing.example"})
        message = _approved_email_message(authed_client, monkeypatch, lead)
        authed_client.post(f"/api/v1/outreach/{message['id']}/send-email")

        assert other_authed_client.get(f"/api/v1/leads/{lead['id']}/emails").status_code == 404
