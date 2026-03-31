import pytest
from engine.resume import extract_keywords_from_response, calculate_ats_score

def test_extract_keywords_returns_list():
    response = "KEYWORDS: product roadmap, OKRs, stakeholder management, agile\nRESUME:\nsome text"
    result = extract_keywords_from_response(response)
    assert isinstance(result, list)
    assert "OKRs" in result
    assert "agile" in result

def test_calculate_ats_score():
    keywords = ["product roadmap", "OKRs", "agile", "stakeholder management"]
    resume_text = "Led product roadmap initiatives. Used OKRs for goal setting."
    score = calculate_ats_score(keywords, resume_text)
    assert 0 <= score <= 100
    assert score == 50  # 2 of 4 keywords matched

def test_calculate_ats_score_perfect():
    keywords = ["python", "flask"]
    resume_text = "Built python apps with flask framework."
    assert calculate_ats_score(keywords, resume_text) == 100
