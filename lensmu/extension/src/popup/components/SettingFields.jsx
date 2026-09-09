import React from "react";
import { clampNumber } from "../../../shared/preferences.js";

export function ToggleRow({
  label,
  description,
  checked,
  onToggle,
  badge,
  disabled = false,
}) {
  return (
    <div className={`toggle-row ${disabled ? "is-disabled" : ""}`}>
      <div className="toggle-copy">
        <div className="toggle-title-row">
          <span className="toggle-label">{label}</span>
          {badge ? <span className="mini-badge">{badge}</span> : null}
        </div>
        {description ? <p className="toggle-description">{description}</p> : null}
      </div>

      <button
        type="button"
        className={`toggle-control ${checked ? "is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

/*
 * A number input that commits only a complete, in-range value, and only
 * when the user is done with it (blur or Enter).
 *
 * Binding <input type="number"> straight to settings meant that clearing
 * the field to retype it stored Number("") === 0, the 180 ms autosave
 * shipped that 0 to every active tab, and content.js promptly decorated
 * every 1px tracking pixel on the page with a translate icon - icons that
 * stayed once the real value was typed. The input is uncontrolled while it
 * has focus; on blur the text is parsed and clamped, an empty or unparseable
 * field reverts, and an unchanged value does not trigger a save. The key
 * remounts the input whenever the committed value changes from outside.
 */
export function NumberField({ id, label, value, min, max, onCommit }) {
  function commit(input) {
    const raw = input.value.trim();
    const parsed = Number(raw);

    if (raw === "" || !Number.isFinite(parsed)) {
      input.value = String(value);
      return;
    }

    const committed = Math.round(clampNumber(parsed, min, max, value));
    input.value = String(committed);
    if (committed !== value) {
      onCommit(committed);
    }
  }

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input
        key={value}
        id={id}
        className="form-input"
        type="number"
        min={min}
        max={max}
        step="1"
        defaultValue={value}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
