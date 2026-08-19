"""
Tests for the deterministic Anti-Slop quality evaluator
(app/agents/anti_slop.py). Fixtures use a small plumbing business —
consistent with docs/00_VISION.md's target customer — to keep "real"
vs. "slop" content genuinely distinguishable rather than abstract.
"""

from app.agents.anti_slop import (
    AntiSlopInput,
    AuthenticContent,
    PageInput,
    SectionInput,
    VisualStyleInput,
    run,
)


def _page(name: str, sections: list[SectionInput]) -> PageInput:
    return PageInput(name=name, sections=sections)


def _section(type_: str, **config) -> SectionInput:
    return SectionInput(type=type_, config=config)


class TestCleanSitePasses:
    def test_a_well_built_honest_page_scores_high_and_passes(self):
        home = _page(
            "Home",
            [
                _section("navigation", logo={"label": "Riverside Plumbing"}, links=[{"label": "Services", "href": "/services"}]),
                _section("hero", heading="Same-day plumbing repairs across Ipswich", subheading="Licensed, local, upfront pricing."),
                _section(
                    "serviceCards",
                    services=[
                        {"title": "Blocked drains", "description": "Camera inspection and clearing, same day."},
                        {"title": "Hot water systems", "description": "Repair or replace, all major brands."},
                    ],
                ),
                _section(
                    "testimonials",
                    testimonials=[{"quote": "Fixed our hot water same afternoon.", "authorName": "D. Cole"}],
                ),
                _section("footer", copyrightHolder="Riverside Plumbing Pty Ltd"),
            ],
        )
        result = run(
            AntiSlopInput(
                pages=[home],
                authentic_content=AuthenticContent(known_testimonial_quotes=["Fixed our hot water same afternoon."]),
            )
        )
        assert result.output.score == 100
        assert result.output.passed is True
        assert result.output.issues == []
        assert result.output.missing_information == []
        assert result.flagged_for_review is False


class TestMissingInformationIsFlaggedNotFabricated:
    def test_missing_required_field_is_reported_separately_from_issues(self):
        home = _page("Home", [_section("hero", heading="")])
        result = run(AntiSlopInput(pages=[home]))
        assert any('missing required field "heading"' in m for m in result.output.missing_information)
        # Missing info is a completeness signal, not a quality defect —
        # it must never silently lower the score as if it were slop.
        assert result.output.score == 100
        assert result.flagged_for_review is True

    def test_empty_required_array_counts_as_missing(self):
        home = _page("Home", [_section("serviceCards", services=[])])
        result = run(AntiSlopInput(pages=[home]))
        assert any('missing required field "services"' in m for m in result.output.missing_information)


class TestGenericCopy:
    def test_flags_generic_welcome_language(self):
        home = _page("Home", [_section("hero", heading="Welcome to our website")])
        result = run(AntiSlopInput(pages=[home]))
        rules = [i.rule for i in result.output.issues]
        assert "generic_welcome_language" in rules
        assert result.output.score < 100

    def test_flags_marketing_cliches(self):
        home = _page(
            "Home",
            [_section("hero", heading="We are passionate about cutting-edge, seamless experiences for every client")],
        )
        result = run(AntiSlopInput(pages=[home]))
        rules = [i.rule for i in result.output.issues]
        assert rules.count("marketing_cliche") >= 2

    def test_real_specific_copy_is_not_flagged(self):
        home = _page("Home", [_section("hero", heading="Licensed gas fitters servicing Ipswich since 2011")])
        result = run(AntiSlopInput(pages=[home]))
        assert result.output.issues == []


class TestRepetitivePhrasing:
    def test_flags_the_same_line_reused_across_sections(self):
        pages = [
            _page("Home", [_section("hero", heading="Quality service you can trust every time")]),
            _page("About", [_section("hero", heading="Quality service you can trust every time")]),
        ]
        result = run(AntiSlopInput(pages=pages))
        rules = [i.rule for i in result.output.issues]
        assert "duplicate_copy" in rules

    def test_does_not_flag_short_incidental_repeats(self):
        pages = [
            _page("Home", [_section("hero", heading="Home")]),
            _page("About", [_section("hero", heading="About")]),
        ]
        result = run(AntiSlopInput(pages=pages))
        assert not any(i.rule == "duplicate_copy" for i in result.output.issues)


class TestFabricationGuardrails:
    def test_testimonial_with_no_authentic_source_is_flagged_high_severity(self):
        home = _page("Home", [_section("testimonials", testimonials=[{"quote": "Best plumber in the state!", "authorName": "Anonymous"}])])
        result = run(AntiSlopInput(pages=[home]))
        high_severity = [i for i in result.output.issues if i.severity == "high"]
        assert any(i.rule == "unverified_testimonial" for i in high_severity)
        assert result.output.passed is False

    def test_testimonial_matching_authentic_content_is_not_flagged(self):
        home = _page("Home", [_section("testimonials", testimonials=[{"quote": "They cleared our drain in under an hour.", "authorName": "S. Patel"}])])
        result = run(
            AntiSlopInput(
                pages=[home],
                authentic_content=AuthenticContent(known_testimonial_quotes=["They cleared our drain in under an hour."]),
            )
        )
        assert not any(i.rule == "unverified_testimonial" for i in result.output.issues)

    def test_statistic_with_no_source_is_flagged(self):
        home = _page("Home", [_section("stats", stats=[{"value": "5000+", "label": "Jobs completed"}])])
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "unverified_statistic" for i in result.output.issues)

    def test_statistic_matching_known_figure_is_not_flagged(self):
        home = _page("Home", [_section("stats", stats=[{"value": "12+", "label": "Years in business"}])])
        result = run(AntiSlopInput(pages=[home], authentic_content=AuthenticContent(known_stat_values=["12+ years"])))
        assert not any(i.rule == "unverified_statistic" for i in result.output.issues)

    def test_unverified_superlative_claim_is_flagged(self):
        home = _page("Home", [_section("hero", heading="The best plumbers in Queensland, guaranteed")])
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "unverified_claim" for i in result.output.issues)

    def test_claim_matching_authentic_content_is_not_flagged(self):
        home = _page("Home", [_section("hero", heading="Award-winning service, voted best local tradie 2025")])
        result = run(
            AntiSlopInput(
                pages=[home],
                authentic_content=AuthenticContent(known_claims=["Award-winning service, voted best local tradie 2025"]),
            )
        )
        assert not any(i.rule == "unverified_claim" for i in result.output.issues)

    def test_inline_numeric_claim_without_source_is_medium_severity(self):
        home = _page("Home", [_section("hero", heading="Trusted by over 3000 happy customers")])
        result = run(AntiSlopInput(pages=[home]))
        matches = [i for i in result.output.issues if i.rule == "unverified_inline_statistic"]
        assert len(matches) == 1
        assert matches[0].severity == "medium"


class TestStockImagery:
    def test_flags_image_from_a_known_stock_host(self):
        home = _page("Home", [_section("gallery", images=[{"src": "https://images.unsplash.com/photo-123", "alt": "A finished bathroom"}])])
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "stock_photo_host" for i in result.output.issues)

    def test_flags_generic_placeholder_alt_text(self):
        home = _page("Home", [_section("gallery", images=[{"src": "https://client-cdn.example.com/photo1.jpg", "alt": "stock photo"}])])
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "generic_alt_text" for i in result.output.issues)

    def test_real_client_photo_with_descriptive_alt_is_not_flagged(self):
        home = _page(
            "Home",
            [
                _section("hero", heading="Real, specific heading about this business"),
                _section("gallery", images=[{"src": "https://client-cdn.example.com/riverside-job-42.jpg", "alt": "Newly installed gas hot water unit on an exterior wall"}]),
            ],
        )
        result = run(AntiSlopInput(pages=[home]))
        assert result.output.issues == []


class TestStructure:
    def test_flags_same_section_type_stacked_back_to_back(self):
        home = _page(
            "Home",
            [
                _section("serviceCards", services=[{"title": "A", "description": "d"}]),
                _section("serviceCards", services=[{"title": "B", "description": "d"}]),
            ],
        )
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "repeated_adjacent_section" for i in result.output.issues)

    def test_flags_excessive_card_sections_on_one_page(self):
        card_section = lambda t: _section(t, **{"services" if t == "serviceCards" else "features" if t == "features" else "members" if t == "team" else "projects": [{"title": "x", "description": "d"}]})
        home = _page(
            "Home",
            [
                _section("hero", heading="Real heading"),
                card_section("serviceCards"),
                card_section("features"),
                card_section("team"),
                card_section("portfolio"),
            ],
        )
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "excessive_card_sections" for i in result.output.issues)

    def test_flags_generic_layout_with_no_hero_or_anchor(self):
        home = _page("Home", [_section("serviceCards", services=[{"title": "A", "description": "d"}])])
        result = run(AntiSlopInput(pages=[home]))
        assert any(i.rule == "generic_layout" for i in result.output.issues)

    def test_page_with_hero_is_not_flagged_as_generic_layout(self):
        home = _page("Home", [_section("hero", heading="Real, specific heading about this business")])
        result = run(AntiSlopInput(pages=[home]))
        assert not any(i.rule == "generic_layout" for i in result.output.issues)


class TestVisualStyle:
    def test_defaults_never_trigger_visual_slop_findings(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home]))
        assert not any(i.category == "visual_slop" for i in result.output.issues)

    def test_heavy_gradients_are_flagged(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(gradient_usage="heavy")))
        assert any(i.rule == "excessive_gradients" for i in result.output.issues)

    def test_accent_gradients_are_not_flagged(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(gradient_usage="accent")))
        assert not any(i.rule == "excessive_gradients" for i in result.output.issues)

    def test_glassmorphism_is_flagged_whenever_reported(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(glassmorphism=True)))
        assert any(i.rule == "unnecessary_glassmorphism" for i in result.output.issues)

    def test_heavy_border_radius_is_flagged(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(border_radius="heavy")))
        assert any(i.rule == "excessive_rounded_containers" for i in result.output.issues)

    def test_heavy_animation_is_flagged(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(animation_intensity="heavy")))
        assert any(i.rule == "excessive_animations" for i in result.output.issues)

    def test_purposeless_decoration_above_threshold_is_flagged(self):
        home = _page("Home", [_section("hero", heading="Real heading here")])
        result = run(AntiSlopInput(pages=[home], visual_style=VisualStyleInput(decorative_element_count=5)))
        assert any(i.rule == "purposeless_decoration" for i in result.output.issues)


class TestScoringAndPassGate:
    def test_score_never_drops_below_zero(self):
        # Stack enough real high-severity findings to try to drive score negative.
        home = _page(
            "Home",
            [
                _section("hero", heading="Welcome to our website"),
                _section("testimonials", testimonials=[{"quote": "Fake quote one", "authorName": "A"}]),
                _section("stats", stats=[{"value": "9999", "label": "Fake stat"}]),
            ]
            * 3,
        )
        result = run(AntiSlopInput(pages=[home]))
        assert result.output.score >= 0

    def test_passed_is_false_when_any_high_severity_issue_present_even_with_high_score(self):
        home = _page(
            "Home",
            [
                _section("hero", heading="Real, specific heading about this business"),
                _section("testimonials", testimonials=[{"quote": "One unverified quote", "authorName": "A"}]),
            ],
        )
        result = run(AntiSlopInput(pages=[home]))
        assert result.output.score == 85
        assert result.output.passed is False

    def test_deterministic_repeat_calls_produce_identical_results(self):
        home = _page("Home", [_section("hero", heading="Welcome to our website")])
        input_ = AntiSlopInput(pages=[home])
        first = run(input_)
        second = run(input_)
        assert first.output == second.output
