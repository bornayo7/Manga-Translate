import React, { useEffect, useRef, useState } from "react";

export default function RichSelect({
  id,
  label,
  value,
  options,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = `${id}-listbox`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedNode = optionRefs.current[selectedIndex];
    selectedNode?.focus();
  }, [open, selectedIndex]);

  function handleTriggerKeyDown(event) {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleOptionKeyDown(event, index) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionRefs.current[(index + 1) % options.length]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      optionRefs.current[(index - 1 + options.length) % options.length]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const nextOption = options[index];
      onChange(nextOption.id);
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function handleSelect(optionId) {
    onChange(optionId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className={`form-group rich-select-root ${open ? "is-open" : ""}`}
      ref={rootRef}
    >
      <label className="form-label" htmlFor={id}>
        {label}
      </label>

      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={`rich-select-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <div className="rich-select-trigger-content">
          <span className="rich-select-trigger-title">{selectedOption?.name}</span>
          <div className="choice-badges rich-select-badges">
            {(selectedOption?.badges || []).map((badge) => (
              <span
                key={`${selectedOption.id}-${badge}`}
                className={`capability-badge capability-badge--${selectedOption.badgeVariant}`}
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
        <span className={`rich-select-chevron ${open ? "is-open" : ""}`} />
      </button>

      {open ? (
        <div
          id={listboxId}
          className="rich-select-menu"
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((option, index) => {
            const isSelected = option.id === selectedOption?.id;

            return (
              <button
                key={option.id}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`rich-select-option ${isSelected ? "is-selected" : ""}`}
                onClick={() => handleSelect(option.id)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <div className="rich-select-option-copy">
                  <div className="rich-select-option-header">
                    <span className="rich-select-option-title">{option.name}</span>
                    <div className="choice-badges rich-select-badges">
                      {(option.badges || []).map((badge) => (
                        <span
                          key={`${option.id}-${badge}`}
                          className={`capability-badge capability-badge--${option.badgeVariant}`}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
