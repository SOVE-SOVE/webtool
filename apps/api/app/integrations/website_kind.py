"""
Is a listed "website" URL an owned website, or just a social/link-hub
profile? Google Places (and Brave) hand back whatever URL the business
lists as its website — very often a Facebook or Instagram page. That is
real information, but it is not an owned site: it can't be audited for
HTTPS/mobile/load time (the platform's login walls and bot defences make
any such "audit" meaningless) and it must not be presented as one.

Pure and dependency-free so discovery, research, scoring and the review
queue all use the same single definition.
"""

from typing import Literal
from urllib.parse import urlparse

WebsiteKind = Literal["website", "social_profile"]

# Registrable domains whose pages are profiles/link hubs, not owned sites.
_SOCIAL_DOMAINS: dict[str, str] = {
    "facebook.com": "Facebook",
    "fb.com": "Facebook",
    "fb.me": "Facebook",
    "instagram.com": "Instagram",
    "tiktok.com": "TikTok",
    "twitter.com": "X",
    "x.com": "X",
    "linkedin.com": "LinkedIn",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "linktr.ee": "Linktree",
    "beacons.ai": "Beacons",
}


def social_platform(url: str | None) -> str | None:
    """The platform name when `url` is a social/link-hub profile, else None."""
    if not url:
        return None
    candidate = url.strip()
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    try:
        host = (urlparse(candidate).hostname or "").lower().rstrip(".")
    except ValueError:
        return None
    parts = host.split(".")
    # Match the domain itself or any subdomain (www., m., l., business.…),
    # never a lookalike such as "notfacebook.com".
    for i in range(len(parts) - 1):
        platform = _SOCIAL_DOMAINS.get(".".join(parts[i:]))
        if platform:
            return platform
    return None


def classify_website_url(url: str | None) -> WebsiteKind | None:
    """None when there is no URL at all; otherwise "social_profile" or "website"."""
    if not url or not url.strip():
        return None
    return "social_profile" if social_platform(url) else "website"
