import React from 'react';
import { Icon } from './Icons';

export function Stepper({ steps = [], currentStep = 1, onStepClick, className = '', style = {} }) {
  return (
    <div
      className={`kq-stepper ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '12px 0 20px 0',
        position: 'relative',
        ...style
      }}
    >
      {steps.map((step, idx) => {
        const stepNum = idx + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;

        return (
          <div
            key={step.id || stepNum}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              position: 'relative',
              cursor: isCompleted && onStepClick ? 'pointer' : 'default'
            }}
            onClick={() => isCompleted && onStepClick && onStepClick(stepNum)}
          >
            {/* Connecting line */}
            {idx > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  right: '50%',
                  width: '100%',
                  height: 2,
                  backgroundColor: isCompleted || isCurrent ? 'var(--kq-green-600)' : 'var(--kq-border-medium)',
                  zIndex: 1
                }}
              />
            )}

            {/* Step badge */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: isCompleted
                  ? 'var(--kq-green-700)'
                  : isCurrent
                  ? '#ffffff'
                  : 'var(--kq-bg-subtle)',
                color: isCompleted
                  ? '#ffffff'
                  : isCurrent
                  ? 'var(--kq-green-800)'
                  : 'var(--kq-text-muted)',
                border: `2px solid ${isCompleted || isCurrent ? 'var(--kq-green-700)' : 'var(--kq-border-medium)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                zIndex: 2,
                position: 'relative'
              }}
            >
              {isCompleted ? <Icon name="check" size={14} /> : stepNum}
            </div>

            {/* Step label */}
            <div style={{
              fontSize: 12.5,
              fontWeight: isCurrent ? 700 : isCompleted ? 600 : 500,
              color: isCurrent ? 'var(--kq-green-800)' : isCompleted ? 'var(--kq-text-primary)' : 'var(--kq-text-muted)',
              marginTop: 6,
              textAlign: 'center',
              lineHeight: 1.2
            }}>
              {step.title || step}
            </div>
          </div>
        );
      })}
    </div>
  );
}
