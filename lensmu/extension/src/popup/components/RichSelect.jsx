import React from 'react';

// Native selection owns keyboard, focus and assistive-technology behavior. The
// selected engine's explanation stays beside it instead of inside a fake listbox.
export default function RichSelect({ id, label, value, options, onChange }) {
  const selected = options.find((option) => option.id === value);
  return <div className="form-group">
    <label className="form-label" htmlFor={id}>{label}</label>
    <select id={id} className="form-select" value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-description`}>
      {!selected && value ? <option value={value}>{value} (saved option)</option> : null}
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    <p id={`${id}-description`} className="form-hint">{selected?.description || 'Choose a supported option.'}</p>
  </div>;
}
