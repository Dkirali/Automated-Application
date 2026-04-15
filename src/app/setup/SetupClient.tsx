"use client";

import { useState } from "react";

export default function SetupClient() {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="page-center">
      <div className="form-card">
        <span className="form-card-logo">JobBot</span>
        <h2>Let&apos;s get you set up</h2>
        <p className="form-card-sub">Takes about a minute. You only need to do this once.</p>

        <div className="steps">
          <div className="step-dot active" />
          <div className="step-dot" />
          <div className="step-dot" />
          <div className="step-dot" />
          <div className="step-dot" />
        </div>

        <form method="POST" action="/api/setup" encType="multipart/form-data" className="setup-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input type="text" id="name" name="name" required placeholder="Your Name" />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="you@email.com" />
          </div>
          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input type="tel" id="phone" name="phone" required placeholder="+90 555 000 0000" />
          </div>
          <div className="form-group">
            <label htmlFor="groq_key">Groq API Key <span className="label-hint">(free tier available)</span></label>
            <input type="password" id="groq_key" name="groq_key" placeholder="gsk_…" />
          </div>
          <div className="form-group">
            <label htmlFor="openrouter_key">OpenRouter API Key</label>
            <input type="password" id="openrouter_key" name="openrouter_key" placeholder="sk-or-…" />
          </div>
          <div className="form-group">
            <label htmlFor="api_key">Claude API Key</label>
            <input type="password" id="api_key" name="api_key" placeholder="sk-ant-…" />
          </div>
          <div className="form-group">
            <label>Master Resume</label>
            <div className="file-drop" style={fileName ? { borderColor: "var(--clr-success)", background: "var(--clr-success-tint)" } : undefined}>
              <input type="file" name="resume" accept=".docx,.doc,.pdf" required id="resume-input" onChange={(e) => setFileName(e.target.files?.[0]?.name || null)} />
              <div className="file-drop-icon">📄</div>
              <div className="file-drop-text">{fileName ? `✓ ${fileName}` : "Click to upload your resume"}</div>
              <div className="file-drop-hint">.docx, .doc, or .pdf accepted</div>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-full">Save &amp; Continue →</button>
        </form>
      </div>
    </div>
  );
}
