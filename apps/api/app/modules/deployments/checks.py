"""
Pre-deployment checks beyond the approval gate itself — approvals
(who signed off on what) live in modules/approvals/service.py and are
checked first, unchanged, by modules/deployments/service.py. Everything
here is the second gate: is *this specific approved version* actually
safe/complete to publish. Every function returns the list of blocking
issue strings it found (empty = check passed) rather than raising, so
`run_predeploy_checks` can report every problem at once instead of the
operator fixing them one HTTP round-trip at a time.
"""

from __future__ import annotations

import json
import re

from app.modules.design_briefs.models import DesignBrief
from app.modules.qa_reports.models import QaReport
from app.modules.websites.models import Website

# Structural, high-signal credential patterns only (real key/token
# shapes) — deliberately not a generic "secret"/"password" keyword
# match, which would false-positive on ordinary business copy (e.g. a
# tradie's "our secret to 20 years in business...").
_SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("an AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("a private key block", re.compile(r"-----BEGIN[ A-Z]*PRIVATE KEY-----")),
    ("a Stripe secret key", re.compile(r"sk_(live|test)_[0-9a-zA-Z]{16,}")),
    ("a GitHub token", re.compile(r"gh[pousr]_[0-9A-Za-z]{20,}")),
    ("a Slack token", re.compile(r"xox[baprs]-[0-9a-zA-Z-]{10,}")),
    ("what looks like a JWT", re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}")),
]


def check_required_assets(website: Website) -> list[str]:
    config = website.config or {}
    if not config.get("pages"):
        return ["Generated website has no pages to deploy"]
    return []


def check_required_configuration(
    website: Website, brief: DesignBrief | None, environment: str, provider_name: str
) -> list[str]:
    issues = []
    if not website.config:
        issues.append("Generated website has no configuration to deploy")
    # The mock provider never publishes anywhere a real domain would
    # matter (see integrations/deployment.py) — a real provider is
    # where "production needs a domain on file" actually has teeth, so
    # this only blocks once one is configured. The check itself, and
    # its own test coverage, exist now regardless.
    if provider_name != "mock" and environment == "production" and (brief is None or not brief.domain):
        issues.append("No domain configured for this project (required to deploy to production)")
    return issues


def check_no_exposed_secrets(website: Website) -> list[str]:
    if not website.config:
        return []
    blob = json.dumps(website.config)
    found = [label for label, pattern in _SECRET_PATTERNS if pattern.search(blob)]
    if not found:
        return []
    return [f"Generated website content appears to contain {', '.join(found)} — remove it before deploying"]


def check_critical_qa_resolved(latest_qa: QaReport | None) -> list[str]:
    if latest_qa is None:
        return ["No QA report has been run for this website version"]
    checks = (latest_qa.report or {}).get("checks", [])
    critical_fails = [c for c in checks if c.get("status") == "fail" and c.get("severity") == "critical"]
    if critical_fails:
        return [f"{len(critical_fails)} critical QA issue(s) unresolved"]
    return []


def run_predeploy_checks(
    website: Website, brief: DesignBrief | None, latest_qa: QaReport | None, environment: str, provider_name: str
) -> list[str]:
    """
    Everything the approval gate alone doesn't cover: pages/config exist,
    no secret-shaped content leaked into the generated site, a domain is
    on file where the target actually needs one, and the specific QA
    report backing this version has no unresolved critical issue (belt-
    and-suspenders alongside the QA checkpoint's own approval flag).
    """
    issues: list[str] = []
    issues += check_required_assets(website)
    issues += check_required_configuration(website, brief, environment, provider_name)
    issues += check_no_exposed_secrets(website)
    issues += check_critical_qa_resolved(latest_qa)
    return issues
