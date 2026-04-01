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

    # Use side_effect so each locator(selector) call returns a distinct mock,
    # preventing MagicMock from collapsing all calls onto the same child mock.
    mock_h3 = MagicMock()
    mock_h3.inner_text.return_value = "Product Manager"

    mock_company = MagicMock()
    mock_company.inner_text.return_value = "Trendyol"

    mock_location = MagicMock()
    mock_location.first.inner_text.return_value = "Istanbul"

    mock_link = MagicMock()
    mock_link.first.get_attribute.return_value = "https://linkedin.com/jobs/view/123"

    def locator_side_effect(selector):
        mapping = {
            "h3": mock_h3,
            ".job-card-container__primary-description": mock_company,
            ".job-card-container__metadata-item": mock_location,
            "a": mock_link,
        }
        return mapping.get(selector, MagicMock())

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
