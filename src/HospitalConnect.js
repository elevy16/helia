import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { helia } from './heliaTheme';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

/** Supported hospitals — logos are initials placeholders until real assets exist */
const HOSPITALS = [
  { id: 'cedars', name: 'Cedars Sinai', subtitle: 'Los Angeles, CA', initials: 'CS' },
  { id: 'nyu', name: 'NYU Langone', subtitle: 'New York, NY', initials: 'NYU' },
  { id: 'stanford', name: 'Stanford Health', subtitle: 'Stanford, CA', initials: 'SH' },
  { id: 'ucla', name: 'UCLA Health', subtitle: 'Los Angeles, CA', initials: 'UH' },
  { id: 'mayo', name: 'Mayo Clinic', subtitle: 'Rochester, MN', initials: 'MC' },
];

/** Build realistic FHIR R4 bundle (mock Epic export) — varies slightly by hospital for demo */
function buildMockFhirBundle(hospital) {
  const now = new Date().toISOString();
  const visitDate = '2025-03-18';
  const providers = {
    cedars: { name: 'Priya Raman, MD', dept: 'Internal Medicine' },
    nyu: { name: 'James Okonkwo, MD', dept: 'Primary Care' },
    stanford: { name: 'Ellen Matsuda, MD', dept: 'Family Medicine' },
    ucla: { name: 'Maria Santos, MD', dept: 'General Internal Medicine' },
    mayo: { name: 'Robert Chen, MD', dept: 'Community Internal Medicine' },
  };
  const p = providers[hospital.id] || providers.cedars;

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: now,
    meta: {
      source: `${hospital.name} Epic FHIR (simulated)`,
      lastUpdated: now,
    },
    entry: [
      {
        fullUrl: 'urn:uuid:patient-1',
        resource: {
          resourceType: 'Patient',
          id: 'patient-1',
          gender: 'female',
          birthDate: '1988-06-15',
          generalPractitioner: [{ display: p.name }],
        },
      },
      {
        resource: {
          resourceType: 'Encounter',
          id: 'enc-1',
          status: 'finished',
          class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
          type: [{ text: 'Follow-up visit' }],
          period: { start: `${visitDate}T09:30:00Z`, end: `${visitDate}T10:05:00Z` },
          participant: [
            {
              individual: { display: p.name },
              type: [{ text: 'Primary performer' }],
            },
          ],
          serviceProvider: { display: hospital.name },
          reasonCode: [{ text: 'Anxiety symptoms; fatigue; lab review' }],
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-1',
          clinicalStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
          },
          code: {
            text: 'Generalized anxiety disorder',
            coding: [
              {
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                code: 'F41.1',
                display: 'Generalized anxiety disorder',
              },
            ],
          },
          onsetDateTime: '2023-11-01',
          recordedDate: '2023-11-15',
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-2',
          clinicalStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
          },
          code: {
            text: 'Vitamin D deficiency',
            coding: [
              {
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                code: 'E55.9',
                display: 'Vitamin D deficiency, unspecified',
              },
            ],
          },
          onsetDateTime: '2024-08-10',
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-3',
          clinicalStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
          },
          code: {
            text: 'Iron deficiency anemia',
            coding: [
              {
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                code: 'D50.9',
                display: 'Iron deficiency anemia, unspecified',
              },
            ],
          },
          onsetDateTime: '2025-01-22',
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'cond-4',
          clinicalStatus: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
          },
          code: {
            text: 'Gastroesophageal reflux disease',
            coding: [
              {
                system: 'http://hl7.org/fhir/sid/icd-10-cm',
                code: 'K21.9',
                display: 'Gastro-esophageal reflux disease without esophagitis',
              },
            ],
          },
          onsetDateTime: '2022-05-01',
        },
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-1',
          status: 'active',
          intent: 'order',
          medicationCodeableConcept: {
            text: 'Sertraline 50 mg oral tablet',
            coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '312938', display: 'Sertraline 50 MG Oral Tablet' }],
          },
          dosageInstruction: [
            {
              text: 'Take 1 tablet by mouth once daily in the morning.',
              timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd' } },
              route: { text: 'oral' },
              doseAndRate: [{ doseQuantity: { value: 50, unit: 'mg', system: 'http://unitsofmeasure.org', code: 'mg' } }],
            },
          ],
          authoredOn: '2024-09-01',
        },
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-2',
          status: 'active',
          intent: 'order',
          medicationCodeableConcept: {
            text: 'Cholecalciferol (Vitamin D3) 2000 IU capsule',
          },
          dosageInstruction: [
            {
              text: 'Take 2000 IU by mouth once daily with food.',
              timing: { repeat: { frequency: 1, period: 1, periodUnit: 'd' } },
            },
          ],
          authoredOn: '2025-01-22',
        },
      },
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: 'med-3',
          status: 'active',
          intent: 'order',
          medicationCodeableConcept: {
            text: 'Ferrous sulfate 325 mg (65 mg elemental iron) tablet',
          },
          dosageInstruction: [
            {
              text: 'Take 1 tablet by mouth every other day with food (alternate days).',
              timing: { repeat: { frequency: 1, period: 2, periodUnit: 'd' } },
            },
          ],
          authoredOn: '2025-02-01',
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'lab-d',
          status: 'final',
          code: {
            text: 'Vitamin D, 25-OH, serum',
            coding: [{ system: 'http://loinc.org', code: '62292-8', display: 'Vitamin D 25OH [Mass/volume] in Serum or Plasma' }],
          },
          effectiveDateTime: `${visitDate}T08:15:00Z`,
          valueQuantity: { value: 22, unit: 'ng/mL', system: 'http://unitsofmeasure.org', code: 'ng/mL' },
          referenceRange: [
            {
              low: { value: 30, unit: 'ng/mL' },
              high: { value: 100, unit: 'ng/mL' },
              text: 'Sufficiency typically 30–100 ng/mL (lab-specific)',
            },
          ],
          interpretation: [{ text: 'Below reference range — consistent with insufficiency' }],
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'lab-fe',
          status: 'final',
          code: {
            text: 'Ferritin, serum',
            coding: [{ system: 'http://loinc.org', code: '2276-4', display: 'Ferritin [Mass/volume] in Serum or Plasma' }],
          },
          effectiveDateTime: `${visitDate}T08:15:00Z`,
          valueQuantity: { value: 16, unit: 'ng/mL' },
          referenceRange: [{ low: { value: 30 }, high: { value: 300 }, unit: 'ng/mL', text: '30–300 ng/mL' }],
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'lab-hgb',
          status: 'final',
          code: {
            text: 'Hemoglobin',
            coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' }],
          },
          effectiveDateTime: `${visitDate}T08:15:00Z`,
          valueQuantity: { value: 11.2, unit: 'g/dL' },
          referenceRange: [{ low: { value: 12.0 }, high: { value: 15.5 }, unit: 'g/dL', text: '12.0–15.5 g/dL (female adult)' }],
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          id: 'lab-tsh',
          status: 'final',
          code: {
            text: 'Thyroid stimulating hormone (TSH)',
            coding: [{ system: 'http://loinc.org', code: '3016-3', display: 'TSH' }],
          },
          effectiveDateTime: `${visitDate}T08:15:00Z`,
          valueQuantity: { value: 2.1, unit: 'mIU/L' },
          referenceRange: [{ low: { value: 0.4 }, high: { value: 4.0 }, unit: 'mIU/L' }],
        },
      },
      {
        resource: {
          resourceType: 'Immunization',
          id: 'imm-1',
          status: 'completed',
          vaccineCode: {
            text: 'Influenza, seasonal, injectable',
            coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '141', display: 'Influenza, seasonal, injectable' }],
          },
          occurrenceDateTime: '2024-10-12',
          primarySource: true,
        },
      },
      {
        resource: {
          resourceType: 'Immunization',
          id: 'imm-2',
          status: 'completed',
          vaccineCode: {
            text: 'COVID-19, mRNA, bivalent booster',
          },
          occurrenceDateTime: '2024-09-03',
          primarySource: true,
        },
      },
      {
        resource: {
          resourceType: 'Immunization',
          id: 'imm-3',
          status: 'completed',
          vaccineCode: {
            text: 'Tdap (tetanus, diphtheria, pertussis)',
            coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '115', display: 'Tdap' }],
          },
          occurrenceDateTime: '2021-04-18',
          primarySource: true,
        },
      },
    ],
    _helia: {
      hospitalId: hospital.id,
      hospitalDisplayName: hospital.name,
      lastVisitDate: visitDate,
      lastVisitProvider: p.name,
      lastVisitDepartment: p.dept,
    },
  };
}

function codingDisplay(cc) {
  if (!cc) return '';
  if (cc.text) return cc.text;
  const c = cc.coding && cc.coding[0];
  return c ? c.display || c.code || '' : '';
}

function summarizeFhirForUi(bundle) {
  const meta = bundle._helia || {};
  const entries = bundle.entry || [];
  const diagnoses = [];
  const medications = [];
  const labs = [];
  const immunizations = [];

  for (const e of entries) {
    const r = e.resource;
    if (!r) continue;
    if (r.resourceType === 'Condition') {
      diagnoses.push({
        id: r.id,
        label: codingDisplay(r.code),
        icd: (r.code && r.code.coding && r.code.coding[0] && r.code.coding[0].code) || '',
        onset: r.onsetDateTime || '',
      });
    }
    if (r.resourceType === 'MedicationRequest') {
      const doseText =
        (r.dosageInstruction && r.dosageInstruction[0] && r.dosageInstruction[0].text) || '';
      medications.push({
        id: r.id,
        name: codingDisplay(r.medicationCodeableConcept),
        instructions: doseText,
        authored: r.authoredOn || '',
      });
    }
    if (r.resourceType === 'Observation' && r.valueQuantity) {
      const rr = r.referenceRange && r.referenceRange[0];
      let rangeStr = '';
      if (rr) {
        if (rr.text) rangeStr = rr.text;
        else if (rr.low && rr.high) rangeStr = `${rr.low.value}–${rr.high.value} ${rr.low.unit || rr.high.unit || ''}`;
      }
      labs.push({
        id: r.id,
        name: codingDisplay(r.code),
        value: `${r.valueQuantity.value} ${r.valueQuantity.unit || ''}`.trim(),
        reference: rangeStr,
        date: r.effectiveDateTime || '',
      });
    }
    if (r.resourceType === 'Immunization') {
      immunizations.push({
        id: r.id,
        name: codingDisplay(r.vaccineCode),
        date: r.occurrenceDateTime || '',
      });
    }
  }

  return {
    hospitalMeta: meta,
    diagnoses,
    medications,
    labs,
    immunizations,
    lastVisitDate: meta.lastVisitDate || '',
    lastVisitProvider: meta.lastVisitProvider || '',
    lastVisitDepartment: meta.lastVisitDepartment || '',
  };
}

function OAuthModal({ open, hospitalName, phase, onClose }) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(44, 44, 44, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
        boxSizing: 'border-box',
      }}
      onClick={(e) => e.target === e.currentTarget && phase === 'success' && onClose()}
    >
      <div
        style={{
          background: helia.card,
          borderRadius: helia.radius,
          padding: 32,
          maxWidth: 420,
          width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
          border: `1px solid ${helia.border}`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: helia.sageMuted,
            border: `2px solid rgba(122, 158, 126, 0.45)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {phase === 'redirecting' ? (
            <span
              style={{
                width: 28,
                height: 28,
                border: `3px solid ${helia.border}`,
                borderTopColor: helia.sage,
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'heliaSpin 0.85s linear infinite',
              }}
            />
          ) : (
            <span style={{ fontSize: 28, color: helia.forest }}>✓</span>
          )}
        </div>
        <h2 id="oauth-modal-title" style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, color: helia.forest }}>
          {phase === 'redirecting' ? `Redirecting to ${hospitalName} login…` : 'Successfully connected!'}
        </h2>
        <p style={{ margin: 0, color: helia.muted, fontSize: 16, lineHeight: 1.55 }}>
          {phase === 'redirecting'
            ? 'Opening your hospital’s secure Epic login. Approve access so Helia can read your clinical summaries (simulated for this demo).'
            : 'Your hospital chart is linked. Helia will sync diagnoses, medications, labs, and immunizations for your advocate experience.'}
        </p>
        <style>{`@keyframes heliaSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function HospitalConnect() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ragWarning, setRagWarning] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalHospital, setModalHospital] = useState(null);
  const [modalPhase, setModalPhase] = useState('redirecting');

  const loadConnection = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    const { data, error: qErr } = await supabase
      .from('hospital_connections')
      .select('id, hospital_name, connected_at, fhir_data')
      .eq('user_id', user.id)
      .maybeSingle();
    if (qErr) {
      setError(qErr.message);
      setRow(null);
    } else {
      setRow(data || null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    let m = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!m) return;
      setUser(data.user || null);
    })();
    return () => {
      m = false;
    };
  }, []);

  useEffect(() => {
    if (user) loadConnection();
  }, [user, loadConnection]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  async function postProcessFhir(userId, hospitalName, fhirBundle) {
    const res = await fetch(`${HELIA_API_BASE}/api/process-fhir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, hospitalName, fhirBundle }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || `Sync failed (${res.status})`);
    }
    return json;
  }

  function beginConnect(hospital) {
    setModalHospital(hospital);
    setModalPhase('redirecting');
    setModalOpen(true);
    setRagWarning('');

    window.setTimeout(() => {
      setModalPhase('success');
    }, 2000);

    window.setTimeout(async () => {
      setModalOpen(false);
      setModalHospital(null);
      if (!user?.id) return;

      const fhirBundle = buildMockFhirBundle(hospital);
      const connectedAt = new Date().toISOString();

      const { error: upErr } = await supabase.from('hospital_connections').upsert(
        [
          {
            user_id: user.id,
            hospital_name: hospital.name,
            connected_at: connectedAt,
            fhir_data: fhirBundle,
          },
        ],
        { onConflict: 'user_id' }
      );

      if (upErr) {
        setError(upErr.message);
        return;
      }

      try {
        await postProcessFhir(user.id, hospital.name, fhirBundle);
        setRagWarning('');
      } catch (e) {
        setRagWarning(
          e.message ||
            'Hospital data saved, but search indexing failed. Your clinician can still view records here; try again later for chat memory.'
        );
      }

      await loadConnection();
    }, 3200);
  }

  const summary = row?.fhir_data ? summarizeFhirForUi(row.fhir_data) : null;
  const connected = !!row && !!row.hospital_name;

  const cardStyle = {
    padding: 20,
    borderRadius: helia.radius,
    background: helia.card,
    border: `1px solid ${helia.border}`,
    boxShadow: helia.cardShadow,
  };

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
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: helia.forest, letterSpacing: '-0.02em' }}>
            Hospital records
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16, maxWidth: 720 }}>
            Connect your hospital’s Epic chart (simulated OAuth for now). When connected, Helia can pull structured
            summaries—diagnoses, meds, labs, and immunizations—and index them for your AI advocate.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {error && (
            <div
              style={{
                marginBottom: 20,
                padding: 14,
                borderRadius: helia.radiusSm,
                background: helia.alertBg,
                color: helia.alert,
                border: `1px solid rgba(192, 57, 43, 0.25)`,
              }}
            >
              {error}
            </div>
          )}
          {ragWarning && (
            <div
              style={{
                marginBottom: 20,
                padding: 14,
                borderRadius: helia.radiusSm,
                background: helia.warningBg,
                color: '#8a6d1f',
                border: `1px solid rgba(212, 168, 67, 0.35)`,
              }}
            >
              {ragWarning}
            </div>
          )}

          {loading ? (
            <div style={{ color: helia.muted }}>Loading…</div>
          ) : !connected ? (
            <section>
              <h2 style={{ color: helia.forest, marginBottom: 8, fontSize: 22, fontWeight: 700 }}>Connect your hospital</h2>
              <p style={{ marginTop: 0, marginBottom: 24, color: helia.body, fontSize: 16 }}>
                Linking your hospital lets Helia automatically pull recent diagnoses, medications, lab results, and
                immunizations from your Epic chart—so your companion sees the same clinical picture your care team uses.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {HOSPITALS.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      ...cardStyle,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div
                        aria-hidden
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: helia.radiusSm,
                          background: helia.sageMuted,
                          border: `1px solid rgba(122, 158, 126, 0.35)`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 14,
                          color: helia.forest,
                          flexShrink: 0,
                        }}
                      >
                        {h.initials}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 18, color: helia.forest }}>{h.name}</div>
                        <div style={{ fontSize: 14, color: helia.muted }}>{h.subtitle}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => beginConnect(h)}
                      style={{
                        padding: '12px 22px',
                        fontWeight: 700,
                        background: helia.sage,
                        color: '#fff',
                        border: `1px solid rgba(122, 158, 126, 0.4)`,
                        borderRadius: helia.radiusSm,
                        cursor: 'pointer',
                        fontFamily: helia.font,
                        flexShrink: 0,
                      }}
                    >
                      Connect
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 24, fontSize: 14, color: helia.muted, lineHeight: 1.5 }}>
                Production path: Epic SMART on FHIR OAuth replaces this simulation—same Helia UI, real tokens and scopes,
                no change to how records appear here.
              </p>
            </section>
          ) : (
            <>
              <section style={{ marginBottom: 28 }}>
                <div style={{ ...cardStyle, background: helia.successBg, borderColor: 'rgba(122, 158, 126, 0.35)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: helia.sage, letterSpacing: '0.06em' }}>
                    CONNECTED
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: helia.forest, marginTop: 6 }}>{row.hospital_name}</div>
                  <div style={{ marginTop: 10, color: helia.body, fontSize: 16 }}>
                    Last synced:{' '}
                    <strong>
                      {row.connected_at
                        ? new Date(row.connected_at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </strong>
                  </div>
                  <p style={{ margin: '14px 0 0', color: helia.muted, fontSize: 15 }}>
                    Pulled: {summary?.diagnoses?.length || 0} diagnoses · {summary?.medications?.length || 0} active
                    medications · {summary?.labs?.length || 0} recent labs · {summary?.immunizations?.length || 0}{' '}
                    immunizations.
                  </p>
                  {summary?.lastVisitDate && (
                    <p style={{ margin: '10px 0 0', fontSize: 15, color: helia.body }}>
                      Last visit:{' '}
                      <strong>
                        {new Date(summary.lastVisitDate + 'T12:00:00').toLocaleDateString(undefined, {
                          dateStyle: 'long',
                        })}
                      </strong>
                      {summary.lastVisitProvider ? (
                        <>
                          {' '}
                          with <strong>{summary.lastVisitProvider}</strong>
                          {summary.lastVisitDepartment ? ` (${summary.lastVisitDepartment})` : ''}
                        </>
                      ) : null}
                    </p>
                  )}
                </div>
              </section>

              <section style={{ marginBottom: 24 }}>
                <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Diagnoses</h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(summary?.diagnoses || []).map((d) => (
                    <div key={d.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: helia.forest }}>{d.label}</div>
                      <div style={{ fontSize: 14, color: helia.muted, marginTop: 6 }}>
                        {d.icd ? `ICD-10: ${d.icd}` : ''}
                        {d.onset ? ` · Onset ${d.onset}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginBottom: 24 }}>
                <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Medications</h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(summary?.medications || []).map((m) => (
                    <div key={m.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: helia.forest }}>{m.name}</div>
                      <div style={{ marginTop: 8, fontSize: 15 }}>{m.instructions}</div>
                      {m.authored && (
                        <div style={{ fontSize: 13, color: helia.muted, marginTop: 8 }}>Prescribed / reviewed: {m.authored}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginBottom: 24 }}>
                <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Recent labs</h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(summary?.labs || []).map((L) => (
                    <div key={L.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: helia.forest }}>{L.name}</div>
                      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, color: helia.body }}>{L.value}</div>
                      {L.reference && (
                        <div style={{ fontSize: 14, color: helia.muted, marginTop: 6 }}>Reference: {L.reference}</div>
                      )}
                      {L.date && (
                        <div style={{ fontSize: 13, color: helia.muted, marginTop: 6 }}>
                          Collected: {new Date(L.date).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section style={{ marginBottom: 24 }}>
                <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Immunizations</h2>
                <div style={{ display: 'grid', gap: 12 }}>
                  {(summary?.immunizations || []).map((im) => (
                    <div key={im.id} style={cardStyle}>
                      <div style={{ fontWeight: 700, color: helia.forest }}>{im.name}</div>
                      {im.date && (
                        <div style={{ fontSize: 14, color: helia.muted, marginTop: 8 }}>
                          Given: {new Date(im.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => {
                    const hid = row.fhir_data?._helia?.hospitalId;
                    const h =
                      HOSPITALS.find((x) => x.id === hid) ||
                      HOSPITALS.find((x) => x.name === row.hospital_name) ||
                      HOSPITALS[0];
                    beginConnect(h);
                  }}
                  style={{
                    padding: '12px 18px',
                    fontWeight: 600,
                    background: helia.cream,
                    color: helia.forest,
                    border: `1px solid ${helia.border}`,
                    borderRadius: helia.radiusSm,
                    cursor: 'pointer',
                    fontFamily: helia.font,
                  }}
                >
                  Sync again (demo)
                </button>
              </section>
            </>
          )}
        </main>
      </div>

      <OAuthModal
        open={modalOpen}
        hospitalName={modalHospital?.name || 'your hospital'}
        phase={modalPhase}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
