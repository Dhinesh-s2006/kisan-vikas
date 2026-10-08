import React from 'react';

export function FormField({
  label,
  id,
  required = false,
  helpText,
  error,
  children,
  className = '',
  style = {}
}) {
  const errorId = id && error ? `${id}-error` : undefined;
  const helpId = id && helpText ? `${id}-help` : undefined;

  return (
    <div className={`kq-form-field ${className}`} style={{ marginBottom: 16, ...style }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            display: 'block',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--kq-text-primary)',
            marginBottom: 6
          }}
        >
          {label}
          {required && (
            <span style={{ color: 'var(--kq-danger-btn)', marginLeft: 4 }} aria-hidden="true">*</span>
          )}
        </label>
      )}

      <div>
        {React.Children.map(children, child => {
          if (!React.isValidElement(child)) return child;
          return React.cloneElement(child, {
            id: child.props.id || id,
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': [errorId, helpId].filter(Boolean).join(' ') || undefined,
            className: `${child.props.className || ''} ${error ? 'kq-input-error' : ''}`.trim()
          });
        })}
      </div>

      {helpText && !error && (
        <div id={helpId} className="kq-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          {helpText}
        </div>
      )}

      {error && (
        <div id={errorId} style={{ color: 'var(--kq-danger-text)', fontSize: 12, fontWeight: 500, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function FormSection({ title, description, children, className = '', style = {} }) {
  return (
    <div className={`kq-form-section ${className}`} style={{ marginBottom: 24, ...style }}>
      {(title || description) && (
        <div style={{ marginBottom: 14, borderBottom: '1px solid var(--kq-border-subtle)', paddingBottom: 8 }}>
          {title && (
            <h4 style={{ fontSize: 16, fontWeight: 600, color: 'var(--kq-text-primary)', margin: '0 0 2px 0' }}>
              {title}
            </h4>
          )}
          {description && (
            <p className="kq-text-muted" style={{ fontSize: 13, margin: 0 }}>
              {description}
            </p>
          )}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}
