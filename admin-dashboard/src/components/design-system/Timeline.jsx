import React from 'react';
import { Icon } from './Icons';

export const PROCUREMENT_STEPS = [
  { key: 'booking', label: 'Booking', icon: 'calendar', desc: 'Slot confirmed' },
  { key: 'arrival', label: 'Arrival', icon: 'truck', desc: 'Gate check-in' },
  { key: 'quality', label: 'Quality', icon: 'clipboard-check', desc: 'Moisture & grading' },
  { key: 'weighment', label: 'Weighment', icon: 'scale', desc: 'Net weighbridge' },
  { key: 'acceptance', label: 'Acceptance', icon: 'check-circle', desc: 'Procurement decision' },
  { key: 'receipt', label: 'Receipt', icon: 'file-text', desc: 'Digital pass issued' },
  { key: 'payment', label: 'Payment', icon: 'credit-card', desc: 'DBT disbursement' }
];

export function Timeline({
  currentStep = 'booking',
  steps = PROCUREMENT_STEPS,
  orientation = 'horizontal', // 'horizontal' or 'vertical'
  completedSteps = [],
  stepDetails = {},
  className = '',
  style = {}
}) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div
      className={`kq-timeline kq-timeline-${orientation} ${className}`}
      style={{
        display: 'flex',
        flexDirection: orientation === 'vertical' ? 'column' : 'row',
        alignItems: orientation === 'vertical' ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '16px 0',
        overflowX: orientation === 'horizontal' ? 'auto' : 'visible',
        WebkitOverflowScrolling: 'touch',
        ...style
      }}
    >
      {steps.map((step, idx) => {
        const isPast = completedSteps.includes(step.key) || (currentIndex >= 0 && idx < currentIndex);
        const isCurrent = step.key === currentStep || idx === currentIndex;
        const details = stepDetails[step.key];

        let stateColor = 'var(--kq-border-strong)';
        let stateBg = 'var(--kq-bg-subtle)';
        let textColor = 'var(--kq-text-muted)';
        let iconToUse = step.icon || 'circle';

        if (isPast) {
          stateColor = 'var(--kq-green-700)';
          stateBg = 'var(--kq-green-100)';
          textColor = 'var(--kq-green-800)';
          iconToUse = 'check';
        } else if (isCurrent) {
          stateColor = 'var(--kq-green-700)';
          stateBg = 'var(--kq-green-700)';
          textColor = '#ffffff';
        }

        return (
          <div
            key={step.key}
            style={{
              display: 'flex',
              flexDirection: orientation === 'vertical' ? 'row' : 'column',
              alignItems: 'center',
              position: 'relative',
              flex: 1,
              minWidth: orientation === 'horizontal' ? 100 : 'auto',
              gap: 8,
              textAlign: orientation === 'horizontal' ? 'center' : 'left'
            }}
          >
            {/* Horizontal connecting line before node */}
            {orientation === 'horizontal' && idx > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  right: '50%',
                  width: '100%',
                  height: 2,
                  backgroundColor: isPast ? 'var(--kq-green-600)' : 'var(--kq-border-medium)',
                  zIndex: 1
                }}
              />
            )}

            {/* Icon circle */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: stateBg,
                color: isCurrent ? '#ffffff' : isPast ? 'var(--kq-green-800)' : 'var(--kq-text-muted)',
                border: `2px solid ${isPast || isCurrent ? 'var(--kq-green-700)' : 'var(--kq-border-medium)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
                position: 'relative'
              }}
            >
              <Icon name={iconToUse} size={15} />
            </div>

            {/* Labels */}
            <div style={{ zIndex: 2 }}>
              <div style={{
                fontSize: 13,
                fontWeight: isCurrent ? 700 : isPast ? 600 : 500,
                color: isCurrent ? 'var(--kq-green-800)' : isPast ? 'var(--kq-text-primary)' : 'var(--kq-text-muted)'
              }}>
                {step.label}
              </div>
              {(details || step.desc) && (
                <div style={{ fontSize: 11, color: 'var(--kq-text-muted)', marginTop: 2 }}>
                  {details || step.desc}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
