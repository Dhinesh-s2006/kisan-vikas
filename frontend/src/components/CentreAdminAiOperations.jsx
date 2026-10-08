import React, { useState } from 'react';
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Icon
} from './design-system';

export default function CentreAdminAiOperations({
  api,
  centreData,
  stats,
  pacingData,
  queue = [],
  grievances = [],
  demandOutlook,
  aiLoading,
  aiQuery,
  setAiQuery,
  aiResponse,
  aiError,
  simType,
  setSimType,
  simArrivalPct,
  setSimArrivalPct,
  simCounterDelta,
  setSimCounterDelta,
  fetchAiBriefing,
  handleAskAi,
  handleRunSimulation,
  onNavigateTab
}) {
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [askAnswer, setAskAnswer] = useState(null);
  const [askError, setAskError] = useState(null);
  const [showWhyDetails, setShowWhyDetails] = useState(false);
  const [showPlanAhead, setShowPlanAhead] = useState(false);

  const handleAsk = async (eOrQuery) => {
    if (eOrQuery && typeof eOrQuery.preventDefault === 'function') {
      eOrQuery.preventDefault();
    }
    const queryToAsk = (typeof eOrQuery === 'string' ? eOrQuery : question).trim();
    if (!queryToAsk) return;

    setQuestion(queryToAsk);
    setAskedQuestion(queryToAsk);
    setIsAsking(true);
    setAskError(null);

    try {
      let data = null;
      if (api) {
        const res = await api.post('/officer-ai/ask', { query: queryToAsk });
        data = res.data;
      } else {
        const token = localStorage.getItem('kisan_admin_token');
        const res = await fetch('http://localhost:4000/api/officer-ai/ask', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ query: queryToAsk })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }
      setAskAnswer(data);
    } catch (err) {
      console.error('Ask error:', err);
      setAskError('Unable to get an answer right now. Please verify backend connectivity and try again.');
    } finally {
      setIsAsking(false);
    }
  };

  const centreName = centreData?.centre_name || 'Procurement Centre';
  const centreId = centreData?.centre_id || '';
  const waitingCount = stats?.active_queue_today ?? stats?.farmers_in_queue ?? queue.length;
  const activeCounters = Math.max(1, Number(stats?.active_counters || centreData?.active_counters || 2));
  const dailyCapacity = Number(stats?.daily_capacity || centreData?.daily_capacity_slots || 80);
  const processingRate = Number(pacingData?.metrics?.observed_rate_min || stats?.processing_rate_min || 12);
  const estWaitMin = Math.round((waitingCount * processingRate) / activeCounters);
  const currentStockMt = Number(centreData?.current_stock_mt || 0);
  const storageCapacityMt = Number(centreData?.storage_capacity_mt || 250);
  const headroomMt = Math.max(0, storageCapacityMt - currentStockMt);
  const expectedArrivals = demandOutlook?.expected_farmers_range || demandOutlook?.expected_farmers || 0;

  // Status check
  const isHealthy = (!pacingData || pacingData.pacing_status === 'NORMAL' || pacingData.pacing_status === 'FLOW_NORMAL') && (waitingCount < dailyCapacity * 0.9);

  // 5 Practical Officer Questions
  const officerQuestions = [
    {
      id: 'how_doing',
      label: 'How is my centre doing?',
      query: 'How is my centre doing?'
    },
    {
      id: 'waiting_too_long',
      label: 'Who is waiting too long?',
      query: 'Who is waiting too long?'
    },
    {
      id: 'queue_increase',
      label: "Will today's queue increase?",
      query: "Will today's queue increase?"
    },
    {
      id: 'storage_check',
      label: 'Do I have enough capacity?',
      query: 'Do I have enough capacity?'
    },
    {
      id: 'tomorrow_prep',
      label: 'What should I prepare for tomorrow?',
      query: 'What should I prepare for tomorrow?'
    }
  ];

  // Derive Data-Driven Attention Issues (Zero fake alerts)
  const attentionIssues = [];

  // 1. Long waiting farmers in queue
  const delayedFarmer = queue.find(b => (b.estimated_wait_minutes && b.estimated_wait_minutes > 30) || (pacingData?.pacing_status === 'DELAYED' && b.status === 'Checked-In'));
  if (delayedFarmer) {
    const tokenStr = delayedFarmer.token || `#${delayedFarmer.queue_position_at_booking || '—'}`;
    attentionIssues.push({
      id: 'farmer_delayed',
      type: 'warning',
      text: `${tokenStr} waiting longer than expected (${delayedFarmer.name || 'Farmer'})`,
      actionLabel: 'Open Queue',
      action: () => onNavigateTab('queue')
    });
  } else if (pacingData && (pacingData.pacing_status === 'DELAYED' || pacingData.recommended_delay_minutes > 0)) {
    attentionIssues.push({
      id: 'pacing_delay',
      type: 'warning',
      text: pacingData.reason || 'Queue flow is slower than scheduled rate. Stagger arrivals.',
      actionLabel: 'Open Queue',
      action: () => onNavigateTab('queue')
    });
  }

  // 2. Open Grievances
  const openGrievance = grievances.find(g => g.status !== 'Resolved' && g.status !== 'Verified Resolved' && g.status !== 'AWAITING_FARMER_CONFIRMATION');
  if (openGrievance) {
    attentionIssues.push({
      id: 'grievance_attention',
      type: 'error',
      text: `Grievance #${openGrievance.grievance_id} needs response (${openGrievance.issue_type || 'Dispute'})`,
      actionLabel: 'Open Grievance',
      action: () => onNavigateTab('grievances')
    });
  }

  // 3. Near capacity limit
  if (waitingCount > dailyCapacity * 0.85) {
    attentionIssues.push({
      id: 'capacity_limit',
      type: 'warning',
      text: `Centre queue approaching daily capacity limit (${waitingCount} / ${dailyCapacity} slots)`,
      actionLabel: 'Open Demand',
      action: () => onNavigateTab('demand')
    });
  }

  // Simulation results extraction (if any)
  const sim = aiResponse?.simulation || aiResponse?.structured_response?.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ===================================================== */}
      {/* A. HEADER                                             */}
      {/* ===================================================== */}
      <Card style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
                Centre Assistant
              </h2>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 12,
                background: 'var(--kq-green-50, #f0fdf4)',
                color: 'var(--kq-green-800, #166534)',
                border: '1px solid var(--kq-green-200, #bbf7d0)'
              }}>
                AI suggestions • Officer approval required
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--kq-text-secondary, #4b5563)' }}>
              Your quick operational briefing for today.
            </p>
          </div>

          <SecondaryButton
            onClick={fetchAiBriefing}
            disabled={aiLoading}
            style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
          >
            <Icon name="refresh-cw" size={13} className={aiLoading ? 'kq-spin' : ''} />
            <span>Refresh</span>
          </SecondaryButton>
        </div>
      </Card>

      {/* ===================================================== */}
      {/* B. TODAY'S CENTRE STATUS (Large but calm status card)  */}
      {/* ===================================================== */}
      <Card style={{
        padding: 22,
        borderLeft: isHealthy ? '4px solid var(--kq-green-700, #15803d)' : '4px solid #d97706'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>{isHealthy ? '🟢' : '🟡'}</span>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--kq-text-primary, #111827)' }}>
            {isHealthy ? 'Centre is operating normally.' : 'Centre flow delayed — attention needed.'}
          </h3>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '12px 0 8px', alignItems: 'baseline' }}>
          <div style={{ fontSize: 15, color: 'var(--kq-text-primary, #111827)' }}>
            <strong>{waitingCount} farmers</strong> waiting
          </div>
          <div style={{ color: 'var(--kq-border-medium, #d1d5db)' }}>•</div>
          <div style={{ fontSize: 15, color: 'var(--kq-text-primary, #111827)' }}>
            <strong>~{estWaitMin} min</strong> estimated wait
          </div>
          <div style={{ color: 'var(--kq-border-medium, #d1d5db)' }}>•</div>
          <div style={{ fontSize: 15, color: 'var(--kq-text-primary, #111827)' }}>
            <strong>{activeCounters} counters</strong> active
          </div>
        </div>

        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--kq-text-secondary, #4b5563)', lineHeight: 1.5 }}>
          {isHealthy
            ? 'Produce inspection, weighing, and DBT settlement are progressing at standard velocity.'
            : (pacingData?.reason || 'Queue flow is slower than scheduled rate. Review queue arrivals.')}
        </p>
      </Card>

      {/* ===================================================== */}
      {/* C. WHAT NEEDS ATTENTION? (Data-Driven, Zero Fake Alerts) */}
      {/* ===================================================== */}
      <Card style={{ padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary, #4b5563)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          What Needs Attention?
        </div>

        {attentionIssues.length === 0 ? (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            padding: '12px 16px',
            borderRadius: 6,
            color: '#166534',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span>✓</span>
            <span>Nothing needs your attention right now.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {attentionIssues.map(issue => (
              <div
                key={issue.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: issue.type === 'error' ? '#fef2f2' : '#fffbeb',
                  border: `1px solid ${issue.type === 'error' ? '#fecaca' : '#fde68a'}`,
                  borderRadius: 6,
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: issue.type === 'error' ? '#b91c1c' : '#d97706', fontSize: 15 }}>⚠</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-primary, #111827)' }}>
                    {issue.text}
                  </span>
                </div>
                <PrimaryButton
                  onClick={issue.action}
                  style={{ fontSize: 11.5, padding: '4px 10px', height: 28 }}
                >
                  {issue.actionLabel}
                </PrimaryButton>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===================================================== */}
      {/* D. QUICK QUESTIONS (Practical 4-5 buttons)            */}
      {/* ===================================================== */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary, #4b5563)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Quick Questions
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {officerQuestions.map(q => (
            <button
              key={q.id}
              type="button"
              onClick={() => handleAsk(q.query)}
              disabled={isAsking}
              style={{
                background: '#ffffff',
                border: '1px solid var(--kq-border-medium, #d1d5db)',
                color: 'var(--kq-text-primary, #111827)',
                padding: '7px 14px',
                borderRadius: 20,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: isAsking ? 'not-allowed' : 'pointer',
                opacity: isAsking ? 0.7 : 1,
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                if (!isAsking) {
                  e.currentTarget.style.borderColor = 'var(--kq-green-700, #15803d)';
                  e.currentTarget.style.backgroundColor = 'var(--kq-green-50, #f0fdf4)';
                }
              }}
              onMouseLeave={e => {
                if (!isAsking) {
                  e.currentTarget.style.borderColor = 'var(--kq-border-medium, #d1d5db)';
                  e.currentTarget.style.backgroundColor = '#ffffff';
                }
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===================================================== */}
      {/* E. ASK YOUR CENTRE (Input + Real Answer + Show Why)   */}
      {/* ===================================================== */}
      <Card style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--kq-text-secondary, #4b5563)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
          Ask Your Centre
        </div>
        <form
          onSubmit={handleAsk}
          style={{ display: 'flex', gap: 10 }}
        >
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask about your centre..."
            className="kq-input"
            style={{
              flex: 1,
              padding: '9px 14px',
              fontSize: 13.5,
              borderRadius: 6
            }}
            disabled={isAsking}
          />
          <PrimaryButton
            type="submit"
            disabled={isAsking || !question.trim()}
            style={{ padding: '0 18px', fontSize: 13, gap: 6, whiteSpace: 'nowrap' }}
          >
            {isAsking ? (
              <>
                <Icon name="refresh-cw" size={14} className="kq-spin" />
                <span>Asking...</span>
              </>
            ) : (
              <>
                <Icon name="search" size={14} />
                <span>Ask</span>
              </>
            )}
          </PrimaryButton>
        </form>

        {/* Error notification with [Try Again] button */}
        {askError && (
          <div style={{
            marginTop: 12,
            background: 'var(--kq-danger-bg, #fef2f2)',
            border: '1px solid var(--kq-danger-border, #fecaca)',
            color: 'var(--kq-danger-text, #991b1b)',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert-triangle" size={15} />
              <span>{askError}</span>
            </div>
            <button
              type="button"
              onClick={() => handleAsk(question)}
              style={{
                background: '#ffffff',
                border: '1px solid var(--kq-danger-border, #fecaca)',
                color: 'var(--kq-danger-text, #991b1b)',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Immediate loading state */}
        {isAsking && (
          <div style={{ marginTop: 14, padding: '16px 12px', textAlign: 'center', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="refresh-cw" size={16} className="kq-spin" color="var(--kq-green-800, #166534)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--kq-text-primary, #111827)' }}>
                Getting your centre information...
              </span>
            </div>
          </div>
        )}

        {/* Real Answer Presentation */}
        {!isAsking && askAnswer && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--kq-border-light, #e5e7eb)', paddingTop: 14 }}>
            {/* YOUR QUESTION */}
            {askedQuestion && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--kq-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                  Your Question
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--kq-text-primary, #111827)', fontStyle: 'italic' }}>
                  "{askedQuestion}"
                </div>
              </div>
            )}

            {/* ANSWER */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--kq-green-800, #166534)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Answer
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--kq-text-primary, #111827)', lineHeight: 1.5, fontWeight: 500 }}>
                {askAnswer.structured_response?.summary || askAnswer.answer || 'Operational analysis completed.'}
              </p>
            </div>

            {/* SUGGESTED ACTION (if returned) */}
            {Array.isArray(askAnswer.structured_response?.recommendations || askAnswer.recommendations) && (askAnswer.structured_response?.recommendations || askAnswer.recommendations).length > 0 && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', marginBottom: 4 }}>
                  Suggested Action
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#14532d' }}>
                  {(askAnswer.structured_response?.recommendations || askAnswer.recommendations).map((rec, idx) => (
                    <li key={idx} style={{ marginBottom: 2 }}>
                      {typeof rec === 'string' ? rec : rec.action || rec.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* WHY THIS ANSWER ▾ (Supporting facts - only when relevant facts exist) */}
            {(() => {
              const relevantFacts = askAnswer.facts && typeof askAnswer.facts === 'object'
                ? Object.entries(askAnswer.facts).filter(([k, v]) => v !== null && v !== undefined && typeof v !== 'object')
                : [];
              const whyText = askAnswer.structured_response?.why || askAnswer.why;
              const hasWhyOrFacts = relevantFacts.length > 0 || Boolean(whyText);

              if (!hasWhyOrFacts) return null;

              return (
                <div style={{ borderTop: '1px solid var(--kq-border-light, #e5e7eb)', paddingTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowWhyDetails(!showWhyDetails)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--kq-green-800, #166534)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 0
                    }}
                  >
                    <span>{showWhyDetails ? 'Hide details ▴' : 'Why this answer? ▾'}</span>
                  </button>

                  {showWhyDetails && (
                    <div style={{ marginTop: 10, background: '#f9fafb', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)', fontSize: 12.5, color: 'var(--kq-text-secondary, #4b5563)', lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginBottom: 6 }}>
                        Live Operational Facts
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {whyText && (
                          <li style={{ marginBottom: 4 }}><strong>Rationale: </strong>{whyText}</li>
                        )}
                        {relevantFacts.map(([key, val]) => {
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                          return (
                            <li key={key} style={{ marginBottom: 2 }}>
                              {label}: <strong>{String(val)}</strong>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Card>

      {/* ===================================================== */}
      {/* 6. PLAN AHEAD (Secondary Expandable Section)          */}
      {/* ===================================================== */}
      <Card style={{ padding: 18, border: '1px solid var(--kq-border-medium, #d1d5db)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
              Plan Ahead
            </h4>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--kq-text-secondary, #4b5563)' }}>
              Simulate the impact of farmer arrival rushes or counter changes before taking action.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPlanAhead(!showPlanAhead)}
            style={{
              background: '#ffffff',
              border: '1px solid var(--kq-border-medium, #d1d5db)',
              padding: '5px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--kq-text-primary, #111827)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>{showPlanAhead ? 'Plan Ahead ▴' : 'Plan Ahead ▾'}</span>
          </button>
        </div>

        {showPlanAhead && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--kq-border-light, #e5e7eb)' }}>
            <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)', marginBottom: 12, fontStyle: 'italic' }}>
              Simulation only — no centre data will be changed.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
              {/* Arrival Increase */}
              <div style={{ background: '#f9fafb', padding: 12, borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginBottom: 8 }}>
                  Arrival increase:
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[10, 25, 50].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        setSimType('arrival_change');
                        setSimArrivalPct(pct);
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        borderRadius: 4,
                        border: simType === 'arrival_change' && simArrivalPct === pct ? '2px solid var(--kq-green-800, #166534)' : '1px solid var(--kq-border-medium, #d1d5db)',
                        backgroundColor: simType === 'arrival_change' && simArrivalPct === pct ? 'var(--kq-green-100, #dcfce7)' : '#ffffff',
                        color: 'var(--kq-text-primary, #111827)',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer'
                      }}
                    >
                      +{pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Counters */}
              <div style={{ background: '#f9fafb', padding: 12, borderRadius: 6, border: '1px solid var(--kq-border-light, #e5e7eb)' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--kq-text-primary, #111827)', marginBottom: 8 }}>
                  Active counters:
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[2, 3, 4].map(c => {
                    const delta = c - activeCounters;
                    const isSelected = simType === 'counter_change' && (simCounterDelta === delta || (delta === 0 && simCounterDelta === 1));
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setSimType('counter_change');
                          setSimCounterDelta(delta === 0 ? 1 : delta);
                        }}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: isSelected ? '2px solid var(--kq-green-800, #166534)' : '1px solid var(--kq-border-medium, #d1d5db)',
                          backgroundColor: isSelected ? 'var(--kq-green-100, #dcfce7)' : '#ffffff',
                          color: 'var(--kq-text-primary, #111827)',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer'
                        }}
                      >
                        [{c}]
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <PrimaryButton
              type="button"
              onClick={() => handleRunSimulation()}
              disabled={aiLoading}
              style={{ fontSize: 12.5, padding: '8px 16px', gap: 6 }}
            >
              <Icon name="play" size={13} />
              <span>Run Scenario</span>
            </PrimaryButton>

            {/* Simulation Results Display */}
            {aiResponse && (aiResponse.simulation || aiResponse.structured_response?.intent?.includes('SIMULATION') || aiResponse.intent === 'simulation') && (
              <div style={{ marginTop: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#166534', textTransform: 'uppercase', marginBottom: 8 }}>
                  Scenario Results
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: 4, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>Expected queue</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                      {sim?.projected?.active_queue_count ?? sim?.projected_queue ?? (simType === 'arrival_change' ? Math.round(waitingCount * (1 + simArrivalPct / 100)) : waitingCount)} farmers
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: 4, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>Estimated wait</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--kq-text-primary, #111827)' }}>
                      ~{sim?.projected?.est_wait_min ?? sim?.projected_wait_min ?? (simType === 'counter_change' ? Math.max(1, Math.round(estWaitMin * 0.7)) : estWaitMin)} min
                    </div>
                  </div>

                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: 4, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 11, color: 'var(--kq-text-muted, #6b7280)' }}>Capacity impact</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>
                      {sim?.projected?.occupancy_pct ?? sim?.projected_occupancy_pct ?? 0}% storage
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#14532d', lineHeight: 1.5 }}>
                  {aiResponse.structured_response?.summary || aiResponse.answer}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
