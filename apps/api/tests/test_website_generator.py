"""
Tests for the deterministic website-generation agent
(app/agents/website_generator.py). Fixtures use a small plumbing
business, consistent with docs/00_VISION.md's target customer and
test_anti_slop.py's fixtures.
"""

from app.agents.website_generator import (
    BriefContent,
    SitemapPageContent,
    WebsiteGeneratorInput,
    run,
)


def _page(**kwargs) -> SitemapPageContent:
    defaults = {"id": "p1", "title": "Home", "slug": "", "page_type": "home"}
    return SitemapPageContent(**{**defaults, **kwargs})


class TestNeverFabricates:
    def test_no_testimonials_section_when_brief_has_none(self):
        result = run(WebsiteGeneratorInput(business_name="Riverside Plumbing", pages=[_page()]))
        home = result.output.pages[0]
        assert not any(s.type == "testimonials" for s in home.sections)

    def test_no_service_cards_when_no_service_content_at_all(self):
        result = run(
            WebsiteGeneratorInput(business_name="Riverside Plumbing", pages=[_page(page_type="services", slug="services")])
        )
        page = result.output.pages[0]
        assert not any(s.type == "serviceCards" for s in page.sections)
        assert any("isn't structured as a clear list" in m for m in result.output.missing_information)

    def test_unstructured_service_prose_is_not_split_into_fake_cards(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(
                    services_content="We handle everything from small leaks to full bathroom renovations, "
                    "with the same crew from quote to completion."
                ),
                pages=[_page(page_type="services", slug="services")],
            )
        )
        page = result.output.pages[0]
        assert not any(s.type == "serviceCards" for s in page.sections)
        hero = next(s for s in page.sections if s.type == "hero")
        assert "same crew from quote to completion" in hero.config["subheading"]

    def test_no_pricing_team_portfolio_gallery_stats_logos_sections_ever(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                pages=[_page(key_sections=["pricing", "team", "portfolio", "gallery", "stats", "logos"])],
            )
        )
        types = {s.type for p in result.output.pages for s in p.sections}
        assert types.isdisjoint({"pricing", "team", "portfolio", "gallery", "stats", "logos"})
        assert len(result.output.missing_information) == 6

    def test_testimonial_text_is_used_verbatim_with_blank_not_invented_attribution(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(testimonials=["Fixed our hot water same afternoon."]),
                pages=[_page()],
            )
        )
        testimonials_section = next(s for s in result.output.pages[0].sections if s.type == "testimonials")
        item = testimonials_section.config["testimonials"][0]
        assert item["quote"] == "Fixed our hot water same afternoon."
        assert item["authorName"] == ""
        assert any("no author name captured" in m for m in result.output.missing_information)


class TestStructuredListDetection:
    def test_a_short_line_list_becomes_service_cards(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(services_content="Blocked drains\nHot water systems\nLeak detection"),
                pages=[_page(page_type="services", slug="services")],
            )
        )
        page = result.output.pages[0]
        cards = next(s for s in page.sections if s.type == "serviceCards")
        titles = [item["title"] for item in cards.config["services"]]
        assert titles == ["Blocked drains", "Hot water systems", "Leak detection"]
        # No invented per-item description beyond the source line.
        assert all(item["description"] == "" for item in cards.config["services"])

    def test_a_single_long_line_is_not_treated_as_a_list(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(services_content="Full-service residential and commercial plumbing"),
                pages=[_page(page_type="services", slug="services")],
            )
        )
        page = result.output.pages[0]
        assert not any(s.type == "serviceCards" for s in page.sections)


class TestFaqHandling:
    def test_splits_question_and_answer_on_first_question_mark(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(faqs=["Do you charge a callout fee? No, quotes are always free."]),
                pages=[_page(page_type="faq", slug="faq")],
            )
        )
        faq = next(s for s in result.output.pages[0].sections if s.type == "faq")
        item = faq.config["items"][0]
        assert item["question"] == "Do you charge a callout fee?"
        assert item["answer"] == "No, quotes are always free."

    def test_a_line_with_no_question_mark_gets_a_blank_answer_and_is_flagged(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(faqs=["Callout fees and cancellation policy"]),
                pages=[_page(page_type="faq", slug="faq")],
            )
        )
        faq = next(s for s in result.output.pages[0].sections if s.type == "faq")
        assert faq.config["items"][0]["answer"] == ""
        assert any("has no answer on file yet" in m for m in result.output.missing_information)


class TestContactPage:
    def test_uses_only_real_contact_fields_present(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(contact_email="hello@riversideplumbing.com.au"),
                pages=[_page(page_type="contact", slug="contact")],
            )
        )
        contact = next(s for s in result.output.pages[0].sections if s.type == "contact")
        assert contact.config["details"] == [
            {"label": "Email", "value": "hello@riversideplumbing.com.au", "href": "mailto:hello@riversideplumbing.com.au"}
        ]

    def test_always_includes_a_generic_structural_form_not_a_business_claim(self):
        result = run(WebsiteGeneratorInput(business_name="Riverside Plumbing", pages=[_page(page_type="contact", slug="contact")]))
        contact = next(s for s in result.output.pages[0].sections if s.type == "contact")
        assert contact.config["form"]["submitLabel"] == "Send message"

    def test_flags_when_no_contact_details_on_file(self):
        result = run(WebsiteGeneratorInput(business_name="Riverside Plumbing", pages=[_page(page_type="contact", slug="contact")]))
        assert any("no contact details" in m for m in result.output.missing_information)


class TestNavigationAndFooter:
    def test_navigation_links_only_primary_nav_pages(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                pages=[
                    _page(),
                    _page(id="p2", title="Services", slug="services", page_type="services", nav_placement="primary_nav"),
                    _page(id="p3", title="Privacy Policy", slug="privacy", page_type="custom", nav_placement="footer_nav"),
                ],
            )
        )
        nav_labels = [link["label"] for link in result.output.navigation.config["links"]]
        assert "Services" in nav_labels
        assert "Privacy Policy" not in nav_labels

    def test_footer_gets_footer_nav_pages_and_real_copyright_holder(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                pages=[_page(), _page(id="p2", title="Privacy Policy", slug="privacy", page_type="custom", nav_placement="footer_nav")],
            )
        )
        assert result.output.footer.config["copyrightHolder"] == "Riverside Plumbing"
        footer_labels = [link["label"] for col in result.output.footer.config["columns"] for link in col["links"]]
        assert "Privacy Policy" in footer_labels

    def test_nav_cta_uses_the_contact_pages_real_primary_cta_text(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                pages=[_page(), _page(id="p2", title="Contact", slug="contact", page_type="contact", primary_cta="Get a quote")],
            )
        )
        assert result.output.navigation.config["cta"] == {"label": "Get a quote", "href": "/contact"}


class TestAntiSlopIntegration:
    def test_clean_honest_input_scores_high_with_no_high_severity_issues(self):
        result = run(
            WebsiteGeneratorInput(
                business_name="Riverside Plumbing",
                brief=BriefContent(business_description="Licensed local plumbers serving Ipswich since 2011."),
                pages=[_page()],
            )
        )
        assert result.output.anti_slop.score == 100
        assert not any(i.severity == "high" for i in result.output.anti_slop.issues)

    def test_output_is_deterministic_across_repeated_calls(self):
        input_ = WebsiteGeneratorInput(
            business_name="Riverside Plumbing",
            brief=BriefContent(business_description="Licensed local plumbers serving Ipswich since 2011."),
            pages=[_page()],
        )
        first = run(input_)
        second = run(input_)

        def section_types(result):
            return [s.type for p in result.output.pages for s in p.sections]

        assert section_types(first) == section_types(second)
        assert first.output.navigation.config == second.output.navigation.config
        assert first.output.footer.config == second.output.footer.config
        assert first.output.anti_slop.score == second.output.anti_slop.score
        assert first.output.missing_information == second.output.missing_information
