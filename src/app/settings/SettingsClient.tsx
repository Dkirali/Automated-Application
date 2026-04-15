"use client";

import { useState } from "react";

interface SettingsClientProps {
  name: string;
  email: string;
  phone: string;
  currentResume: string | null;
}

export default function SettingsClient({ name, email, phone, currentResume }: SettingsClientProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="page-center">
      <div className="form-card">
        <div className="form-card-toprow">
          <span className="form-card-logo">JobBot</span>
          <a href="/" className="back-link">← Dashboard</a>
        </div>

        <h2>Settings</h2>
        <p className="form-card-sub">Update your profile or swap out your master resume.</p>

        <form method="POST" action="/api/settings" encType="multipart/form-data" className="setup-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input type="text" id="name" name="name" defaultValue={name} required />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" defaultValue={email} required />
          </div>
          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input type="tel" id="phone" name="phone" defaultValue={phone} required />
          </div>
          <div className="form-group">
            <label htmlFor="groq_key">Groq API Key <span className="label-hint">(free — leave blank to keep current)</span></label>
            <input type="password" id="groq_key" name="groq_key" placeholder="gsk_…" />
          </div>
          <div className="form-group">
            <label htmlFor="openrouter_key">OpenRouter API Key <span className="label-hint">(leave blank to keep current)</span></label>
            <input type="password" id="openrouter_key" name="openrouter_key" placeholder="sk-or-…" />
          </div>
          <div className="form-group">
            <label htmlFor="api_key">Claude API Key <span className="label-hint">(leave blank to keep current)</span></label>
            <input type="password" id="api_key" name="api_key" placeholder="sk-ant-…" />
          </div>
          <div className="form-group">
            <label>Master Resume</label>
            {currentResume && <div className="file-current">📄 {currentResume}</div>}
            <div className="file-drop" style={fileName ? { borderColor: "var(--clr-success)", background: "var(--clr-success-tint)" } : undefined}>
              <input type="file" name="resume" accept=".docx,.doc,.pdf" id="resume-input" onChange={(e) => setFileName(e.target.files?.[0]?.name || null)} />
              <div className="file-drop-icon">📤</div>
              <div className="file-drop-text">{fileName ? `✓ ${fileName}` : "Upload a new resume to replace"}</div>
              <div className="file-drop-hint">.docx, .doc, or .pdf accepted</div>
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-full">Save Changes</button>
        </form>
      </div>
    </div>
  );
}
