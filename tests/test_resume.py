import pytest
from pathlib import Path
from engine.resume import extract_keywords_from_response, calculate_ats_score, extract_resume_from_response, read_resume_text

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

def test_extract_resume_from_response():
    response = "KEYWORDS: python\nRESUME:\nExperienced engineer with Python skills."
    result = extract_resume_from_response(response)
    assert result == "Experienced engineer with Python skills."

def test_extract_resume_missing_marker():
    result = extract_resume_from_response("some random text without marker")
    assert result == ""


def test_read_resume_text_unsupported_format(tmp_path):
    fake = tmp_path / "resume.xyz"
    fake.write_text("hello")
    with pytest.raises(ValueError, match="Unsupported"):
        read_resume_text(fake)
