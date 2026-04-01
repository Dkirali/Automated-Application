import os
import re
import shutil
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

RESUMES_DIR = Path(__file__).parent.parent / "resumes"

FIT_PROMPT = """You are a senior recruiter evaluating a candidate's fit for a role.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Respond in this exact format (no extra text):
FIT_SCORE: <0-100>
STRENGTHS: <comma-separated list of 2-4 matching skills or experiences>
GAPS: <comma-separated list of 1-3 missing skills, or "None">
VERDICT: <one sentence — would you recommend applying? why?>"""

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
    match = re.search(r"KEYWORDS:\s*([^\n]+)", response_text)
    if not match:
        return []
    return [k.strip() for k in match.group(1).split(",") if k.strip()]


def extract_resume_from_response(response_text: str) -> str:
    match = re.search(r"RESUME:\s*\n(.*)", response_text, re.DOTALL)
    return match.group(1).strip() if match else ""


def calculate_ats_score(keywords: list[str], resume_text: str) -> int:
    if not keywords:
        return 0
    text_lower = resume_text.lower()
    matched = sum(1 for kw in keywords if kw.lower() in text_lower)
    return round((matched / len(keywords)) * 100)


ALLOWED_EXTENSIONS = {".docx", ".doc", ".pdf"}


def read_resume_text(path: Path) -> str:
    """Read plain text from .docx, .doc, or .pdf resume files."""
    ext = path.suffix.lower()
    if ext == ".docx":
        from docx import Document
        doc = Document(path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    elif ext == ".doc":
        import mammoth
        with open(path, "rb") as f:
            result = mammoth.extract_raw_text(f)
        return result.value.strip()
    elif ext == ".pdf":
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            return "\n".join(
                page.extract_text() or "" for page in pdf.pages
            ).strip()
    else:
        raise ValueError(f"Unsupported resume format: {ext}")


# Keep old name as alias so detail view route still works
def read_docx_text(path: Path) -> str:
    return read_resume_text(path)


def write_tailored_docx(master_path: Path, new_text: str, output_path: Path):
    """Write tailored text to a .docx.
    For .docx masters: preserve formatting by copying structure.
    For .doc/.pdf masters: create a clean new document.
    """
    from docx import Document
    if master_path.suffix.lower() == ".docx":
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
    else:
        # PDF or .doc master — build a clean, styled document
        from docx.shared import Pt, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        doc = Document()
        # Tighten margins
        for section in doc.sections:
            section.top_margin = section.bottom_margin = Pt(36)
            section.left_margin = section.right_margin = Pt(54)

        # Common section heading keywords
        SECTION_KEYWORDS = {
            "experience", "education", "skills", "hard skills", "management skills",
            "about", "about me", "summary", "references", "contact", "projects",
            "certifications", "languages", "tools",
        }

        for line in new_text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            low = stripped.lower().rstrip(":")
            if low in SECTION_KEYWORDS:
                p = doc.add_paragraph()
                run = p.add_run(stripped.upper())
                run.bold = True
                run.font.size = Pt(11)
                run.font.color.rgb = RGBColor(0x1a, 0x1a, 0x2e)
                p.paragraph_format.space_before = Pt(10)
                p.paragraph_format.space_after = Pt(2)
                # Add a thin bottom border via XML
                from docx.oxml.ns import qn
                from docx.oxml import OxmlElement
                pPr = p._p.get_or_add_pPr()
                pBdr = OxmlElement('w:pBdr')
                bottom = OxmlElement('w:bottom')
                bottom.set(qn('w:val'), 'single')
                bottom.set(qn('w:sz'), '4')
                bottom.set(qn('w:space'), '1')
                bottom.set(qn('w:color'), 'CCCCCC')
                pBdr.append(bottom)
                pPr.append(pBdr)
            elif stripped.startswith(("•", "-", "*")):
                p = doc.add_paragraph(style='List Bullet')
                p.add_run(stripped.lstrip("•-* "))
                p.paragraph_format.space_after = Pt(1)
            else:
                p = doc.add_paragraph(stripped)
                p.paragraph_format.space_after = Pt(2)
        doc.save(output_path)


def export_pdf(docx_path: Path, pdf_path: Path):
    import mammoth
    from weasyprint import HTML
    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_html(f)
    HTML(string=result.value).write_pdf(str(pdf_path))


def _call_llm(prompt: str, max_tokens: int = 2048) -> str:
    """Call whichever LLM API key is configured. Priority: Groq → Gemini → Anthropic."""
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if groq_key:
        from groq import Groq
        client = Groq(api_key=groq_key)
        message = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}]
        )
        return message.choices[0].message.content

    if gemini_key:
        from google import genai
        client = genai.Client(api_key=gemini_key)
        response = client.models.generate_content(
            model="gemini-2.0-flash", contents=prompt
        )
        return response.text

    if anthropic_key:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}]
        )
        return message.content[0].text

    raise RuntimeError("No API key set — add a Groq, Gemini, or Anthropic key in Settings")


def tailor_resume(job_id: int, job_description: str, master_resume_path: str) -> dict:
    master_path = Path(master_resume_path)
    if not master_path.exists():
        raise FileNotFoundError(f"Master resume not found: {master_resume_path}")
    resume_text = read_resume_text(master_path)

    try:
        response_text = _call_llm(TAILOR_PROMPT.format(
            job_description=job_description,
            resume_text=resume_text,
        ), max_tokens=2048)
    except Exception as e:
        raise RuntimeError(f"LLM API error: {e}") from e

    keywords = extract_keywords_from_response(response_text)
    tailored_text = extract_resume_from_response(response_text)
    if not tailored_text:
        tailored_text = resume_text  # fallback: use original if parse failed
    # ATS score = % of job keywords present in the tailored resume
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


def parse_fit_score(text: str) -> int:
    m = re.search(r"FIT_SCORE:\s*(\d+)", text)
    return int(m.group(1)) if m else 0


def parse_fit_field(text: str, field: str) -> str:
    m = re.search(rf"{field}:\s*([^\n]+)", text)
    return m.group(1).strip() if m else ""


def generate_fit_summary(job_description: str, master_resume_path: str) -> dict:
    """
    Call LLM to evaluate how well the candidate fits the job.
    Returns: {fit_score, strengths, gaps, verdict, raw}
    """
    master_path = Path(master_resume_path)
    if not master_path.exists():
        raise FileNotFoundError(f"Master resume not found: {master_resume_path}")
    resume_text = read_resume_text(master_path)

    try:
        raw = _call_llm(FIT_PROMPT.format(
            job_description=job_description[:4000],
            resume_text=resume_text[:3000],
        ), max_tokens=512)
    except Exception as e:
        raise RuntimeError(f"LLM API error: {e}") from e

    return {
        "fit_score":  parse_fit_score(raw),
        "strengths":  [s.strip() for s in parse_fit_field(raw, "STRENGTHS").split(",") if s.strip()],
        "gaps":       [g.strip() for g in parse_fit_field(raw, "GAPS").split(",") if g.strip()],
        "verdict":    parse_fit_field(raw, "VERDICT"),
        "raw":        raw,
    }
