import os
import re
import shutil
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

RESUMES_DIR = Path(__file__).parent.parent / "resumes"

CANDIDATE_HEADER = {
    "name":     "Doruk Kirali",
    "phone":    "0532 286 04 61",
    "email":    "kiralidoruk@gmail.com",
    "linkedin": "linkedin.com/in/doruk-kirali",
    "github":   "github.com/Dkirali",
}

# Lines containing these strings are stripped from LLM body output to avoid
# duplicating the fixed header we prepend.
_CONTACT_SKIP_PATTERNS = [
    "kiralidoruk@gmail.com", "0532", "doruk-kirali",
    "dkirali", "linkedin.com/in/doruk", "github.com/dkirali",
]

FIT_PROMPT = """You are a senior recruiter evaluating a candidate's fit for a role.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Respond in this exact format (no extra text):
FIT_SCORE: <0-100>
STRENGTHS: <comma-separated list of 2-4 matching skills or experiences>
GAPS: <comma-separated list of 1-3 missing skills, or "None">
VERDICT: <one sentence — would you recommend applying? why?>
JD_SUMMARY: <2-3 sentence summary of the role, seniority level, and key focus areas>
JD_KEYWORDS: keyword1, keyword2, keyword3, ... <8-12 most important ATS/skills keywords from the job posting>"""

TAILOR_PROMPT = """You are an expert resume writer specialising in ATS optimisation.

Job Posting:
{job_description}

Current Resume:
{resume_text}

Task:
1. Extract the 8-12 most important ATS keywords from the job posting (skills, tools, methodologies, titles).
2. Rewrite the resume experience bullet points to incorporate these keywords where truthful.
   CRITICAL RULES for keyword incorporation:
   - Keywords must appear as PART OF THE NATURAL SENTENCE describing what was done. Good: "Led sprint planning using Agile methodologies". Bad: "Led sprint planning, demonstrating Agile skills".
   - NEVER append keyword labels to the end of a sentence (e.g. "showcasing Operational Efficiency", "utilizing Stakeholder Management", "demonstrating Communication skills"). This reads as spam.
   - NEVER start or end a bullet with a generic phrase like "applying X and Y skills" or "ensuring effective Z". Instead, describe the ACTUAL WORK that used those skills.
   - Each bullet should describe a concrete action and result, not list skill categories.
   - If a keyword cannot be naturally woven into existing content, place it in the SKILLS section instead.
3. Do NOT invent experience. Only rephrase existing content to better match the posting.
4. Format the RESUME block as plain text (no Markdown, no HTML):
   - Section headings in ALL CAPS on their own line (e.g. PROFESSIONAL EXPERIENCE, EDUCATION, SKILLS, CERTIFICATES)
   - Each role: "Company Name | Location | Start–End" on one line, then the job title on the next line
   - Use • for main bullet points, - for sub-bullets
   - Do NOT include the candidate name, phone, email, LinkedIn, or GitHub — those are added separately
5. In the CERTIFICATES section, always include these two courses if not already present:
   - Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
   - Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course
6. You MAY add new bullet points to existing experience roles if the job posting requires a skill the candidate demonstrably has from their history. Do NOT invent entirely new roles or technologies not present anywhere in the resume.
7. Only use the keyword "AI" where it genuinely refers to artificial intelligence concepts. Do NOT treat words like "main", "rain", or "training" as containing the keyword "AI".

Respond in this exact format:
KEYWORDS: keyword1, keyword2, keyword3, ...
RESUME:
[Full rewritten resume as plain text, starting directly with the first section heading]"""

TAILOR_RETRY_PROMPT = """The following tailored resume scored below 80% ATS keyword match.

These keywords are MISSING from the resume and MUST be incorporated: {missing_keywords}

Job Posting:
{job_description}

Current Resume:
{resume}

Rewrite the resume to naturally incorporate ALL of the missing keywords listed above.
Keep all existing content and structure. Only add or rephrase content — do not remove anything.
Do NOT include contact info (name, phone, email, LinkedIn, GitHub).

Respond in this exact format:
RESUME:
[Full rewritten resume as plain text]"""


def _matches_keyword(kw: str, text: str) -> bool:
    """Check if a keyword appears in text using whole-word matching for short keywords."""
    kw_lower = kw.lower()
    text_lower = text.lower()
    if len(kw_lower) <= 4:
        return bool(re.search(r'\b' + re.escape(kw_lower) + r'\b', text_lower))
    return kw_lower in text_lower


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
    matched = sum(1 for kw in keywords if _matches_keyword(kw, resume_text))
    return round((matched / len(keywords)) * 100)


def calculate_original_ats_score(keywords: list[str], master_resume_path: str) -> int:
    """Compute ATS score against the unmodified master resume."""
    master_path = Path(master_resume_path)
    if not master_path.exists() or not keywords:
        return 0
    original_text = read_resume_text(master_path)
    return calculate_ats_score(keywords, original_text)


def strip_markdown(text: str) -> str:
    """Remove Markdown markers before writing to .docx (keeps download clean)."""
    text = re.sub(r'^#{1,3}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    return text


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


def _add_section_heading(doc, text: str):
    """Add a bold ALL-CAPS section heading with a bottom border rule."""
    from docx.shared import Pt, RGBColor
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    p = doc.add_paragraph()
    run = p.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(0x1a, 0x1a, 0x2e)
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(2)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '4')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'CCCCCC')
    pBdr.append(bottom)
    pPr.append(pBdr)


SECTION_KEYWORDS = {
    "professional experience", "experience", "education", "skills", "hard skills",
    "management skills", "about", "about me", "summary", "references", "contact",
    "projects", "certifications", "certificates", "languages", "tools", "internships",
}


def write_tailored_docx(master_path: Path, new_text: str, output_path: Path):
    """Write tailored resume to .docx with fixed header block."""
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    if master_path.suffix.lower() == ".docx":
        # For .docx masters, still inject header at the start
        shutil.copy(master_path, output_path)
        doc = Document(output_path)
        # Clear all existing paragraphs and rebuild
        for para in doc.paragraphs:
            for run in para.runs:
                run.text = ""
        doc.save(output_path)
        # Fall through to rebuild cleanly
        doc = Document()
        for section in doc.sections:
            section.top_margin = section.bottom_margin = Pt(36)
            section.left_margin = section.right_margin = Pt(54)
    else:
        doc = Document()
        for section in doc.sections:
            section.top_margin = section.bottom_margin = Pt(36)
            section.left_margin = section.right_margin = Pt(54)

    # ── Fixed header ──────────────────────────────────────────────────────────
    # Name
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(CANDIDATE_HEADER["name"])
    r.bold = True
    r.font.size = Pt(18)
    p.paragraph_format.space_after = Pt(2)

    # Job title (last held role — fixed)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Product Operations Manager")
    r.bold = True
    r.font.size = Pt(12)
    p.paragraph_format.space_after = Pt(4)

    # Contact line
    contact = (
        f"{CANDIDATE_HEADER['phone']} • {CANDIDATE_HEADER['email']} • "
        f"{CANDIDATE_HEADER['linkedin']} • {CANDIDATE_HEADER['github']}"
    )
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(contact)
    r.font.size = Pt(9)
    p.paragraph_format.space_after = Pt(8)

    # ── Body ─────────────────────────────────────────────────────────────────
    # Detect lines with pipe separators as company/role metadata:
    #   "Company Name | Location | Dates"  → company line
    #   Next non-bullet line after a company line → job title (bold)
    lines = new_text.splitlines()
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        i += 1
        if not stripped:
            continue

        # Skip contact duplicates
        low = stripped.lower()
        if any(pat in low for pat in _CONTACT_SKIP_PATTERNS):
            continue
        if stripped.lower() == CANDIDATE_HEADER["name"].lower():
            continue

        # Section heading
        if low.rstrip(":") in SECTION_KEYWORDS:
            _add_section_heading(doc, stripped)
            continue

        # Bullet points
        if stripped.startswith(("•", "-", "*")):
            p = doc.add_paragraph(style='List Bullet')
            p.add_run(stripped.lstrip("•-* "))
            p.paragraph_format.space_after = Pt(1)
            continue

        # Company/role line: contains | separators (e.g. "Styx Intelligence | Vancouver, Canada | 2022–2024")
        if "|" in stripped:
            parts = [p.strip() for p in stripped.split("|")]
            company = parts[0]
            location_dates = " | ".join(parts[1:])

            # Add space before each new experience entry
            p_spacer = doc.add_paragraph()
            p_spacer.paragraph_format.space_before = Pt(4)
            p_spacer.paragraph_format.space_after = Pt(0)

            # Company name — regular weight on its own line
            p = doc.add_paragraph()
            r = p.add_run(company)
            r.font.size = Pt(10)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.space_before = Pt(0)

            # Next non-empty line should be the job title
            title_line = ""
            while i < len(lines):
                candidate = lines[i].strip()
                i += 1
                if candidate:
                    title_line = candidate
                    break

            # Job title (bold) with location | dates right-aligned
            if title_line:
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.space_before = Pt(0)
                # Use a tab stop at the right margin for right-alignment
                from docx.shared import Inches
                from docx.oxml.ns import qn
                from docx.oxml import OxmlElement
                pPr = p._p.get_or_add_pPr()
                tabs = OxmlElement('w:tabs')
                tab = OxmlElement('w:tab')
                tab.set(qn('w:val'), 'right')
                tab.set(qn('w:pos'), '9360')  # ~6.5 inches
                tabs.append(tab)
                pPr.append(tabs)

                r = p.add_run(title_line)
                r.bold = True
                r.font.size = Pt(10)
                if location_dates:
                    r2 = p.add_run(f"\t{location_dates}")
                    r2.font.size = Pt(10)
            continue

        # Any other plain text line
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
    """Call whichever LLM API key is configured. Priority: Groq → Gemini → Anthropic.
    Falls through to the next provider if one fails."""
    import logging
    _logger = logging.getLogger("jobbot.resume")

    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    errors = []

    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            message = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            return message.choices[0].message.content
        except Exception as e:
            _logger.warning("Groq API failed, trying next provider: %s", e)
            errors.append(f"Groq: {e}")

    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            response = client.models.generate_content(
                model="gemini-2.0-flash", contents=prompt
            )
            return response.text
        except Exception as e:
            _logger.warning("Gemini API failed, trying next provider: %s", e)
            errors.append(f"Gemini: {e}")

    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            message = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            return message.content[0].text
        except Exception as e:
            _logger.warning("Anthropic API failed: %s", e)
            errors.append(f"Anthropic: {e}")

    if errors:
        raise RuntimeError(f"All LLM providers failed: {'; '.join(errors)}")
    raise RuntimeError("No API key set — add a Groq, Gemini, or Anthropic key in Settings")


def tailor_resume(job_id: int, job_description: str, master_resume_path: str,
                  existing_keywords: list[str] | None = None) -> dict:
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

    # Reuse stored keywords on re-tailor so the original score stays stable
    if existing_keywords:
        keywords = existing_keywords
    else:
        keywords = extract_keywords_from_response(response_text)

    tailored_text = extract_resume_from_response(response_text)
    if not tailored_text:
        tailored_text = resume_text  # fallback: use original if parse failed

    # Score against tailored text and original master
    ats_score = calculate_ats_score(keywords, tailored_text)
    original_ats_score = calculate_original_ats_score(keywords, master_resume_path)

    job_dir = RESUMES_DIR / str(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)

    docx_path = job_dir / "tailored.docx"
    pdf_path = job_dir / "tailored.pdf"

    # Strip any residual Markdown before writing
    write_tailored_docx(master_path, strip_markdown(tailored_text), docx_path)

    try:
        export_pdf(docx_path, pdf_path)
    except Exception:
        pdf_path = None

    return {
        "keywords": keywords,
        "keywords_str": ", ".join(keywords),
        "ats_score": ats_score,
        "original_ats_score": original_ats_score,
        "tailored_text": tailored_text,
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
        "fit_score":    parse_fit_score(raw),
        "strengths":    [s.strip() for s in parse_fit_field(raw, "STRENGTHS").split(",") if s.strip()],
        "gaps":         [g.strip() for g in parse_fit_field(raw, "GAPS").split(",") if g.strip()],
        "verdict":      parse_fit_field(raw, "VERDICT"),
        "jd_summary":   parse_fit_field(raw, "JD_SUMMARY"),
        "jd_keywords":  parse_fit_field(raw, "JD_KEYWORDS"),
        "raw":          raw,
    }
