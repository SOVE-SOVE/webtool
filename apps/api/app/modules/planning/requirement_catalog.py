"""Labels and kinds for the requirements board's `feature_key`s — the
backend's copy of the frontend catalogue (apps/web/.../planning/[id]/
websiteBlueprintLib.ts, FEATURE_LIBRARY), used only to write a readable
Project handoff narrative. Keep the two in sync when adding a feature;
tests/test_planning.py checks this file against the frontend source.
An unknown key (legacy/custom) falls back to a humanised label as a
content section — never dropped.

Kinds: section = content the site should contain; capability = requested
functionality that still needs building/connecting; design = visual
preference; behaviour = site-wide behaviour.
"""

FEATURES: dict[str, tuple[str, str]] = {
    "services": ("Services", "section"),
    "about": ("About", "section"),
    "gallery": ("Gallery", "section"),
    "pricing": ("Pricing", "section"),
    "faq": ("FAQ", "section"),
    "testimonials": ("Testimonials", "section"),
    "team": ("Team profiles", "section"),
    "how_it_works": ("How it works", "section"),
    "service_areas": ("Service areas", "section"),
    "opening_hours": ("Opening hours", "section"),
    "case_studies": ("Case studies", "section"),
    "before_after": ("Before & after", "section"),
    "accreditations": ("Accreditations", "section"),
    "brochure": ("Downloadable brochure", "section"),
    "blog": ("Blog / news", "section"),
    "careers": ("Careers", "section"),
    "contact": ("Contact", "section"),
    "booking": ("Booking", "capability"),
    "quote_request": ("Quote request", "capability"),
    "reservations": ("Reservation request", "capability"),
    "newsletter": ("Newsletter signup", "capability"),
    "file_upload": ("File-upload enquiry", "capability"),
    "product_catalogue": ("Product catalogue", "section"),
    "online_store": ("Online store", "capability"),
    "payments": ("Payments / deposits", "capability"),
    "customer_login": ("Customer login", "capability"),
    "live_chat": ("Live chat", "capability"),
    "style_light": ("Light appearance", "design"),
    "style_dark": ("Dark appearance", "design"),
    "style_bold_type": ("Bold typography", "design"),
    "style_editorial": ("Minimal editorial", "design"),
    "style_full_width_images": ("Full-width imagery", "design"),
    "style_rounded_cards": ("Rounded cards", "design"),
    "style_gradients": ("Subtle gradients", "design"),
    "style_texture": ("Textured backgrounds", "design"),
    "style_alternating": ("Alternating image & text", "design"),
    "style_fullscreen_hero": ("Full-screen hero", "design"),
    "video_hero": ("Video hero", "design"),
    "image_carousel": ("Image carousel", "design"),
    "filterable_gallery": ("Filterable gallery", "capability"),
    "animated_stats": ("Animated statistics", "design"),
    "scroll_reveals": ("Subtle scroll reveals", "behaviour"),
    "hover_effects": ("Subtle hover effects", "behaviour"),
    "page_transitions": ("Page transitions", "behaviour"),
    "sticky_nav": ("Sticky navigation", "behaviour"),
    "sticky_cta": ("Sticky enquiry button", "behaviour"),
}


def feature_label(key: str) -> str:
    known = FEATURES.get(key)
    if known:
        return known[0]
    words = key.replace("_", " ").replace("-", " ").strip()
    return words[:1].upper() + words[1:].lower() if words else key


def feature_kind(key: str) -> str:
    known = FEATURES.get(key)
    return known[1] if known else "section"
