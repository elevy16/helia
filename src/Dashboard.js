import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { CompactHealthScore } from './CompactHealthScore';
import HeliaPageHeader from './HeliaPageHeader';
import { useChatPanel } from './ChatContext';
import { getFileRowKey } from './documentHelpers';
import { HELIA_API_BASE } from './chatApi';
import { helia } from './heliaTheme';
import { heliaCardStyle, heliaPageMainStyle } from './heliaUi';
import {
  Activity,
  ClipboardList,
  FileText,
  HeliaIcon,
  MessageCircle,
  Sparkles,
  Upload,
} from './heliaIcons';
import AskDoctorPanel from './AskDoctorPanel';

const SEVERITY_ORDER = { alert: 0, warning: 1, info: 2 };

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user: ctxUser } = useOutletContext() || {};
  const [user, setUser] = useState(ctxUser || null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [healthInsights, setHealthInsights] = useState([]);
  const [healthInsightsLoading, setHealthInsightsLoading] = useState(false);
  const [healthInsightsError, setHealthInsightsError] = useState('');
  const [healthScore, setHealthScore] = useState(null);
  const [healthScoreLoading, setHealthScoreLoading] = useState(false);
  const [healthScoreError, setHealthScoreError] = useState('');
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const [keyInsightExpanded, setKeyInsightExpanded] = useState(false);
  const [askDoctorOpen, setAskDoctorOpen] = useState(false);
  const { openChat } = useChatPanel();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ctxUser?.id) {
      setFiles([]);
      setHealthInsights([]);
      setHealthScore(null);
      return;
    }
    setUser(ctxUser);
    fetchFiles();
    fetchHealthInsights();
    fetchHealthScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxUser?.id]);

  async function fetchFiles() {
    setLoadingFiles(true);
    const { data, error } = await supabase
      .from('document_texts')
      .select('id, filename, file_path')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(3);
    if (!error) setFiles(data || []);
    setLoadingFiles(false);
  }

  async function fetchHealthInsights() {
    if (!user) return;
    setHealthInsightsLoading(true);
    setHealthInsightsError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/health-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setHealthInsights(Array.isArray(data.insights) ? data.insights : []);
    } catch (err) {
      console.error('[health-insights]', err);
      setHealthInsights([]);
      setHealthInsightsError('Could not load insights right now.');
    } finally {
      setHealthInsightsLoading(false);
    }
  }

  async function fetchHealthScore() {
    if (!user) return;
    setHealthScoreLoading(true);
    setHealthScoreError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/health-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setHealthScore(await resp.json());
    } catch (err) {
      console.error('[health-score]', err);
      setHealthScore(null);
      setHealthScoreError('Could not load engagement score.');
    } finally {
      setHealthScoreLoading(false);
    }
  }

  const keyInsight = useMemo(() => {
    if (!healthInsights.length) return null;
    return [...healthInsights].sort(
      (a, b) =>
        (SEVERITY_ORDER[String(a.severity || 'info').toLowerCase()] ?? 3) -
        (SEVERITY_ORDER[String(b.severity || 'info').toLowerCase()] ?? 3)
    )[0];
  }, [healthInsights]);

  useEffect(() => {
    setKeyInsightExpanded(false);
  }, [keyInsight?.title, keyInsight?.description]);

  const quickActions = [
    { label: 'Upload Document', icon: Upload, onClick: () => navigate('/documents') },
    { label: 'Start Chat', icon: MessageCircle, onClick: openChat },
    { label: 'Appointment Prep', icon: ClipboardList, onClick: () => navigate('/appointment-prep') },
    { label: 'Log Symptom', icon: Activity, onClick: () => navigate('/symptoms') },
  ];

  return (
    <>
      <div style={{ position: 'relative' }}>
        <HeliaPageHeader
          title={getGreeting()}
          subtitle="Your health briefing for today"
          greeting
        />
        <div style={{ position: 'absolute', top: 28, right: 36, zIndex: 5 }}>
          <CompactHealthScore
            scoreData={healthScore}
            loading={healthScoreLoading}
            error={healthScoreError}
            expanded={scoreExpanded}
            onToggle={() => setScoreExpanded((v) => !v)}
          />
        </div>
      </div>

      <main style={heliaPageMainStyle}>
        <section style={{ marginBottom: 28 }}>
          {healthInsightsLoading ? (
            <div style={{ ...heliaCardStyle, display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Loading your key insight…
            </div>
          ) : healthInsightsError ? (
            <div style={{ ...heliaCardStyle, color: helia.alert }}>{healthInsightsError}</div>
          ) : keyInsight ? (
            <div
              style={{
                ...heliaCardStyle,
                borderLeft: '4px solid #5a8a5e',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HeliaIcon icon={Sparkles} size={16} color={helia.sage} strokeWidth={2} />
                  <span
                    style={{
                      fontWeight: 600,
                      color: helia.forest,
                      fontSize: 13,
                      letterSpacing: '0.03em',
                    }}
                  >
                    Key insight
                  </span>
                </div>
                <Link
                  to="/insights"
                  style={{ fontSize: 13, fontWeight: 600, color: helia.sage, textDecoration: 'none' }}
                >
                  See all insights →
                </Link>
              </div>
              <div style={{ fontWeight: 600, fontSize: 17, color: helia.forest, marginBottom: 8 }}>
                {keyInsight.title}
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: helia.body,
                  ...(keyInsightExpanded
                    ? {}
                    : {
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }),
                }}
              >
                {keyInsight.description}
              </div>
              {!keyInsightExpanded && (
                <button
                  type="button"
                  onClick={() => setKeyInsightExpanded(true)}
                  style={{
                    marginTop: 6,
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: helia.sage,
                    fontFamily: helia.font,
                  }}
                >
                  Read more →
                </button>
              )}
              {keyInsightExpanded && (
                <>
                  {keyInsight.actionSuggestion && (
                    <div style={{ marginTop: 12, fontSize: 13, color: helia.muted, lineHeight: 1.55 }}>
                      <span style={{ color: helia.sage, fontWeight: 600 }}>Discuss with your doctor: </span>
                      {keyInsight.actionSuggestion}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setAskDoctorOpen(true)}
                    style={{
                      marginTop: 16,
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: helia.cream,
                      color: helia.forest,
                      border: `1px solid ${helia.border}`,
                      borderRadius: helia.radiusSm,
                      cursor: 'pointer',
                      fontFamily: helia.font,
                    }}
                  >
                    What should I ask?
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyInsightExpanded(false)}
                    style={{
                      marginTop: 12,
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                      color: helia.sage,
                      fontFamily: helia.font,
                    }}
                  >
                    Show less
                  </button>
                </>
              )}
            </div>
          ) : (
            <div style={{ ...heliaCardStyle, color: helia.muted, fontSize: 15 }}>
              Upload a document to unlock personalized health insights.
              <Link to="/documents" style={{ marginLeft: 8, color: helia.sage, fontWeight: 600 }}>
                Upload now →
              </Link>
            </div>
          )}
        </section>

        <section style={{ marginBottom: 22 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 8,
            }}
            className="helia-quick-actions"
          >
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                style={{
                  padding: '8px 12px',
                  borderRadius: helia.radiusSm,
                  border: `1px solid ${helia.border}`,
                  background: helia.card,
                  color: helia.body,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: 'none',
                  fontFamily: helia.font,
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
                className="helia-quick-action"
              >
                <HeliaIcon icon={action.icon} size={20} color={helia.sage} strokeWidth={2} />
                {action.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: helia.forest }}>Recent Documents</h2>
            <Link to="/documents" style={{ fontSize: 13, fontWeight: 600, color: helia.sage, textDecoration: 'none' }}>
              View all documents →
            </Link>
          </div>

          {loadingFiles ? (
            <div style={{ ...heliaCardStyle, display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Loading documents…
            </div>
          ) : files.length === 0 ? (
            <div style={{ ...heliaCardStyle, color: helia.muted, fontSize: 15 }}>
              No documents yet.
              <Link to="/documents" style={{ marginLeft: 8, color: helia.sage, fontWeight: 600 }}>
                Upload your first PDF →
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {files.map((f) => (
                <div
                  key={getFileRowKey(f, user.id)}
                  style={{ ...heliaCardStyle, padding: '20px 24px', borderLeft: '3px solid #7a9e7e' }}
                >
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: helia.sageMuted,
                        borderRadius: helia.radiusSm,
                        border: `1px solid ${helia.border}`,
                      }}
                    >
                      <HeliaIcon icon={FileText} size={20} color={helia.sage} strokeWidth={2} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: helia.forest, minWidth: 0 }}>
                      {f.filename}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <AskDoctorPanel
        open={askDoctorOpen}
        onClose={() => setAskDoctorOpen(false)}
        userId={user?.id}
        insightContext={
          keyInsight
            ? {
                title: keyInsight.title,
                description: keyInsight.description,
                actionSuggestion: keyInsight.actionSuggestion,
              }
            : null
        }
        sourceLabel={keyInsight?.title}
      />
    </>
  );
}
