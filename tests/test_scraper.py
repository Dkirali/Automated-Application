import pytest
from unittest.mock import MagicMock, patch
from engine.scraper import is_easy_apply, parse_job_card

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
