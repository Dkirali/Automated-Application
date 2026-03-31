import os
import re
import shutil
from pathlib import Path

RESUMES_DIR = Path("resumes")

TAILOR_PROMPT = """You are an expert resume writer specialising in ATS optimisation.

Job Posting:
{job_description}

Current Resume:
{resume_text}

Task:
1. Extract the 8-12 most important ATS keywords from the job posting (skills, tools, methodologies, titles).
2. Rewrite the resume experience bullet points to naturally incorporate these keywords where truthful.
3. Do NOT invent experience. Only rephrase existing content to better match the posting.

Respond in this exact format:
KEYWORDS: keyword1, keyword2, keyword3, ...
RESUME:
[Full rewritten resume text, preserving all sections and structure]"""


def extract_keywords_from_response(response_text: str) -> list[str]:
    match = re.search(r"KEYWORDS:\s*(.+)", response_text)
    if not match:
        return []
    return [k.strip() for k in match.group(1).split(",") if k.strip()]


def extract_resume_from_response(response_text: str) -> str:
    match = re.search(r"RESUME:\s*\n(.*)", response_text, re.DOTALL)
    return match.group(1).strip() if match else response_text


def calculate_ats_score(keywords: list[str], resume_text: str) -> int:
    if not keywords:
        return 0
    text_lower = resume_text.lower()
    matched = sum(1 for kw in keywords if kw.lower() in text_lower)
    return round((matched / len(keywords)) * 100)


def read_docx_text(path: Path) -> str:
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def write_tailored_docx(master_path: Path, new_text: str, output_path: Path):
    from docx import Document
    shutil.copy(master_path, output_path)
    doc = Document(output_path)
    lines = [l for l in new_text.splitlines() if l.strip()]
    para_idx = 0
    for para in doc.paragraphs:
        if para.text.strip() and para_idx < len(lines):
            for run in para.runs:
                run.text = ""
            if para.runs:
                para.runs[0].text = lines[para_idx]
            para_idx += 1
    doc.save(output_path)


def export_pdf(docx_path: Path, pdf_path: Path):
    import mammoth
    from weasyprint import HTML
    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_html(f)
    HTML(string=result.value).write_pdf(str(pdf_path))


def tailor_resume(job_id: int, job_description: str, master_resume_path: str) -> dict:
    import anthropic
    master_path = Path(master_resume_path)
    resume_text = read_docx_text(master_path)

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": TAILOR_PROMPT.format(
                job_description=job_description,
                resume_text=resume_text
            )
        }]
    )

    response_text = message.content[0].text
    keywords = extract_keywords_from_response(response_text)
    tailored_text = extract_resume_from_response(response_text)
    ats_score = calculate_ats_score(keywords, tailored_text)

    job_dir = RESUMES_DIR / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)

    docx_path = job_dir / "tailored.docx"
    pdf_path = job_dir / "tailored.pdf"

    write_tailored_docx(master_path, tailored_text, docx_path)

    try:
        export_pdf(docx_path, pdf_path)
    except Exception:
        pdf_path = None

    return {
        "keywords": keywords,
        "ats_score": ats_score,
        "docx_path": str(docx_path),
        "pdf_path": str(pdf_path) if pdf_path else None,
    }
