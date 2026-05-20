/** Helpers to assemble emergency card data from FHIR, medications, and documents. */

function codingDisplay(cc) {
  if (!cc) return '';
  if (cc.text) return cc.text;
  const c = cc.coding && cc.coding[0];
  return c ? c.display || c.code || '' : '';
}

function patientDisplayName(patient) {
  if (!patient || !patient.name || !patient.name.length) return '';
  const n = patient.name[0];
  const given = Array.isArray(n.given) ? n.given.join(' ') : n.given || '';
  const family = n.family || '';
  return [given, family].filter(Boolean).join(' ').trim();
}

function isActiveCondition(resource) {
  const status = resource.clinicalStatus?.coding?.[0]?.code;
  return !status || status === 'active' || status === 'recurrence' || status === 'relapse';
}

function isActiveMedicationRequest(resource) {
  const status = String(resource.status || '').toLowerCase();
  return !status || status === 'active' || status === 'on-hold';
}

export function extractFhirEmergencyData(fhirBundle) {
  const result = {
    birthDate: '',
    patientName: '',
    primaryDoctor: '',
    diagnoses: [],
    medications: [],
    allergies: [],
  };

  if (!fhirBundle || typeof fhirBundle !== 'object') return result;

  const entries = fhirBundle.entry || [];
  for (const e of entries) {
    const r = e.resource;
    if (!r) continue;

    if (r.resourceType === 'Patient') {
      if (r.birthDate) result.birthDate = r.birthDate;
      const name = patientDisplayName(r);
      if (name) result.patientName = name;
      const gp = r.generalPractitioner?.[0]?.display;
      if (gp && !result.primaryDoctor) result.primaryDoctor = gp;
    }

    if (r.resourceType === 'Condition' && isActiveCondition(r)) {
      const label = codingDisplay(r.code);
      if (label) result.diagnoses.push(label);
    }

    if (r.resourceType === 'MedicationRequest' && isActiveMedicationRequest(r)) {
      const name = codingDisplay(r.medicationCodeableConcept);
      const doseText = r.dosageInstruction?.[0]?.text || '';
      if (name) {
        result.medications.push(doseText ? `${name} — ${doseText}` : name);
      }
    }

    if (r.resourceType === 'AllergyIntolerance') {
      const substance = codingDisplay(r.code) || r.code?.text || '';
      const reaction =
        r.reaction?.[0]?.manifestation?.[0]?.text ||
        codingDisplay(r.reaction?.[0]?.manifestation?.[0]) ||
        '';
      const criticality = r.criticality ? ` (${r.criticality})` : '';
      const label = substance
        ? reaction
          ? `${substance}: ${reaction}${criticality}`
          : `${substance}${criticality}`
        : reaction;
      if (label) result.allergies.push(label);
    }
  }

  const meta = fhirBundle._helia || {};
  if (!result.primaryDoctor && meta.lastVisitProvider) {
    result.primaryDoctor = meta.lastVisitProvider;
  }

  return {
    ...result,
    diagnoses: [...new Set(result.diagnoses)],
    medications: [...new Set(result.medications)],
    allergies: [...new Set(result.allergies)],
  };
}

export function mergeMedications(trackerMeds, fhirMedLines) {
  const lines = [];
  const seen = new Set();

  for (const m of trackerMeds || []) {
    if (!m.active && m.active !== undefined) continue;
    const line = `${m.name} ${m.dosage} — ${m.frequency}`.trim();
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(line);
    }
  }

  for (const line of fhirMedLines || []) {
    const key = String(line).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(line);
    }
  }

  return lines;
}

export function parseRedFlags(flagsValue) {
  if (Array.isArray(flagsValue)) return flagsValue;
  if (typeof flagsValue === 'string') {
    try {
      const parsed = JSON.parse(flagsValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function collectCriticalNotes(documents) {
  const notes = [];
  const seen = new Set();

  for (const doc of documents || []) {
    const flags = parseRedFlags(doc.red_flags);
    for (const flag of flags) {
      if (!flag || typeof flag !== 'object') continue;
      const title = String(flag.title || flag.label || '').trim();
      const desc = String(flag.description || flag.detail || '').trim();
      const line = title && desc ? `${title}: ${desc}` : title || desc;
      if (!line) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push(line);
    }
  }

  return notes;
}

export function mergeAllergies(userAllergies, fhirAllergies) {
  const lines = [];
  const seen = new Set();

  const add = (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(t);
  };

  for (const a of fhirAllergies || []) add(a);
  for (const part of String(userAllergies || '').split(/[,;\n]+/)) add(part);

  return lines;
}

export function formatDisplayDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function buildCardViewModel(saved, fhirData, trackerMeds, documents) {
  const fhir = extractFhirEmergencyData(fhirData);
  const medications = mergeMedications(trackerMeds, fhir.medications);
  const allergies = mergeAllergies(saved.allergies, fhir.allergies);
  const criticalNotes = collectCriticalNotes(documents);

  return {
    fullName: saved.full_name || fhir.patientName || '',
    dateOfBirth: saved.date_of_birth || fhir.birthDate || '',
    bloodType: saved.blood_type || '',
    diagnoses: fhir.diagnoses,
    medications,
    allergies,
    emergencyContactName: saved.emergency_contact_name || '',
    emergencyContactPhone: saved.emergency_contact_phone || '',
    primaryDoctorName: saved.primary_doctor_name || fhir.primaryDoctor || '',
    primaryDoctorPhone: saved.primary_doctor_phone || '',
    criticalNotes,
    lastUpdated: saved.updated_at || null,
  };
}

export async function downloadEmergencyCardPdf(card) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addSection = (title, lines) => {
    if (!lines || (Array.isArray(lines) && lines.length === 0)) return;
    if (y > 680) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const items = Array.isArray(lines) ? lines : [lines];
    for (const item of items) {
      const wrapped = doc.splitTextToSize(String(item || '—'), maxWidth);
      for (const line of wrapped) {
        if (y > 720) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 14;
      }
      y += 4;
    }
    y += 8;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('IN CASE OF EMERGENCY', pageWidth / 2, y, { align: 'center' });
  y += 22;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Helia Emergency Health Card', pageWidth / 2, y, { align: 'center' });
  y += 28;

  doc.setDrawColor(0);
  doc.setLineWidth(1);
  doc.rect(margin - 8, margin - 8, maxWidth + 16, 720 - margin, 'S');

  addSection('Patient', [
    `Name: ${card.fullName || '—'}`,
    `Date of birth: ${formatDisplayDate(card.dateOfBirth)}`,
    `Blood type: ${card.bloodType || '—'}`,
  ]);

  addSection('Active diagnoses', card.diagnoses.length ? card.diagnoses : ['None recorded']);
  addSection('Current medications', card.medications.length ? card.medications : ['None recorded']);
  addSection('Known allergies', card.allergies.length ? card.allergies : ['None recorded']);
  addSection('Emergency contact', [
    `${card.emergencyContactName || '—'}${card.emergencyContactPhone ? ` · ${card.emergencyContactPhone}` : ''}`,
  ]);
  addSection('Primary doctor', [
    `${card.primaryDoctorName || '—'}${card.primaryDoctorPhone ? ` · ${card.primaryDoctorPhone}` : ''}`,
  ]);
  addSection('Critical health notes', card.criticalNotes.length ? card.criticalNotes : ['None recorded']);

  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Last updated: ${formatDisplayDate(card.lastUpdated) || 'Not saved yet'}`, margin, Math.min(y, 740));

  doc.save('helia-emergency-card.pdf');
}
