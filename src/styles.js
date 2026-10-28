/**
 * Styles injected once by the client plugin. The `::highlight` rule is the
 * whole visual contract for progress: it paints unread prose blue without
 * touching React's DOM, and the controller simply shrinks the range as speech
 * advances.
 */
export const READ_ALOUD_CSS = `
::highlight(dsh-read-aloud-pending) {
  background-color: rgba(47, 111, 237, 0.28);
  color: inherit;
}

@media (forced-colors: active) {
  ::highlight(dsh-read-aloud-pending) {
    background-color: Highlight;
    color: HighlightText;
  }
}

.dsr-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.dsr-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsr-action:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, #2f6fed);
  outline-offset: 1px;
}

.dsr-action:disabled {
  cursor: default;
  opacity: 0.4;
}

.dsr-action[data-active="true"] {
  color: var(--dsw-alias-label-primary, #111827);
}

.dsr-action[data-speaking="true"] .dsr-wave {
  animation: dsr-wave 1.4s ease-in-out infinite;
}

.dsr-action[data-speaking="true"] .dsr-wave-1 {
  animation-delay: 0s;
}

.dsr-action[data-speaking="true"] .dsr-wave-2 {
  animation-delay: 0.18s;
}

@keyframes dsr-wave {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}

.dsr-icon {
  display: block;
  width: 16px;
  height: 16px;
}

.dsr-panel {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  width: 322px;
  max-width: calc(100vw - 24px);
  max-height: min(560px, calc(100vh - 24px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  animation: dsr-in 140ms ease-out;
}

@keyframes dsr-in {
  from { opacity: 0; transform: translateY(4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .dsr-panel { animation: none; }
  .dsr-action { transition: none; }
}

.dsr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.dsr-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dsr-title-icon {
  display: inline-flex;
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  cursor: pointer;
}

.dsr-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary, #111827);
}

.dsr-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-variant-numeric: tabular-nums;
}

.dsr-status-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dsr-dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #9ca3af);
}

.dsr-dot[data-live="true"] {
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.14);
}

.dsr-progress {
  height: 3px;
  margin-bottom: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127, 127, 127, 0.16));
}

.dsr-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  transition: width 220ms ease;
}

.dsr-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
}

.dsr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsr-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-btn:disabled {
  cursor: default;
  opacity: 0.42;
}

.dsr-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  color: #ffffff;
}

.dsr-btn-primary:hover {
  background: var(--dsw-alias-button-primary-hover, #245bcc);
}

.dsr-btn-icon {
  width: 30px;
  padding: 0;
}

.dsr-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 10px;
}

.dsr-label {
  flex: none;
  width: 32px;
  color: var(--dsw-alias-label-secondary, #4b5563);
}

.dsr-range {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-rate {
  flex: none;
  width: 42px;
  text-align: right;
  color: var(--dsw-alias-label-primary, #111827);
  font-variant-numeric: tabular-nums;
}

.dsr-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 7px 0 0 41px;
}

.dsr-chip {
  height: 23px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.dsr-chip:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127, 127, 127, 0.18));
}

.dsr-chip[data-current="true"] {
  border-color: var(--dsw-alias-button-primary-fill, #2f6fed);
  background: transparent;
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-voice-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
}

.dsr-select {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 12px;
}

.dsr-refresh {
  flex: none;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dsr-refresh:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-note {
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  font-size: 11px;
  line-height: 1.45;
}

.dsr-notice {
  color: var(--dsw-alias-button-primary-fill, #2f6fed);
}

.dsr-error {
  margin-top: 9px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(236, 19, 19, 0.07));
  color: var(--dsw-alias-state-error-primary, #c0392b);
  font-size: 11px;
  line-height: 1.45;
}

.dsr-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.dsr-menu {
  position: fixed;
  z-index: 2147483001;
  width: 158px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 13px;
  animation: dsr-in 100ms ease-out;
}

.dsr-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsr-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-menu-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
}

.dsr-mini {
  position: fixed;
  left: 50%;
  bottom: calc(var(--dsh-composer-height, 152px) + 16px);
  z-index: 2147483001;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 7px 8px 7px 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
  color: var(--dsw-alias-label-primary, #111827);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2), 0 1px 4px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 12px;
  transform: translateX(-50%);
  animation: dsr-in 140ms ease-out;
}

.dsr-mini-title {
  flex: none;
  font-weight: 600;
  white-space: nowrap;
}

.dsr-mini-status {
  max-width: 280px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #7a7f87);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsr-mini-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.dsr-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 27px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.dsr-mini-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
}

.dsr-mini-btn:disabled {
  cursor: default;
  opacity: 0.45;
}

.dsr-mini-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #2f6fed);
  color: #ffffff;
}

.dsr-mini-primary:hover {
  background: var(--dsw-alias-button-primary-hover, #245bcc);
}

.dsr-mini-rate {
  font-variant-numeric: tabular-nums;
}
`
