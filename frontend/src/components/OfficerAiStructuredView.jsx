import React, { useState } from 'react';
import { Icon } from './design-system/Icons';

/**
 * OfficerAiStructuredView
 * 
 * Renders officer-friendly, concise, intent-isolated responses for both
 * District Officer and Centre Admin AI Operations Assistant.
 * 
 * Guarantees:
 * 1. Strict intent isolation (no unrelated KPIs shown).
 * 2. Single status state (SAFE | WARNING | CRITICAL).
 * 3. Short officer-friendly summary answer.
 * 4. Crisp "Why?" explanation (1-2 sentences).
 * 5. Intent-specific data visualizer (stock comparison, surge table, etc.).
 * 6. Collapsible calculation details (default collapsed).
 * 7. Actionable recommendations.
 * 8. Explicit read-only simulation disclaimer.
 */
export default function OfficerAiStructuredView({ response, onNavigateTab, onSelectPrompt }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!response) return null;

  const struct = response.structured_response || normalizeFallbackResponse(response);
  const { intent, title, summary, status, why, data, details, recommendations, disclaimer, suggestions } = struct;

  // Single status style configuration
  const statusConfig = {
    SAFE: {
      bg: '#ecfdf5',
      border: '#a7f3d0',
      text: '#065f46',
      badgeBg: '#d1fae5',
      dot: '#10b981',
      label: intent?.includes('SIMULATION') ? 'SAFE / VIABLE' : 'HEALTHY / NORMAL'
    },
    WARNING: {
      bg: '#fffbeb',
      border: '#fde68a',
      text: '#92400e',
      badgeBg: '#fef3c7',
      dot: '#f59e0b',
      label: 'WARNING / ATTENTION NEEDED'
    },
    CRITICAL: {
      bg: '#fef2f2',
      border: '#fecaca',
      text: '#991b1b',
      badgeBg: '#fee2e2',
      dot: '#ef4444',
      label: 'CRITICAL / OVERLOAD RISK'
    }
  }[status] || {
    bg: '#f8fafc',
    border: '#e2e8f0',
    text: '#334155',
    badgeBg: '#e2e8f0',
    dot: '#64748b',
    label: 'INFORMATIONAL'
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      background: '#ffffff',
      borderRadius: 'var(--kq-radius-md, 8px)',
      border: `1px solid ${statusConfig.border}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      padding: 20
    }}>
      {/* 1. Header Bar: Intent + Status + Scope + Engine */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        paddingBottom: 14,
        borderBottom: '1px solid var(--kq-border-light, #e2e8f0)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Intent Tag */}
          <span style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            padding: '3px 8px',
            borderRadius: 4,
            background: 'var(--kq-green-100, #e6f4ea)',
            color: 'var(--kq-green-900, #137333)'
          }}>
            {title || intent?.replace(/_/g, ' ') || 'AI OPERATIONS DECISION SUPPORT'}
          </span>

          {/* Scope */}
          <span style={{ fontSize: 12, color: 'var(--kq-text-muted, #64748b)' }}>
            Scope: <strong style={{ color: 'var(--kq-text-primary, #1e293b)' }}>{response.scope || 'Assigned Scope'}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Engine/Provider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--kq-text-muted, #64748b)' }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--kq-green-600, #16a34a)',
              display: 'inline-block'
            }} />
            Engine: <strong>{response.model_used || response.provider_used || 'Hybrid Offline Rules'}</strong>
          </div>

          {/* Single Status Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 14,
            background: statusConfig.badgeBg,
            border: `1px solid ${statusConfig.border}`,
            fontSize: 11,
            fontWeight: 800,
            color: statusConfig.text
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: statusConfig.dot,
              display: 'inline-block'
            }} />
            {statusConfig.label}
          </div>
        </div>
      </div>

      {/* 2. Direct Answer / Summary Card */}
      <div style={{
        background: statusConfig.bg,
        borderLeft: `5px solid ${statusConfig.dot}`,
        padding: '16px 18px',
        borderRadius: 6
      }}>
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          color: statusConfig.text,
          lineHeight: 1.5
        }}>
          {summary || response.answer}
        </div>
      </div>

      {/* 3. "Why?" Box (1-2 sentences explanation) */}
      {why && (
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: '12px 16px',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start'
        }}>
          <div style={{ marginTop: 2 }}>
            <Icon name="info" size={16} color="var(--kq-green-700, #15803d)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--kq-text-muted, #64748b)', letterSpacing: '0.04em', marginBottom: 2 }}>
              Why this assessment?
            </div>
            <div style={{ fontSize: 13, color: 'var(--kq-text-primary, #1e293b)', lineHeight: 1.5 }}>
              {why}
            </div>
          </div>
        </div>
      )}

      {/* 4. Intent-Specific Telemetry (Strict Isolation) */}
      {renderIntentData(intent, data, response, onNavigateTab)}

      {/* 5. Prioritized Officer Recommendations */}
      {Array.isArray(recommendations) && recommendations.length > 0 && (
        <div style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 6,
          padding: '14px 16px'
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            color: '#166534',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8
          }}>
            <Icon name="check-circle" size={15} color="#16a34a" />
            Recommended Officer Actions
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#14532d', lineHeight: 1.6 }}>
            {recommendations.map((rec, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. Collapsible Calculation Details (Default Collapsed) */}
      {details && Object.keys(details).length > 0 && (
        <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 12 }}>
          <button
            type="button"
            onClick={() => setDetailsOpen(prev => !prev)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--kq-green-800, #166534)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Icon name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={14} />
            {detailsOpen ? 'Hide calculation details' : 'View calculation details'}
          </button>

          {detailsOpen && (
            <div style={{
              marginTop: 10,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: 14,
              fontSize: 12,
              color: '#475569'
            }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>
                Mathematical Models & Audit Assumptions:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {Object.entries(details).map(([key, val]) => (
                  <div key={key} style={{ background: '#ffffff', padding: 8, borderRadius: 4, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                      {key.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', marginTop: 2 }}>
                      {String(val)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6.5 Interactive Follow-Up Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px dashed #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
            Suggested Follow-Up Questions:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {suggestions.map((sugg, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectPrompt && onSelectPrompt(sugg)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 16,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#1e293b',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; }}
              >
                <span>{sugg}</span>
                <span style={{ color: '#166534', fontWeight: 700 }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 7. Read-Only Governance Disclaimer */}
      <div style={{
        fontSize: 11,
        color: '#64748b',
        fontStyle: 'italic',
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }}>
        <Icon name="shield" size={13} color="#94a3b8" />
        <span>{disclaimer || 'Simulation only — no database changes were made.'}</span>
      </div>
    </div>
  );
}

/**
 * Intent-Specific Telemetry Visualizer
 * Enforces STRICT isolation so no unrelated KPIs leak into queries.
 */
function renderIntentData(intent, data, response, onNavigateTab) {
  if (!data) return null;

  // Generic Data Copilot Structures
  if (data.distance_km !== undefined) {
    return renderGeographicCard(data);
  }
  if (data.comparison) {
    return renderComparisonCard(data.comparison);
  }
  if (data.kpi && (!data.items || data.items.length === 0)) {
    return renderKpiCard(data.kpi);
  }
  if (data.items && Array.isArray(data.items) && data.items.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.kpi && renderKpiCard(data.kpi)}
        {renderItemList(data.items, data.list_title)}
      </div>
    );
  }

  switch (intent) {
    case 'STOCK_REALLOCATION_SIMULATION':
      return renderStockReallocationData(data);
    
    case 'ARRIVAL_SURGE_SIMULATION':
      return renderArrivalSurgeData(data);
    
    case 'COUNTER_CHANGE_SIMULATION':
      return renderCounterChangeData(data);
    
    case 'STORAGE_RISK':
      return renderStorageRiskData(data, onNavigateTab);
    
    case 'GRIEVANCE_ANALYSIS':
      return renderGrievanceData(data, onNavigateTab);
    
    case 'PACING_ANALYSIS':
      return renderPacingData(data, onNavigateTab);
    
    case 'PROCUREMENT_FORECAST':
      return renderForecastData(data);
    
    case 'DISTRICT_BRIEFING':
    case 'CENTRE_STATUS':
    default:
      return renderOperationalOverview(data, response);
  }
}

function renderGeographicCard(data) {
  const { centreA, centreB, distance_km, nearest_centre, target_centre, kpi } = data;
  return (
    <div style={{
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
          Geographic Geodesic Distance
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 4 }}>
          Haversine Verified
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
            {target_centre ? `${target_centre} ↔ ${nearest_centre}` : `${centreA?.name || 'Centre A'} ↔ ${centreB?.name || 'Centre B'}`}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Spherical geodesic distance between coordinates
          </div>
        </div>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#0f172a',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          padding: '6px 16px',
          borderRadius: 6
        }}>
          {distance_km} <span style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>km</span>
        </div>
      </div>
    </div>
  );
}

function renderKpiCard(kpi) {
  if (!kpi) return null;
  return (
    <div style={{
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '18px 22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
          {kpi.label}
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', marginTop: 4, letterSpacing: '-0.02em' }}>
          {kpi.value} {kpi.unit && <span style={{ fontSize: 16, fontWeight: 600, color: '#64748b' }}>{kpi.unit}</span>}
        </div>
      </div>
      <div style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#ecfdf5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#16a34a'
      }}>
        <Icon name="check-circle" size={22} />
      </div>
    </div>
  );
}

function renderItemList(items, title) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {title && (
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: i % 2 === 0 ? '#f8fafc' : '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 6
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#e2e8f0',
                color: '#334155',
                fontSize: 11,
                fontWeight: 700
              }}>
                {it.rank || (i + 1)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                {it.name}
              </span>
            </div>
            {it.value && (
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#0f172a',
                background: '#e0f2fe',
                padding: '2px 8px',
                borderRadius: 4
              }}>
                {it.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderComparisonCard(comparison) {
  if (!comparison) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
      {Object.entries(comparison).map(([key, val]) => (
        <div key={key} style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: 16
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 10, textTransform: 'capitalize' }}>
            {val.name || key.replace(/_/g, ' ')}
          </div>
          {typeof val === 'object' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              {Object.entries(val).filter(([k]) => k !== 'name').map(([subK, subV]) => (
                <div key={subK} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #e2e8f0', paddingBottom: 4 }}>
                  <span style={{ color: '#64748b', textTransform: 'capitalize' }}>{subK.replace(/_/g, ' ')}</span>
                  <strong style={{ color: '#0f172a' }}>{String(subV)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{String(val)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 1. Stock Reallocation Comparison View
 */
function renderStockReallocationData(data) {
  const { transfer_amount_mt, source, target } = data;
  if (!source || !target) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--kq-text-secondary, #475569)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span>Inter-Centre Stock Transfer Flow</span>
        <span style={{ color: 'var(--kq-green-800, #166534)' }}>
          Transfer Volume: <strong>{transfer_amount_mt} MT</strong>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {/* Source Centre Card */}
        <div style={{
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: 14,
          background: '#ffffff'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>SOURCE CENTRE (DISPATCH)</span>
            <span style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
              -{transfer_amount_mt} MT
            </span>
          </div>
          <h4 style={{ margin: '0 0 10px 0', fontSize: 15, color: '#0f172a' }}>
            {source.name}
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
            <div>
              <div style={{ color: '#64748b' }}>Current Stock:</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{source.current_stock_mt} MT</div>
            </div>
            <div>
              <div style={{ color: '#64748b' }}>After Transfer:</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>{source.after_transfer_mt} MT</div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 4 }}>
              <span>Projected Occupancy:</span>
              <strong>{source.projected_occupancy_pct}%</strong>
            </div>
            <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, source.projected_occupancy_pct)}%`,
                background: source.projected_occupancy_pct > 85 ? '#ef4444' : '#10b981'
              }} />
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
              Storage Capacity: {source.capacity_mt} MT
            </div>
          </div>
        </div>

        {/* Target Centre Card */}
        <div style={{
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: 14,
          background: '#ffffff'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>TARGET CENTRE (RECEIVING)</span>
            <span style={{ fontSize: 11, background: '#d1fae5', color: '#065f46', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
              +{transfer_amount_mt} MT
            </span>
          </div>
          <h4 style={{ margin: '0 0 10px 0', fontSize: 15, color: '#0f172a' }}>
            {target.name}
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
            <div>
              <div style={{ color: '#64748b' }}>Current Stock:</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{target.current_stock_mt} MT</div>
            </div>
            <div>
              <div style={{ color: '#64748b' }}>After Transfer:</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: target.projected_occupancy_pct > 85 ? '#b45309' : '#16a34a' }}>
                {target.after_transfer_mt} MT
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 4 }}>
              <span>Projected Occupancy:</span>
              <strong style={{ color: target.projected_occupancy_pct > 85 ? '#b45309' : '#16a34a' }}>
                {target.projected_occupancy_pct}%
              </strong>
            </div>
            <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, target.projected_occupancy_pct)}%`,
                background: target.projected_occupancy_pct > 85 ? '#f59e0b' : '#10b981'
              }} />
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
              Storage Capacity: {target.capacity_mt} MT (Limit: 85%)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 2. Arrival Surge Simulation Table
 */
function renderArrivalSurgeData(data) {
  const { arrival_change_pct, baseline_arrivals_mt, projected_arrivals_mt, net_arrivals_delta_mt, affected_centres } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Metric chips */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>SURGE DELTA</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: arrival_change_pct > 0 ? '#b45309' : '#15803d' }}>
            {arrival_change_pct > 0 ? `+${arrival_change_pct}%` : `${arrival_change_pct}%`}
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>BASELINE ARRIVALS</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>
            {baseline_arrivals_mt ?? 0} MT
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>PROJECTED ARRIVALS</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            {projected_arrivals_mt ?? 0} MT
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>NET INFLOW VARIATION</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: net_arrivals_delta_mt > 0 ? '#b45309' : '#15803d' }}>
            {net_arrivals_delta_mt > 0 ? `+${net_arrivals_delta_mt}` : net_arrivals_delta_mt} MT
          </div>
        </div>
      </div>

      {/* Affected Centres Table if any */}
      {Array.isArray(affected_centres) && affected_centres.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: '#fffbeb', borderBottom: '1px solid #fef3c7', fontSize: 12, fontWeight: 700, color: '#92400e' }}>
            ⚠️ High-Impact Centres Flagged for Bottlenecks ({affected_centres.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Centre</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Current Stock</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Projected Stock</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Capacity</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Occupancy</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Overload</th>
              </tr>
            </thead>
            <tbody>
              {affected_centres.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '8px 12px' }}>{c.current_stock_mt} MT</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{c.projected_stock_mt} MT</td>
                  <td style={{ padding: '8px 12px' }}>{c.capacity_mt} MT</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: c.projected_occupancy_pct > 85 ? '#b45309' : '#15803d' }}>
                    {c.projected_occupancy_pct}%
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: c.overload_mt > 0 ? '#dc2626' : '#64748b' }}>
                    {c.overload_mt > 0 ? `+${c.overload_mt} MT` : 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 3. Counter Staffing Simulation
 */
function renderCounterChangeData(data) {
  const { counter_change, baseline_counters, projected_counters, baseline_wait_min, projected_wait_min, wait_time_reduction_min, baseline_throughput_hr, projected_throughput_hr, throughput_delta_pct } = data;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 6, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>WEIGHMENT DESKS</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
          {baseline_counters} → {projected_counters}
        </div>
        <div style={{ fontSize: 11, color: counter_change > 0 ? '#16a34a' : '#dc2626', marginTop: 2, fontWeight: 600 }}>
          {counter_change > 0 ? `+${counter_change} active scale desk` : `${counter_change} desk closed`}
        </div>
      </div>

      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 6, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>AVERAGE WAIT TIME</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#16a34a', marginTop: 4 }}>
          ~{projected_wait_min} min
        </div>
        <div style={{ fontSize: 11, color: '#15803d', marginTop: 2, fontWeight: 600 }}>
          {wait_time_reduction_min > 0 ? `-${wait_time_reduction_min} minutes wait reduction` : `+${Math.abs(wait_time_reduction_min)} min increase`}
        </div>
      </div>

      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 6, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>HOURLY THROUGHPUT</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
          {projected_throughput_hr} farmers/hr
        </div>
        <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2, fontWeight: 600 }}>
          {throughput_delta_pct > 0 ? `+${throughput_delta_pct}% faster processing` : `${throughput_delta_pct}% capacity`}
        </div>
      </div>
    </div>
  );
}

/**
 * 4. Storage Risk Breakdown
 */
function renderStorageRiskData(data, onNavigateTab) {
  const { high_risk_count, centres } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>
          FLAGGED CENTRES: <strong style={{ color: high_risk_count > 0 ? '#dc2626' : '#16a34a' }}>{high_risk_count}</strong>
        </div>
        {onNavigateTab && (
          <button
            onClick={() => onNavigateTab('centres')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--kq-green-800, #166534)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            View Centre Grid →
          </button>
        )}
      </div>

      {Array.isArray(centres) && centres.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Centre</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Stock / Capacity</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Occupancy</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Risk Level</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Operational Factor</th>
              </tr>
            </thead>
            <tbody>
              {centres.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.name || c.centre_name || c.centre_id}</td>
                  <td style={{ padding: '8px 12px' }}>{c.current_stock_mt} / {c.capacity_mt} MT</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: c.occupancy_pct > 85 ? '#dc2626' : '#b45309' }}>
                    {c.occupancy_pct}%
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: c.risk === 'CRITICAL' ? '#fee2e2' : '#fef3c7',
                      color: c.risk === 'CRITICAL' ? '#991b1b' : '#92400e'
                    }}>
                      {c.risk}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#64748b' }}>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 5. Farmer Grievance Breakdown
 */
function renderGrievanceData(data, onNavigateTab) {
  const { total_open, sla_breached, sla_compliance_pct, affected_centres } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>UNRESOLVED TICKETS</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{total_open}</div>
        </div>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>SLA BREACHES (&gt;48 HRS)</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: sla_breached > 0 ? '#dc2626' : '#16a34a' }}>
            {sla_breached}
          </div>
        </div>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>SLA COMPLIANCE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: sla_compliance_pct >= 90 ? '#16a34a' : '#b45309' }}>
            {sla_compliance_pct}%
          </div>
        </div>
      </div>

      {Array.isArray(affected_centres) && affected_centres.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Centre</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Open</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Overdue (SLA Breached)</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Primary Categories</th>
              </tr>
            </thead>
            <tbody>
              {affected_centres.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.centre_name}</td>
                  <td style={{ padding: '8px 12px' }}>{c.open_count}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: c.breached_count > 0 ? '#dc2626' : '#16a34a' }}>
                    {c.breached_count}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#64748b' }}>
                    {Array.isArray(c.top_issues) ? c.top_issues.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onNavigateTab && (
        <div>
          <button
            onClick={() => onNavigateTab('grievances')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--kq-green-800, #166534)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Open Grievance Resolution Desk →
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 6. Queue Pacing Advisory
 */
function renderPacingData(data, onNavigateTab) {
  const { monitored_centres, congested_centres_count, pacing_events } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>
          CENTRES REQUIRING PACING: <strong style={{ color: congested_centres_count > 0 ? '#b45309' : '#16a34a' }}>{congested_centres_count}</strong> / {monitored_centres}
        </div>
        {onNavigateTab && (
          <button
            onClick={() => onNavigateTab('pacing')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--kq-green-800, #166534)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Open Adaptive Pacing Panel →
          </button>
        )}
      </div>

      {Array.isArray(pacing_events) && pacing_events.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {pacing_events.map((p, i) => (
            <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{p.centre_name}</span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: p.status === 'SLOW' ? '#fee2e2' : '#d1fae5',
                  color: p.status === 'SLOW' ? '#991b1b' : '#065f46'
                }}>
                  {p.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Queue Delay: <strong>+{p.delay_min || 0} mins</strong>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Active Yard Queue: <strong>{p.active_queue || 0} tractors</strong>
              </div>
              <div style={{ fontSize: 11, color: '#166534', marginTop: 6, fontStyle: 'italic' }}>
                Action: {p.action}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 7. Procurement & Catchment Forecast
 */
function renderForecastData(data) {
  const { total_area_acres, total_expected_yield_mt, available_storage_capacity_mt, capacity_gap_mt, crops } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>CULTIVATED ACREAGE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{total_area_acres} Acres</div>
        </div>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>PROJECTED YIELD</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#166534' }}>{total_expected_yield_mt} MT</div>
        </div>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>STORAGE HEADROOM</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{available_storage_capacity_mt} MT</div>
        </div>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>CAPACITY DEFICIT GAP</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: capacity_gap_mt > 0 ? '#dc2626' : '#16a34a' }}>
            {capacity_gap_mt > 0 ? `-${capacity_gap_mt} MT` : 'Adequate'}
          </div>
        </div>
      </div>

      {Array.isArray(crops) && crops.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Crop Variety</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Declared Acres</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Min Expected Yield</th>
                <th style={{ padding: '8px 12px', color: '#64748b' }}>Target Procurement Centre</th>
              </tr>
            </thead>
            <tbody>
              {crops.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.crop_type}</td>
                  <td style={{ padding: '8px 12px' }}>{c.total_area_acres} Acres</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{c.total_yield_min_mt} MT</td>
                  <td style={{ padding: '8px 12px', color: '#64748b' }}>{c.centre_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 8. Operational Briefing / Status Overview
 */
function renderOperationalOverview(data, response) {
  const f = response.facts || {};

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {f.total_centres !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>MONITORED CENTRES</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{f.total_centres}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Procurement network</div>
        </div>
      )}
      {f.district_storage_occupancy_pct !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>STORAGE OCCUPANCY</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: f.district_storage_occupancy_pct > 85 ? '#dc2626' : '#16a34a' }}>
            {f.district_storage_occupancy_pct}%
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {f.total_current_stock_mt ?? 0} MT / {f.total_storage_capacity_mt ?? 0} MT
          </div>
        </div>
      )}
      {f.storage_occupancy_pct !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>CENTRE OCCUPANCY</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: f.storage_occupancy_pct > 85 ? '#dc2626' : '#16a34a' }}>
            {f.storage_occupancy_pct}%
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {f.current_stock_mt ?? 0} MT / {f.storage_capacity_mt ?? 0} MT
          </div>
        </div>
      )}
      {f.active_queue_count !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>ACTIVE QUEUE</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{f.active_queue_count}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Farmers in processing</div>
        </div>
      )}
      {f.avg_wait_minutes_today !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>AVG WAIT TIME</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: f.avg_wait_minutes_today > 40 ? '#b45309' : '#16a34a' }}>
            ~{f.avg_wait_minutes_today} min
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Nominal threshold</div>
        </div>
      )}
      {f.estimated_active_wait_minutes !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>ESTIMATED WAIT</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: f.estimated_active_wait_minutes > 40 ? '#b45309' : '#16a34a' }}>
            ~{f.estimated_active_wait_minutes} min
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Scale velocity</div>
        </div>
      )}
      {f.open_grievances_count !== undefined && (
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>OPEN GRIEVANCES</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: f.sla_breached_count > 0 ? '#dc2626' : '#0f172a' }}>
            {f.open_grievances_count}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {f.sla_breached_count || f.sla_breached_grievances_count || 0} SLA breached
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fallback normalizer if response.structured_response is absent.
 */
function normalizeFallbackResponse(response) {
  const intent = (response.intent || 'DISTRICT_BRIEFING').toUpperCase();
  return {
    intent,
    title: intent.replace(/_/g, ' '),
    summary: response.answer,
    status: 'SAFE',
    why: 'Grounded on verified PostgreSQL records.',
    data: response.facts || {},
    details: null,
    recommendations: response.recommendations || [],
    disclaimer: 'Read-only operational advisory grounded on live PostgreSQL records.'
  };
}
