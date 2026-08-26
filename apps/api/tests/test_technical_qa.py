"""
Tests for the deterministic technical QA evaluator
(app/agents/technical_qa.py). Static checks are tested directly since
they're pure functions of the generated config. Live-preview checks are
tested against the pure signal->QaCheck mapping functions with a
constructed QaPageSignals — app/integrations/browser.py's actual
Playwright driver is exercised manually (like fetch_page_signals — see
tests/test_website_audit_ssrf.py, which only unit-tests its SSRF
rejection, not real page rendering), plus the same SSRF-rejection
contract is verified here directly.
"""

import asyncio

from app.agents.technical_qa import (
    PageInput,
    PageSeoInput,
    SectionInput,
    TechnicalQaInput,
    _accessibility_contrast_check_from_signals,
    _https_check_from_signals,
    _markup_checks_from_signals,
    _responsiveness_checks_from_signals,
    run,
)
from app.integrations.browser import QaPageSignals, fetch_qa_signals


def _page(name="Home", slug="", seo=None, sections=None) -> PageInput:
    return PageInput(
        name=name,
        slug=slug,
        seo=seo or PageSeoInput(title=f"{name} | Riverside Plumbing", meta_description="Real description."),
        # sections=[] must stay empty (an explicit "no content" test
        # fixture) — `sections or [default]` would silently substitute
        # the default since an empty list is falsy.
        # The default hero carries a primaryCta (an anchor href, so it's
        # never flagged by the broken-internal-link check either) so
        # this fixture is a genuinely clean/passing baseline — including
        # for the "Calls to action present" check.
        sections=[SectionInput(type="hero", config={"heading": "Real heading", "primaryCta": {"label": "Get a quote", "href": "#contact"}})] if sections is None else sections,
    )


def _base_input(pages=None, navigation=None, footer=None, **kwargs) -> TechnicalQaInput:
    return TechnicalQaInput(
        navigation=navigation or SectionInput(type="navigation", config={"logo": {"label": "Riverside Plumbing"}, "links": [{"label": "Home", "href": "/"}]}),
        footer=footer or SectionInput(type="footer", config={"copyrightHolder": "Riverside Plumbing"}),
        pages=pages or [_page()],
        **kwargs,
    )


def _find(checks, name):
    return next(c for c in checks if c.name == name)


class TestReportCompleteness:
    def test_every_category_has_at_least_one_check_and_nothing_is_silently_omitted(self):
        result = run(_base_input())
        categories = {c.category for c in result.output.checks}
        assert categories == {"performance", "responsiveness", "accessibility", "seo", "functionality", "security", "markup"}
        assert result.output.passed_count + result.output.failed_count + result.output.warning_count + result.output.skipped_count == len(
            result.output.checks
        )

    def test_responsiveness_is_reported_as_skipped_not_omitted_without_a_preview_url(self):
        result = run(_base_input())
        responsiveness = [c for c in result.output.checks if c.category == "responsiveness"]
        assert len(responsiveness) == 3
        assert all(c.status == "skipped" for c in responsiveness)


class TestPerformance:
    def test_flags_base64_embedded_images(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "data:image/png;base64,AAAA", "alt": "x"}]})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Embedded (data URI) images")
        assert check.status == "fail"

    def test_real_hosted_image_is_not_flagged(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "https://cdn.example.com/a.jpg", "alt": "x", "width": 800, "height": 600}]})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Embedded (data URI) images")
        assert check.status == "pass"

    def test_flags_images_missing_dimensions(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "https://cdn.example.com/a.jpg", "alt": "x"}]})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Image dimensions specified")
        assert check.status == "warning"

    def test_flags_an_excessively_long_page(self):
        sections = [SectionInput(type="hero", config={"heading": f"h{i}"}) for i in range(20)]
        pages = [_page(sections=sections)]
        result = run(_base_input(pages=pages))
        page_length_checks = [c for c in result.output.checks if c.name == "Page length"]
        assert any(c.status == "warning" for c in page_length_checks)

    def test_reports_no_custom_javascript_as_passing(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Custom client-side JavaScript").status == "pass"


class TestAccessibility:
    def test_missing_alt_text_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "https://cdn.example.com/a.jpg", "alt": ""}]})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Image alt text")
        assert check.status == "fail"
        assert check.severity == "critical"
        assert result.output.ready_for_client_review is False

    def test_present_alt_text_passes(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "https://cdn.example.com/a.jpg", "alt": "A finished kitchen renovation"}]})])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Image alt text").status == "pass"

    def test_two_hero_sections_on_one_page_is_a_duplicate_h1_failure(self):
        pages = [_page(sections=[SectionInput(type="hero", config={"heading": "A"}), SectionInput(type="hero", config={"heading": "B"})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Heading hierarchy")
        assert check.status == "fail"

    def test_one_hero_per_page_passes(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Heading hierarchy").status == "pass"

    def test_form_field_with_no_label_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="contact", config={"form": {"fields": [{"name": "email", "label": "", "type": "email"}], "submitLabel": "Send"}})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Form field labels")
        assert check.status == "fail"
        assert check.severity == "critical"

    def test_labeled_form_fields_pass(self):
        pages = [_page(sections=[SectionInput(type="contact", config={"form": {"fields": [{"name": "email", "label": "Email", "type": "email"}], "submitLabel": "Send"}})])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Form field labels").status == "pass"

    def test_keyboard_and_semantic_html_pass_by_construction(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Keyboard accessibility").status == "pass"
        assert _find(result.output.checks, "Semantic HTML").status == "pass"

    def test_colour_contrast_is_skipped_without_a_preview(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Colour contrast").status == "skipped"


class TestSeo:
    def test_missing_meta_description_is_a_warning_not_a_failure(self):
        pages = [_page(seo=PageSeoInput(title="Home | Riverside Plumbing", meta_description=None))]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Meta descriptions")
        assert check.status == "warning"

    def test_present_meta_description_passes(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Meta descriptions").status == "pass"

    def test_canonical_check_is_skipped_with_no_domain_and_a_failure_once_a_domain_exists(self):
        without_domain = run(_base_input())
        assert _find(without_domain.output.checks, "Canonical URL configuration").status == "skipped"

        with_domain = run(_base_input(domain="riversideplumbing.com.au"))
        assert _find(with_domain.output.checks, "Canonical URL configuration").status == "fail"

    def test_robots_and_sitemap_are_skipped_pre_deployment(self):
        result = run(_base_input())
        check = _find(result.output.checks, "robots.txt / sitemap.xml")
        assert check.status == "skipped"


class TestFunctionality:
    def test_internal_link_to_a_real_page_passes(self):
        pages = [
            _page(name="Home", slug=""),
            _page(name="Contact", slug="contact", sections=[SectionInput(type="cta", config={"heading": "x", "primaryCta": {"label": "Go", "href": "/contact"}})]),
        ]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Internal links resolve").status == "pass"

    def test_internal_link_to_a_nonexistent_page_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="cta", config={"heading": "x", "primaryCta": {"label": "Go", "href": "/pricing"}})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Internal links resolve")
        assert check.status == "fail"
        assert check.severity == "critical"

    def test_external_and_anchor_and_mailto_links_are_never_flagged(self):
        pages = [
            _page(
                sections=[
                    SectionInput(
                        type="footer",
                        config={
                            "socialLinks": [
                                {"label": "FB", "href": "https://facebook.com/riversideplumbing"},
                                {"label": "Email", "href": "mailto:hello@riversideplumbing.com.au"},
                                {"label": "Call", "href": "tel:0412345678"},
                                {"label": "Jump", "href": "#top"},
                            ]
                        },
                    )
                ]
            )
        ]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Internal links resolve").status == "pass"

    def test_form_with_no_fields_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="contact", config={"form": {"fields": [], "submitLabel": "Send"}})])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Forms").status == "fail"

    def test_empty_navigation_links_is_a_failure(self):
        result = run(_base_input(navigation=SectionInput(type="navigation", config={"logo": {"label": "x"}, "links": []})))
        assert _find(result.output.checks, "Navigation").status == "fail"

    def test_page_with_no_sections_is_a_missing_page_failure(self):
        pages = [_page(sections=[])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Missing pages")
        assert check.status == "fail"

    def test_image_with_no_src_is_a_critical_missing_asset(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "", "alt": "x"}]})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Missing assets")
        assert check.status == "fail"
        assert check.severity == "critical"


class TestCallsToAction:
    def test_page_with_hero_cta_passes(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Calls to action present").status == "pass"

    def test_hero_with_no_cta_and_no_other_cta_bearing_section_fails(self):
        pages = [_page(sections=[SectionInput(type="hero", config={"heading": "Real heading"})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "Calls to action present")
        assert check.status == "fail"
        assert check.severity == "high"

    def test_dedicated_cta_section_satisfies_the_check_even_without_a_hero_button(self):
        pages = [
            _page(
                sections=[
                    SectionInput(type="hero", config={"heading": "Real heading"}),
                    SectionInput(type="cta", config={"heading": "Ready?", "primaryCta": {"label": "Call now", "href": "tel:0412345678"}}),
                ]
            )
        ]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Calls to action present").status == "pass"

    def test_contact_section_satisfies_the_check(self):
        pages = [
            _page(sections=[SectionInput(type="hero", config={"heading": "Real heading"}), SectionInput(type="contact", config={"details": "Call us"})])
        ]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Calls to action present").status == "pass"

    def test_empty_page_is_not_double_flagged_for_missing_cta(self):
        # Already reported by "Missing pages" — flagging it again here
        # too would be redundant noise about the same underlying gap.
        pages = [_page(sections=[])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Calls to action present").status == "pass"


class TestMarkup:
    def test_raw_html_tag_in_content_is_flagged(self):
        pages = [_page(sections=[SectionInput(type="hero", config={"heading": "Save <b>big</b> today"})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "No raw HTML tags in content")
        assert check.status == "fail"

    def test_clean_content_has_no_raw_html_tags(self):
        result = run(_base_input())
        assert _find(result.output.checks, "No raw HTML tags in content").status == "pass"

    def test_duplicate_and_lang_checks_are_skipped_without_a_preview_url(self):
        result = run(_base_input())
        assert _find(result.output.checks, "Duplicate element IDs").status == "skipped"
        assert _find(result.output.checks, "<html lang> attribute").status == "skipped"

    def test_duplicate_ids_from_signals_fail(self):
        checks = _markup_checks_from_signals(QaPageSignals(duplicate_ids=["nav-link"], html_lang_present=True))
        assert _find(checks, "Duplicate element IDs").status == "fail"

    def test_no_duplicate_ids_from_signals_passes(self):
        checks = _markup_checks_from_signals(QaPageSignals(duplicate_ids=[], html_lang_present=True))
        assert _find(checks, "Duplicate element IDs").status == "pass"

    def test_missing_html_lang_from_signals_fails(self):
        checks = _markup_checks_from_signals(QaPageSignals(duplicate_ids=[], html_lang_present=False))
        assert _find(checks, "<html lang> attribute").status == "fail"

    def test_present_html_lang_from_signals_passes(self):
        checks = _markup_checks_from_signals(QaPageSignals(duplicate_ids=[], html_lang_present=True))
        assert _find(checks, "<html lang> attribute").status == "pass"

    def test_unmeasured_signals_are_skipped_not_omitted(self):
        checks = _markup_checks_from_signals(QaPageSignals())
        assert _find(checks, "Duplicate element IDs").status == "skipped"
        assert _find(checks, "<html lang> attribute").status == "skipped"


class TestSecurity:
    def test_script_tag_in_content_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="hero", config={"heading": "Hi <script>alert(1)</script>"})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "No injected scripts / javascript: URIs")
        assert check.status == "fail"
        assert check.severity == "critical"

    def test_javascript_uri_in_a_link_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="cta", config={"heading": "x", "primaryCta": {"label": "Go", "href": "javascript:alert(1)"}})])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "No injected scripts / javascript: URIs").status == "fail"

    def test_aws_key_shaped_string_is_a_critical_failure(self):
        pages = [_page(sections=[SectionInput(type="hero", config={"heading": "note", "subheading": "AKIAABCDEFGHIJKLMNOP leaked in copy"})])]
        result = run(_base_input(pages=pages))
        check = _find(result.output.checks, "No exposed secrets")
        assert check.status == "fail"
        assert check.severity == "critical"

    def test_clean_content_has_no_security_failures(self):
        result = run(_base_input())
        security_checks = [c for c in result.output.checks if c.category == "security"]
        assert not any(c.status == "fail" for c in security_checks)

    def test_form_action_over_plain_http_is_a_failure(self):
        pages = [_page(sections=[SectionInput(type="contact", config={"form": {"fields": [{"name": "e", "label": "Email", "type": "email"}], "submitLabel": "Send", "action": "http://example.com/submit"}})])]
        result = run(_base_input(pages=pages))
        assert _find(result.output.checks, "Form submissions use HTTPS").status == "fail"

    def test_unsafe_client_side_rendering_passes_by_construction(self):
        result = run(_base_input())
        assert _find(result.output.checks, "No unsafe client-side rendering").status == "pass"


class TestReadyForClientReview:
    def test_clean_site_is_ready_for_review(self):
        result = run(_base_input())
        assert result.output.ready_for_client_review is True
        assert result.flagged_for_review is False

    def test_any_critical_failure_blocks_readiness_even_with_many_passes(self):
        pages = [_page(sections=[SectionInput(type="gallery", config={"images": [{"src": "https://cdn.example.com/a.jpg", "alt": ""}]})])]
        result = run(_base_input(pages=pages))
        assert result.output.ready_for_client_review is False
        assert result.flagged_for_review is True

    def test_warnings_alone_do_not_block_readiness(self):
        pages = [_page(seo=PageSeoInput(title="Home | Riverside Plumbing", meta_description=None))]
        result = run(_base_input(pages=pages))
        assert result.output.ready_for_client_review is True

    def test_deterministic_repeat_calls_produce_identical_results(self):
        input_ = _base_input()
        first = run(input_)
        second = run(input_)
        assert [c.model_dump() for c in first.output.checks] == [c.model_dump() for c in second.output.checks]


class TestLiveSignalMapping:
    """The pure functions that turn a QaPageSignals into QaChecks — the
    part of the live-preview path that's real, deterministic Python
    logic. app/integrations/browser.py's actual Playwright driver is
    verified manually, same as fetch_page_signals (see module
    docstring)."""

    def test_overflow_at_any_viewport_fails_responsiveness(self):
        signals = QaPageSignals(desktop_overflow=False, tablet_overflow=True, mobile_overflow=False)
        checks = _responsiveness_checks_from_signals(signals)
        assert _find(checks, "Tablet layout").status == "fail"
        assert _find(checks, "Desktop layout").status == "pass"

    def test_no_overflow_passes_every_viewport(self):
        signals = QaPageSignals(desktop_overflow=False, tablet_overflow=False, mobile_overflow=False)
        checks = _responsiveness_checks_from_signals(signals)
        assert all(c.status == "pass" for c in checks)

    def test_low_contrast_ratio_fails_wcag_aa(self):
        check = _accessibility_contrast_check_from_signals(QaPageSignals(min_contrast_ratio=2.1))
        assert check.status == "fail"

    def test_sufficient_contrast_ratio_passes(self):
        check = _accessibility_contrast_check_from_signals(QaPageSignals(min_contrast_ratio=7.0))
        assert check.status == "pass"

    def test_non_https_preview_is_a_critical_failure(self):
        check = _https_check_from_signals(QaPageSignals(https=False))
        assert check.status == "fail"
        assert check.severity == "critical"

    def test_https_preview_passes(self):
        check = _https_check_from_signals(QaPageSignals(https=True))
        assert check.status == "pass"

    def test_a_failed_preview_load_reports_every_dependent_check_as_skipped_not_omitted(self, monkeypatch):
        async def fake_fetch(url, paths):
            return QaPageSignals(error="net::ERR_CONNECTION_REFUSED")

        monkeypatch.setattr("app.agents.technical_qa.fetch_qa_signals", fake_fetch)
        result = run(_base_input(preview_url="https://preview.example.com/"))
        preview_check = _find(result.output.checks, "Preview reachable")
        assert preview_check.status == "fail"
        assert preview_check.severity == "critical"
        responsiveness = [c for c in result.output.checks if c.category == "responsiveness"]
        assert all(c.status == "skipped" for c in responsiveness)
        markup = [c for c in result.output.checks if c.category == "markup" and c.name != "No raw HTML tags in content"]
        assert all(c.status == "skipped" for c in markup)

    def test_a_successful_preview_wires_live_checks_into_the_report(self, monkeypatch):
        async def fake_fetch(url, paths):
            return QaPageSignals(
                https=True, desktop_overflow=False, tablet_overflow=False, mobile_overflow=False,
                console_errors=[], broken_internal_links=[], min_contrast_ratio=7.0, total_transfer_bytes=500_000,
                duplicate_ids=[], html_lang_present=True,
            )

        monkeypatch.setattr("app.agents.technical_qa.fetch_qa_signals", fake_fetch)
        result = run(_base_input(preview_url="https://preview.example.com/"))
        assert _find(result.output.checks, "Served over HTTPS").status == "pass"
        assert _find(result.output.checks, "Console errors").status == "pass"
        assert _find(result.output.checks, "Internal links reachable").status == "pass"
        assert _find(result.output.checks, "Total page weight").status == "pass"
        assert _find(result.output.checks, "Duplicate element IDs").status == "pass"
        assert _find(result.output.checks, "<html lang> attribute").status == "pass"
        assert not any(c.category == "responsiveness" and c.status == "skipped" for c in result.output.checks)

    def test_console_errors_from_a_live_preview_are_reported(self, monkeypatch):
        async def fake_fetch(url, paths):
            return QaPageSignals(
                https=True, desktop_overflow=False, tablet_overflow=False, mobile_overflow=False,
                console_errors=["Uncaught TypeError: x is not a function"], broken_internal_links=[],
                min_contrast_ratio=7.0, total_transfer_bytes=100,
            )

        monkeypatch.setattr("app.agents.technical_qa.fetch_qa_signals", fake_fetch)
        result = run(_base_input(preview_url="https://preview.example.com/"))
        check = _find(result.output.checks, "Console errors")
        assert check.status == "fail"
        assert "TypeError" in check.message


class TestSsrfGuard:
    def test_fetch_qa_signals_rejects_localhost(self):
        result = asyncio.run(fetch_qa_signals("http://localhost:8000/", ["/"]))
        assert result.error is not None
        assert "localhost" in result.error.lower()

    def test_fetch_qa_signals_rejects_private_ip(self):
        result = asyncio.run(fetch_qa_signals("http://127.0.0.1:9000/", ["/"]))
        assert result.error is not None
