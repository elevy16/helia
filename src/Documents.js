import React, { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from './supabaseClient';
import DocumentSummaryBlock from './DocumentSummaryBlock';
import HeliaPageHeader from './HeliaPageHeader';
import {
  arrayBufferToBase64,
  getFileRowKey,
  readFileAsArrayBuffer,
  resolveDocumentStoragePath,
} from './documentHelpers';
import { HELIA_API_BASE } from './chatApi';
import { helia } from './heliaTheme';
import { heliaCardStyle, heliaPageMainStyle } from './heliaUi';
import { FileText, HeliaIcon } from './heliaIcons';
import AskDoctorPanel from './AskDoctorPanel';

function getFlagSeverityColors(severity) {
  const s = String(severity || 'info').toLowerCase();
  if (s === 'alert') return { bg: '#fdecea', border: '#f5c6cb', dot: '#c0392b', label: '#922b21' };
  if (s === 'warning') return { bg: '#fff8e6', border: '#ffeaa7', dot: '#d68910', label: '#9a6700' };
  return { bg: helia.sageMuted, border: helia.border, dot: helia.sage, label: helia.forest };
}

export default function Documents() {
  const { user: ctxUser } = useOutletContext() || {};
  const [user, setUser] = useState(ctxUser || null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [latestDocumentFlags, setLatestDocumentFlags] = useState(null);
  const [analyzingUpload, setAnalyzingUpload] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deletingPath, setDeletingPath] = useState(null);
  const [askDoctorOpen, setAskDoctorOpen] = useState(false);
  const [askDoctorDoc, setAskDoctorDoc] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!ctxUser?.id) {
      setFiles([]);
      return;
    }
    setUser(ctxUser);
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxUser?.id]);

  function showMessage(msg) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 10000);
  }

  function openAskDoctor(file) {
    setAskDoctorDoc({ id: file.id, filename: file.filename });
    setAskDoctorOpen(true);
  }

  async function fetchFiles() {
    setLoadingFiles(true);
    const { data, error } = await supabase
      .from('document_texts')
      .select('id, filename, file_path, summary, red_flags')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      showMessage('Error fetching files: ' + error.message);
      setFiles([]);
    } else {
      setFiles(data || []);
    }
    setLoadingFiles(false);
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
    const originalName = file.name;
    const dotIndex = originalName.lastIndexOf('.');
    const base = dotIndex !== -1 ? originalName.slice(0, dotIndex) : originalName;
    const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';

    if (ext.replace(/^\./, '').toLowerCase() !== 'pdf') {
      showMessage('Only PDF files are allowed.');
      return;
    }

    let safeBase = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    safeBase = safeBase.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
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
      if (fileInputRef.current) fileInputRef.current.value = '';

      try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const base64 = arrayBufferToBase64(arrayBuffer);

        const response = await fetch(`${HELIA_API_BASE}/api/extract-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            filename: sanitizedFilename,
            filePath,
            fileData: base64,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          showMessage('Upload and text extraction successful!');
          setAnalyzingUpload(true);
          try {
            const analyzeRes = await fetch(`${HELIA_API_BASE}/api/analyze-document`, {
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
              setLatestDocumentFlags({
                filename: data.filename || sanitizedFilename,
                flags: Array.isArray(analysis.flags) ? analysis.flags : [],
                at: Date.now(),
              });
            }
          } catch (analysisErr) {
            console.error('Document analysis failed:', analysisErr);
          } finally {
            setAnalyzingUpload(false);
          }
          await fetchFiles();
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

    if (
      !window.confirm(
        `Delete "${file.filename}" from your documents?\n\nThis removes the PDF from storage and deletes its extracted text and summary. You cannot undo this.`
      )
    ) {
      return;
    }

    const DELETE_MS = 10000;
    setDeletingPath(rowKey);

    try {
      let q = supabase.from('document_texts').delete().eq('user_id', user.id);
      if (file.id != null && String(file.id) !== '') q = q.eq('id', file.id);
      else if (legacyPath) q = q.eq('file_path', legacyPath);
      else q = q.eq('filename', file.filename);

      const { error: dbErr } = await Promise.race([
        q,
        new Promise((resolve) =>
          setTimeout(() => resolve({ error: { message: 'Delete timed out after 10 seconds' } }), DELETE_MS)
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
          setTimeout(() => resolve({ error: { message: 'Storage delete timed out after 10 seconds' } }), DELETE_MS)
        ),
      ]);

      if (storageErr) {
        showMessage(
          storageErr.message.includes('timed out')
            ? 'Document removed from your library. Storage cleanup timed out.'
            : 'Document removed from your library. Storage cleanup failed: ' + storageErr.message
        );
      } else {
        showMessage('Document deleted.');
      }
    } catch (err) {
      showMessage('Delete failed: ' + (err.message || String(err)));
    } finally {
      setDeletingPath(null);
    }
  }

  async function handleDownload(filePath, filename) {
    const { data, error } = await supabase.storage.from('documents').download(filePath);
    if (error) {
      showMessage('Download error: ' + error.message);
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

  return (
    <>
      <HeliaPageHeader
        title="Documents"
        subtitle="Upload, review summaries, and manage your health records."
        breadcrumb={[{ label: 'My Records', to: '/documents' }, { label: 'Documents' }]}
      />
      <main style={heliaPageMainStyle}>
        <div style={heliaCardStyle}>
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
                color: /error|failed|timed out|Please |not allowed|No user|Could not delete|Upload error|Text extraction|Failed to extract|Download error/i.test(
                  message
                )
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
                  <div style={{ color: helia.muted, fontSize: 15 }}>No immediate concerns found in this document.</div>
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
                            <span
                              style={{
                                color: colors.label,
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                              }}
                            >
                              {sev}
                            </span>
                          </div>
                          <div style={{ color: helia.body, fontWeight: 600, marginBottom: 4 }}>{flag.title}</div>
                          {flag.value && (
                            <div style={{ color: helia.muted, fontSize: 13, marginBottom: 5 }}>
                              <strong>Value:</strong> {flag.value}
                            </div>
                          )}
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
                            background: helia.sageMuted,
                            borderRadius: helia.radiusSm,
                            border: `1px solid ${helia.border}`,
                          }}
                        >
                          <HeliaIcon icon={FileText} size={22} color={helia.sage} strokeWidth={2} />
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
                                setSummaryExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
                              }}
                              truncate={false}
                            />
                          ) : (
                            <div style={{ marginTop: 10, fontSize: 14, color: helia.muted, fontStyle: 'italic' }}>
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
                          disabled={!f.id || deletingPath === getFileRowKey(f, user.id) || uploadBusy}
                          onClick={() => openAskDoctor(f)}
                          style={{
                            padding: '8px 14px',
                            fontSize: 13,
                            fontWeight: 600,
                            background: helia.cream,
                            color: helia.forest,
                            border: `1px solid ${helia.border}`,
                            borderRadius: helia.radiusSm,
                            cursor: !f.id || deletingPath === getFileRowKey(f, user.id) || uploadBusy ? 'not-allowed' : 'pointer',
                            minWidth: 108,
                          }}
                        >
                          What should I ask?
                        </button>
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
      </main>
      <AskDoctorPanel
        open={askDoctorOpen}
        onClose={() => setAskDoctorOpen(false)}
        userId={user?.id}
        documentId={askDoctorDoc?.id}
        sourceLabel={askDoctorDoc?.filename}
      />
    </>
  );
}
