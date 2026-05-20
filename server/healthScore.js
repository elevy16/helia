/**
 * Health Engagement Score — measures app usage, not medical health status.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const BREAKDOWN_META = [
  {
    key: 'hospital',
    label: 'Hospital connected',
    maxPoints: 20,
    suggestion: 'Connect your hospital to get more personalized insights',
    link: '/hospital',
  },
  {
    key: 'documents',
    label: 'Documents uploaded',
    maxPoints: 20,
    suggestion: 'Upload health documents to build your health record',
    link: '/dashboard',
  },
  {
    key: 'medications',
    label: 'Medications logged',
    maxPoints: 10,
    suggestion: 'Log your medications so Helia can track interactions',
    link: '/medications',
  },
  {
    key: 'symptoms',
    label: 'Symptoms logged (last 30 days)',
    maxPoints: 10,
    suggestion: 'Log symptoms to spot patterns over time',
    link: '/symptoms',
  },
  {
    key: 'appointmentPrep',
    label: 'Appointment prep (last 30 days)',
    maxPoints: 10,
    suggestion: 'Try Appointment Prep before your next visit',
    link: '/appointment-prep',
  },
  {
    key: 'debrief',
    label: 'Post-appointment debrief logged',
    maxPoints: 10,
    suggestion: 'Save an appointment debrief after your next visit',
    link: '/debrief',
  },
  {
    key: 'healthAlerts',
    label: 'Health alerts viewed',
    maxPoints: 10,
    suggestion: 'Check your Health Alerts for personalized updates',
    link: '/alerts',
  },
  {
    key: 'chat',
    label: 'Chat used (last 7 days)',
    maxPoints: 10,
    suggestion: 'Chat with Helia about a health question this week',
    link: '/dashboard',
  },
];

async function safeEngagementFetch(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('appointment_prep_at, health_alerts_viewed_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[health-score] user_engagement query failed:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[health-score] user_engagement unavailable:', err.message);
    return null;
  }
}

async function recordEngagement(supabase, userId, fields) {
  try {
    const { error } = await supabase.from('user_engagement').upsert(
      {
        user_id: userId,
        ...fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) console.warn('[user_engagement] upsert failed:', error.message);
  } catch (err) {
    console.warn('[user_engagement] upsert unavailable:', err.message);
  }
}

async function calculateHealthScore(supabase, userId) {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS).toISOString();
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();

  const [
    hospitalRes,
    docsRes,
    medsRes,
    symptomsRes,
    debriefsRes,
    chatRes,
    engagement,
  ] = await Promise.all([
    supabase.from('hospital_connections').select('id').eq('user_id', userId).maybeSingle(),
    supabase.from('document_texts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('medications').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('symptoms')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('logged_at', thirtyDaysAgo),
    supabase.from('debriefs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo),
    safeEngagementFetch(supabase, userId),
  ]);

  const docCount = docsRes.count || 0;
  const hasHospital = !!hospitalRes.data;
  const hasMeds = (medsRes.count || 0) > 0;
  const hasRecentSymptoms = (symptomsRes.count || 0) > 0;
  const hasDebrief = (debriefsRes.count || 0) > 0;
  const hasRecentChat = (chatRes.count || 0) > 0;

  const hasRecentPrep =
    engagement?.appointment_prep_at &&
    new Date(engagement.appointment_prep_at).getTime() >= now - THIRTY_DAYS_MS;

  const hasViewedAlerts = !!engagement?.health_alerts_viewed_at;

  const documentPoints = Math.min(docCount, 5) * 4;

  const pointsByKey = {
    hospital: hasHospital ? 20 : 0,
    documents: documentPoints,
    medications: hasMeds ? 10 : 0,
    symptoms: hasRecentSymptoms ? 10 : 0,
    appointmentPrep: hasRecentPrep ? 10 : 0,
    debrief: hasDebrief ? 10 : 0,
    healthAlerts: hasViewedAlerts ? 10 : 0,
    chat: hasRecentChat ? 10 : 0,
  };

  const breakdown = BREAKDOWN_META.map((meta) => {
    const points = pointsByKey[meta.key] || 0;
    const earned = points >= meta.maxPoints;
    const detail =
      meta.key === 'documents'
        ? `${Math.min(docCount, 5)} of 5 documents (${points}/${meta.maxPoints} pts)`
        : earned
          ? `${points}/${meta.maxPoints} pts`
          : `0/${meta.maxPoints} pts`;

    return {
      key: meta.key,
      label: meta.label,
      points,
      maxPoints: meta.maxPoints,
      earned,
      detail,
      suggestion: earned ? null : meta.suggestion,
      link: meta.link,
    };
  });

  const score = breakdown.reduce((sum, item) => sum + item.points, 0);

  return {
    score: Math.min(score, 100),
    maxScore: 100,
    breakdown,
  };
}

module.exports = {
  calculateHealthScore,
  recordEngagement,
};
