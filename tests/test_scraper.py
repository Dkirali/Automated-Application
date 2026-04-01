import pytest
from unittest.mock import MagicMock, patch
from engine.scraper import is_easy_apply, parse_job_card, build_search_url

def test_is_easy_apply_true():
    mock_page = MagicMock()
    mock_page.locator.return_value.count.return_value = 1
    assert is_easy_apply(mock_page) is True

def test_is_easy_apply_false():
    mock_page = MagicMock()
    mock_page.locator.return_value.count.return_value = 0
    assert is_easy_apply(mock_page) is False

def test_parse_job_card_returns_dict():
    mock_card = MagicMock()

    # The updated parse_job_card uses multi-selector fallbacks with .count() checks.
    # We need mocks that return count()>0 and proper text/href for the selectors
    # that parse_job_card will try first.

    def make_text_mock(text, count=1):
        m = MagicMock()
        m.count.return_value = count
        m.first.inner_text.return_value = text
        m.inner_text.return_value = text
        return m

    def make_href_mock(href, count=1):
        m = MagicMock()
        m.count.return_value = count
        m.first.get_attribute.return_value = href
        return m

    def make_empty_mock():
        m = MagicMock()
        m.count.return_value = 0
        return m

    def locator_side_effect(selector):
        # Title — match on "h3" (last fallback in the list)
        if selector == "h3":
            return make_text_mock("Product Manager")
        # Company — match on "h4"
        elif selector == "h4":
            return make_text_mock("Trendyol")
        # Location
        elif selector == ".job-card-container__metadata-item":
            return make_text_mock("Istanbul")
        # URL
        elif selector == "a[href*='/jobs/view/']":
            return make_href_mock("https://linkedin.com/jobs/view/123")
        else:
            return make_empty_mock()

    mock_card.locator.side_effect = locator_side_effect

    result = parse_job_card(mock_card)
    assert result["title"] == "Product Manager"
    assert result["company"] == "Trendyol"
    assert result["location"] == "Istanbul"
    assert "linkedin.com" in result["url"]


def test_build_search_url_with_filters():
    filters = {
        "location_text": "Istanbul",
        "work_types": ["2", "3"],
        "experience_levels": ["3", "4"],
        "date_posted": "r604800",
    }
    url = build_search_url(["Product Manager", "Ops Manager"], filters)
    assert "f_WT=2%2C3" in url or "f_WT=2,3" in url
    assert "f_E=3%2C4" in url or "f_E=3,4" in url
    assert "f_TPR=r604800" in url
    assert "Istanbul" in url


def test_build_search_url_no_filters():
    url = build_search_url(["Engineer"], {})
    assert "Engineer" in url
    assert "f_WT" not in url
    assert "f_E" not in url
    assert "f_TPR" not in url
