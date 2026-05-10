import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import { helia, heliaInsightColors } from './heliaTheme';
import HeliaSidebar from './HeliaSidebar';

function DocumentSummaryBlock({ text, idPrefix, expanded, onToggle }) {
  const bodyRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (!text) {
      setOverflows(false);
      return;
    }
    if (expanded) {
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (!bodyRef.current) return;
      setOverflows(bodyRef.current.scrollHeight > bodyRef.current.clientHeight + 2);
    };
    requestAnimationFrame(measure);
  }, [text, expanded]);

  if (!text) return null;

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: `1px solid ${helia.border}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: helia.muted,
          marginBottom: 8,
        }}
      >
        Summary
      </div>
      <div
        ref={bodyRef}
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          color: helia.body,
          wordBreak: 'break-word',
          // ~4 lines at 1.55 line-height (line-clamp is unreliable with nested lists)
          ...(expanded
            ? { maxHeight: 'none', overflow: 'visible' }
            : { maxHeight: '6.2em', overflow: 'hidden' }),
        }}
      >
        {parseSummaryMarkdown(text, idPrefix)}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={onToggle}
          style={{
            marginTop: 10,
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: helia.sage,
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [healthInsights, setHealthInsights] = useState([]);
  const [healthInsightsLoading, setHealthInsightsLoading] = useState(false);
  const [healthInsightsError, setHealthInsightsError] = useState('');
  const [latestDocumentFlags, setLatestDocumentFlags] = useState(null);
  const [analyzingUpload, setAnalyzingUpload] = useState(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const [summaryExpanded, setSummaryExpanded] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deletingPath, setDeletingPath] = useState(null);

  /** Storage object key; falls back when legacy rows have no file_path */
  function resolveDocumentStoragePath(fileRow, userId) {
    const fp = fileRow.file_path != null ? String(fileRow.file_path).trim() : '';
    if (fp) return fp;
    return `${userId}/${fileRow.filename}`;
  }

  /** Stable UI key for a row (deleting spinner, summary expand); avoids null === null across rows */
  function getFileRowKey(fileRow, userId) {
    if (fileRow.id != null && String(fileRow.id) !== '') return `id:${String(fileRow.id)}`;
    const fp = fileRow.file_path != null ? String(fileRow.file_path).trim() : '';
    if (fp) return `path:${fp}`;
    return `fn:${userId}:${fileRow.filename}`;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function getInsightSeverityColors(severity) {
    const s = String(severity || 'info').toLowerCase();
    if (s === 'alert') return heliaInsightColors.alert;
    if (s === 'warning') return heliaInsightColors.warning;
    return heliaInsightColors.info;
  }

  function getFlagSeverityColors(severity) {
    return getInsightSeverityColors(severity);
  }

  useEffect(() => {
    let mounted = true;

    async function fetchUser() {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser(data.user || null);
    }

    fetchUser();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (user) {
      fetchFiles();
      loadConversation();
      fetchHealthInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Helper function to show message for 10 seconds
  function showMessage(msg) {
    setMessage(msg);
    setTimeout(() => {
      setMessage('');
    }, 10000);
  }

  // Load conversation history from Supabase
  async function loadConversation() {
    if (!user) return;
    setConversationLoading(true);
    setConversationError('');
    const { data, error } = await supabase
      .from('conversations')
      .select('id, role, content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      setConversationError('Error loading conversation: ' + error.message);
      setConversationLoading(false);
      return;
    }

    const msgs = (data || []).map((r) => ({ role: r.role, content: r.content, created_at: r.created_at }));
    setMessages(msgs);
    setConversationLoading(false);
    // scroll to bottom after loading
    setTimeout(() => {
      const el = document.getElementById('chatHistory');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  // Fetch list of files under the user's folder
  async function fetchFiles() {
    setLoadingFiles(true);
    const { data, error } = await supabase
      .from('document_texts')
      .select('id, filename, file_path, summary, red_flags')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      setMessage('Error fetching files: ' + error.message);
      setFiles([]);
    } else {
      setFiles(data || []);
      setMessage('');
    }
    setLoadingFiles(false);
  }

  async function fetchHealthInsights() {
    if (!user) return;
    setHealthInsightsLoading(true);
    setHealthInsightsError('');
    try {
      const resp = await fetch('http://localhost:3001/api/health-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Backend error: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      const insights = Array.isArray(data.insights) ? data.insights : [];
      setHealthInsights(insights);
    } catch (err) {
      console.error('[health-insights] Failed to fetch:', err);
      setHealthInsights([]);
      setHealthInsightsError('Could not generate health insights right now.');
    } finally {
      setHealthInsightsLoading(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    setMessage('');
    if (!selectedFile) {
      showMessage('Please select a PDF to upload.');
      return;
    }

    if (!user) {
      showMessage('No user found. Please log in again.');
      return;
    }

    if (uploadBusy) return;

    const file = selectedFile;

    // Sanitize filename: remove diacritics, strip unsafe chars, replace spaces with underscores
    const originalName = file.name;
    const dotIndex = originalName.lastIndexOf('.');
    const base = dotIndex !== -1 ? originalName.slice(0, dotIndex) : originalName;
    const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';

    // ensure extension is PDF
    if (ext.replace(/^\./, '').toLowerCase() !== 'pdf') {
      showMessage('Only PDF files are allowed.');
      return;
    }

    let safeBase = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    // remove characters except letters, numbers, space, hyphen, and underscore
    safeBase = safeBase.replace(/[^a-zA-Z0-9 _-]/g, '');
    // collapse spaces to single underscore
    safeBase = safeBase.trim().replace(/\s+/g, '_');
    if (!safeBase) safeBase = 'file';

    const sanitizedFilename = `${safeBase}${ext}`;
    const filePath = `${user.id}/${Date.now()}_${sanitizedFilename}`;

    setUploadBusy(true);
    try {
      const { error } = await supabase.storage.from('documents').upload(filePath, file);

      if (error) {
        showMessage('Upload error: ' + error.message);
        return;
      }

      showMessage('Upload successful! Extracting text and summary…');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const base64 = arrayBufferToBase64(arrayBuffer);

        const response = await fetch('http://localhost:3001/api/extract-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            filename: sanitizedFilename,
            filePath: filePath,
            fileData: base64,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          showMessage('Upload and text extraction successful!');
          console.log('Document text stored:', data);
          setAnalyzingUpload(true);
          try {
            const analyzeRes = await fetch('http://localhost:3001/api/analyze-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: data.extractedText,
                filename: data.filename || sanitizedFilename,
                userId: user.id,
                documentId: data.documentId,
              }),
            });
            if (analyzeRes.ok) {
              const analysis = await analyzeRes.json();
              const flags = Array.isArray(analysis.flags) ? analysis.flags : [];
              setLatestDocumentFlags({
                filename: data.filename || sanitizedFilename,
                flags,
                at: Date.now(),
              });
            }
          } catch (analysisErr) {
            console.error('Document analysis failed:', analysisErr);
          } finally {
            setAnalyzingUpload(false);
          }
          await fetchFiles();
          await fetchHealthInsights();
        } else {
          let errText = 'Unknown error';
          try {
            const errData = await response.json();
            errText = errData.error || errText;
          } catch {
            errText = await response.text();
          }
          showMessage('Text extraction error: ' + errText);
        }
      } catch (err) {
        console.error('Failed to read or extract document text:', err);
        showMessage('Failed to extract document text, but file was uploaded.');
      }
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleDeleteDocument(file) {
    if (!user) return;
    const storagePath = resolveDocumentStoragePath(file, user.id);
    const rowKey = getFileRowKey(file, user.id);
    const legacyPath = file.file_path != null ? String(file.file_path).trim() : '';

    const confirmed = window.confirm(
      `Delete "${file.filename}" from your documents?\n\nThis removes the PDF from storage and deletes its extracted text and summary. You cannot undo this.`
    );
    if (!confirmed) return;

    const DELETE_MS = 10000;

    setDeletingPath(rowKey);

    try {
      let q = supabase.from('document_texts').delete().eq('user_id', user.id);
      if (file.id != null && String(file.id) !== '') {
        q = q.eq('id', file.id);
      } else if (legacyPath) {
        q = q.eq('file_path', legacyPath);
      } else {
        q = q.eq('filename', file.filename);
      }

      const { error: dbErr } = await Promise.race([
        q,
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ error: { message: 'Delete timed out after 10 seconds' } }),
            DELETE_MS
          )
        ),
      ]);

      if (dbErr) {
        showMessage('Could not delete document: ' + dbErr.message);
        return;
      }

      setFiles((prev) =>
        prev.filter((x) => {
          if (file.id != null && String(file.id) !== '' && x.id != null) {
            return String(x.id) !== String(file.id);
          }
          const xFp = x.file_path != null ? String(x.file_path).trim() : '';
          if (legacyPath && xFp === legacyPath) return false;
          if (!legacyPath && (!xFp || xFp === '') && x.filename === file.filename) return false;
          return true;
        })
      );

      setSummaryExpanded((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        if (legacyPath) delete next[legacyPath];
        delete next[storagePath];
        return next;
      });

      setDeletingPath(null);

      const { error: storageErr } = await Promise.race([
        supabase.storage.from('documents').remove([storagePath]),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ error: { message: 'Storage delete timed out after 10 seconds' } }),
            DELETE_MS
          )
        ),
      ]);

      if (storageErr) {
        showMessage(
          storageErr.message.includes('timed out')
            ? 'Document removed from your library. Storage cleanup timed out (an orphan file may remain in storage).'
            : 'Document removed from your library. Storage cleanup failed: ' + storageErr.message
        );
      } else {
        showMessage('Document deleted.');
      }
      await fetchHealthInsights();
    } catch (err) {
      showMessage('Delete failed: ' + (err.message || String(err)));
    } finally {
      setDeletingPath(null);
    }
  }

  // Download a file and trigger browser download
  async function handleDownload(filePath, filename) {
    const { data, error } = await supabase.storage.from('documents').download(filePath);
    if (error) {
      setMessage('Download error: ' + error.message);
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage('Logout error: ' + error.message);
      return;
    }
    navigate('/');
  }

  /** Only role + string content — safe for JSON and matches Anthropic API. */
  function buildChatApiPayload(conversation, userId) {
    const apiMessages = (conversation || []).map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const raw = m.content;
      const content =
        typeof raw === 'string'
          ? raw
          : raw == null
            ? ''
            : (() => {
                try {
                  return JSON.stringify(raw);
                } catch {
                  return String(raw);
                }
              })();
      return { role, content };
    });
    return { messages: apiMessages, userId };
  }

  // Call backend /api/chat — server sets Helia system prompt and RAG (documents + MedlinePlus)
  async function sendToAnthropic(conversation, userId) {
    if (!userId) {
      throw new Error('Missing user id; cannot call chat API.');
    }
    let body;
    try {
      body = JSON.stringify(buildChatApiPayload(conversation, userId));
    } catch (err) {
      console.error('[Dashboard] chat JSON.stringify failed:', err);
      throw new Error('Could not serialize chat messages for the server.');
    }

    const resp = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Backend error: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    return (data.reply || '').toString().trim();
  }

  // Send message (not an HTML form submit — avoids nested-form / navigation edge cases)
  async function handleSendChat() {
    setMessage('');
    if (!input.trim()) return;
    if (!user?.id) {
      setConversationError('You must be signed in to chat.');
      return;
    }

    const userId = user.id;
    const content = input.trim();
    setInput('');
    setSending(true);

    try {
      const { data: insertedUser, error: insertErr } = await supabase
        .from('conversations')
        .insert([{ user_id: userId, role: 'user', content }])
        .select()
        .single();

      if (insertErr) {
        setConversationError('Error saving message: ' + insertErr.message);
        setSending(false);
        return;
      }

      const userMsgRecord = insertedUser
        ? { role: 'user', content: insertedUser.content, created_at: insertedUser.created_at }
        : { role: 'user', content, created_at: new Date().toISOString() };
      const newMessages = [...messages, userMsgRecord];
      setMessages(newMessages);

      const reply = await sendToAnthropic(newMessages, userId);

      if (reply) {
        const { data: insertedAssistant, error: assistantErr } = await supabase
          .from('conversations')
          .insert([{ user_id: userId, role: 'assistant', content: reply }])
          .select()
          .single();
        if (assistantErr) {
          setConversationError('Error saving assistant message: ' + assistantErr.message);
        }
        const assistantRecord = insertedAssistant
          ? { role: 'assistant', content: insertedAssistant.content, created_at: insertedAssistant.created_at }
          : { role: 'assistant', content: reply, created_at: new Date().toISOString() };
        setMessages((prev) => [...prev, assistantRecord]);
      } else {
        setConversationError('No response from AI.');
      }
    } catch (err) {
      console.error('[Dashboard] handleSendChat:', err);
      setConversationError('AI error: ' + (err.message || err));
    }
    setSending(false);
    setTimeout(() => {
      const el = document.getElementById('chatHistory');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: helia.cream,
        color: helia.body,
        fontFamily: helia.font,
        fontSize: 17,
        lineHeight: 1.55,
      }}
    >
      <HeliaSidebar userEmail={user?.email} onLogout={handleLogout} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '28px 36px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: helia.forest, letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>Documents, insights, and chat — all in one calm place.</p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 1040, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>My Documents</h2>

          <div
            style={{
              background: helia.card,
              padding: 24,
              borderRadius: helia.radius,
              boxShadow: helia.cardShadow,
              border: `1px solid ${helia.border}`,
              color: helia.body,
            }}
          >
            <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                disabled={uploadBusy}
                onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                style={{ color: helia.body, opacity: uploadBusy ? 0.6 : 1 }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={uploadBusy}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: uploadBusy ? helia.sageMuted : helia.sage,
                    color: '#fff',
                    border: 'none',
                    borderRadius: helia.radiusSm,
                    cursor: uploadBusy ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    minWidth: 160,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                >
                  {uploadBusy && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
                  {uploadBusy ? 'Uploading…' : 'Upload PDF'}
                </button>
                {uploadBusy && (
                  <span style={{ fontSize: 14, color: helia.muted }}>Uploading file and generating summary…</span>
                )}
              </div>
            </form>

            {message && (
              <div
                style={{
                  marginTop: 12,
                  color: /error|failed|timed out|Please |not allowed|No user|Could not delete|Upload error|Text extraction|Failed to extract|Download error|Logout error/i.test(message)
                    ? helia.alert
                    : helia.forest,
                }}
              >
                {message}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <strong style={{ color: helia.forest, fontSize: 15 }}>Your files</strong>

              {(analyzingUpload || latestDocumentFlags) && (
                <div
                  style={{
                    marginTop: 12,
                    borderRadius: helia.radius,
                    padding: '16px 18px',
                    background: helia.cream,
                    border: `1px solid ${helia.border}`,
                  }}
                >
                  <div style={{ color: helia.forest, fontWeight: 700, marginBottom: 8, fontSize: 15 }}>
                    Red Flag Alerts {latestDocumentFlags?.filename ? ` — ${latestDocumentFlags.filename}` : ''}
                  </div>
                  {analyzingUpload ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted, fontSize: 14 }}>
                      <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                      Analyzing this document for findings to discuss with your doctor...
                    </div>
                  ) : latestDocumentFlags && latestDocumentFlags.flags.length === 0 ? (
                    <div style={{ color: helia.muted, fontSize: 15 }}>
                      No immediate concerns found in this document.
                    </div>
                  ) : latestDocumentFlags ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {latestDocumentFlags.flags.map((flag, idx) => {
                        const sev = String(flag.severity || 'info').toLowerCase();
                        const colors = getFlagSeverityColors(sev);
                        return (
                          <div
                            key={`${flag.title || 'flag'}-${idx}`}
                            style={{
                              borderRadius: 10,
                              padding: '12px 14px',
                              background: colors.bg,
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.dot }} />
                              <span style={{ color: colors.label, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sev}</span>
                            </div>
                            <div style={{ color: helia.body, fontWeight: 600, marginBottom: 4 }}>{flag.title}</div>
                            {flag.value && <div style={{ color: helia.muted, fontSize: 13, marginBottom: 5 }}><strong>Value:</strong> {flag.value}</div>}
                            <div style={{ color: helia.body, fontSize: 14, lineHeight: 1.5 }}>{flag.explanation}</div>
                            {flag.askDoctor && (
                              <div style={{ marginTop: 8, color: helia.body, fontSize: 14, lineHeight: 1.45 }}>
                                <span style={{ color: helia.sage, fontWeight: 700 }}>Ask your doctor: </span>
                                {flag.askDoctor}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

              {loadingFiles ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, color: helia.muted, fontSize: 14 }}>
                  <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                  Loading your documents…
                </div>
              ) : files.length === 0 ? (
                <div style={{ marginTop: 8, color: helia.muted }}>No files uploaded yet.</div>
              ) : (
                <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
                  {files.map((f) => (
                    <div
                      key={getFileRowKey(f, user.id)}
                      style={{
                        borderRadius: helia.radius,
                        padding: '20px 22px',
                        background: helia.card,
                        border: `1px solid ${helia.border}`,
                        boxShadow: helia.cardShadow,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 16,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 14, minWidth: 0, flex: '1 1 240px' }}>
                          <div
                            style={{
                              width: 48,
                              height: 48,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: `linear-gradient(145deg, ${helia.sage}, ${helia.forest})`,
                              borderRadius: helia.radiusSm,
                              fontSize: 22,
                              border: `1px solid ${helia.border}`,
                            }}
                          >
                            📄
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 16,
                                color: helia.forest,
                                letterSpacing: '0.02em',
                                lineHeight: 1.35,
                              }}
                            >
                              {f.filename}
                            </div>
                            {f.summary ? (
                              <DocumentSummaryBlock
                                text={f.summary}
                                idPrefix={resolveDocumentStoragePath(f, user.id)}
                                expanded={!!summaryExpanded[getFileRowKey(f, user.id)]}
                                onToggle={() => {
                                  const k = getFileRowKey(f, user.id);
                                  setSummaryExpanded((prev) => ({
                                    ...prev,
                                    [k]: !prev[k],
                                  }));
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  marginTop: 10,
                                  fontSize: 14,
                                  color: helia.muted,
                                  fontStyle: 'italic',
                                }}
                              >
                                No summary yet.
                              </div>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            flexShrink: 0,
                            alignSelf: 'flex-start',
                          }}
                        >
                          <button
                            type="button"
                            disabled={deletingPath === getFileRowKey(f, user.id) || uploadBusy}
                            onClick={() => handleDownload(resolveDocumentStoragePath(f, user.id), f.filename)}
                            style={{
                              padding: '8px 14px',
                              fontSize: 14,
                              fontWeight: 600,
                              background: helia.sageMuted,
                              color: helia.forest,
                              border: `1px solid rgba(122, 158, 126, 0.45)`,
                              borderRadius: helia.radiusSm,
                              cursor: deletingPath === getFileRowKey(f, user.id) || uploadBusy ? 'not-allowed' : 'pointer',
                              opacity: deletingPath === getFileRowKey(f, user.id) ? 0.55 : 1,
                              minWidth: 108,
                            }}
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            disabled={deletingPath === getFileRowKey(f, user.id) || uploadBusy}
                            onClick={() => handleDeleteDocument(f)}
                            style={{
                              padding: '8px 14px',
                              fontSize: 14,
                              fontWeight: 600,
                              background: helia.alertBg,
                              color: helia.alert,
                              border: '1px solid rgba(192, 57, 43, 0.35)',
                              borderRadius: helia.radiusSm,
                              cursor: deletingPath === getFileRowKey(f, user.id) || uploadBusy ? 'not-allowed' : 'pointer',
                              minWidth: 108,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 8,
                            }}
                          >
                            {deletingPath === getFileRowKey(f, user.id) && (
                              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                            )}
                            {deletingPath === getFileRowKey(f, user.id) ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 36 }}>
          <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Health Insights</h2>

          <div
            style={{
              background: helia.card,
              padding: 24,
              borderRadius: helia.radius,
              border: `1px solid ${helia.border}`,
              boxShadow: helia.cardShadow,
              color: helia.body,
            }}
          >
            {healthInsightsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted, fontSize: 15 }}>
                <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                Generating personalized insights from your documents...
              </div>
            ) : healthInsightsError ? (
              <div style={{ color: helia.alert, fontSize: 15 }}>{healthInsightsError}</div>
            ) : healthInsights.length === 0 ? (
              <div
                style={{
                  color: helia.muted,
                  fontSize: 15,
                  background: helia.cream,
                  border: `1px dashed ${helia.border}`,
                  padding: 16,
                  borderRadius: helia.radiusSm,
                }}
              >
                Upload your first document to get personalized health insights.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {healthInsights.map((insight, idx) => {
                  const sev = String(insight.severity || 'info').toLowerCase();
                  const colors = getInsightSeverityColors(sev);
                  return (
                    <div
                      key={`${insight.title || 'insight'}-${idx}`}
                      style={{
                        borderRadius: 12,
                        padding: '14px 16px',
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: colors.dot,
                            boxShadow: `0 0 0 3px ${colors.border}`,
                          }}
                        />
                        <span style={{ color: colors.label, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
                          {sev}
                        </span>
                      </div>
                      <div style={{ color: helia.forest, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>
                        {insight.title}
                      </div>
                      <div style={{ color: helia.body, fontSize: 15, lineHeight: 1.55 }}>
                        {insight.description}
                      </div>
                      {insight.actionSuggestion && (
                        <div style={{ marginTop: 10, color: helia.body, fontSize: 15, lineHeight: 1.5 }}>
                          <span style={{ color: helia.sage, fontWeight: 700 }}>Discuss with your doctor: </span>
                          {insight.actionSuggestion}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Chat with Helia</h2>

          <div
            style={{
              background: helia.card,
              padding: 20,
              borderRadius: helia.radius,
              border: `1px solid ${helia.border}`,
              boxShadow: helia.cardShadow,
              color: helia.body,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 400,
            }}
          >
            <div
              id="chatHistory"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 8px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {conversationLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted, fontSize: 15 }}>
                  <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                  Loading conversation…
                </div>
              ) : conversationError ? (
                <div style={{ color: helia.alert }}>{conversationError}</div>
              ) : messages && messages.length === 0 ? (
                <div style={{ color: helia.muted }}>Say hello — ask about your documents or a health question.</div>
              ) : null}

              {messages && messages.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '78%',
                    padding: '14px 18px',
                    borderRadius: helia.radius,
                    background: m.role === 'user' ? `linear-gradient(145deg, ${helia.sage}, ${helia.forest})` : helia.cream,
                    color: m.role === 'user' ? '#fff' : helia.body,
                    border: m.role === 'user' ? 'none' : `1px solid ${helia.border}`,
                    boxShadow: m.role === 'user' ? helia.cardShadow : 'none',
                  }}>
                    <div style={{ lineHeight: 1.5, fontSize: 15 }}>
                      {m.role === 'assistant'
                        ? parseSummaryMarkdown((m.content || '').toString(), `chat-msg-${idx}`)
                        : m.content}
                    </div>
                    <div style={{ fontSize: 12, color: m.role === 'user' ? 'rgba(255,255,255,0.85)' : helia.muted, marginTop: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>{m.created_at ? new Date(m.created_at).toLocaleString() : ''}</div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'stretch',
                marginTop: 4,
                paddingTop: 14,
                borderTop: `1px solid ${helia.border}`,
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!sending && !conversationLoading) {
                      void handleSendChat();
                    }
                  }
                }}
                placeholder="Ask about your documents or a health question…"
                disabled={sending || conversationLoading}
                style={{
                  flex: 1,
                  minHeight: 48,
                  padding: '12px 16px',
                  borderRadius: helia.radiusSm,
                  border: `1px solid ${helia.border}`,
                  background: helia.cream,
                  color: helia.body,
                  fontSize: 16,
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: helia.font,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void handleSendChat();
                }}
                disabled={sending || conversationLoading || !input.trim()}
                style={{
                  padding: '12px 22px',
                  minWidth: 108,
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: '0.02em',
                  background: sending || conversationLoading || !input.trim() ? helia.sageMuted : helia.sage,
                  color: '#fff',
                  border: `1px solid rgba(122, 158, 126, 0.4)`,
                  borderRadius: helia.radiusSm,
                  cursor: sending || conversationLoading || !input.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: sending || conversationLoading ? 'none' : helia.cardShadow,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontFamily: helia.font,
                }}
              >
                {sending && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </section>
        </main>
      </div>
    </div>
  );
}
