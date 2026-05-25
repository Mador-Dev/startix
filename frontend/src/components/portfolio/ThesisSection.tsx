import { useState } from "react";
import { Pencil, X } from "lucide-react";
import type { PositionGuidance, PositionGuidanceHorizon } from "../../types/api";

interface Props {
  ticker: string;
  guidance: PositionGuidance | undefined;
  onUpdate: (ticker: string, patch: Partial<PositionGuidance>) => Promise<void>;
}

const HORIZONS: { value: PositionGuidanceHorizon; label: string }[] = [
  { value: "unspecified", label: "Unspecified" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-surface)",
  border: "0.5px solid var(--bg-border-mid)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  fontSize: "var(--text-sm)",
  color: "var(--text-primary)",
  outline: "none",
  fontWeight: "var(--weight-regular)",
  resize: "vertical" as const,
};

export function ThesisSection({ ticker, guidance, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thesis, setThesis] = useState("");
  const [horizon, setHorizon] = useState<PositionGuidanceHorizon>("unspecified");
  const [addOn, setAddOn] = useState("");
  const [reduceOn, setReduceOn] = useState("");
  const [notes, setNotes] = useState("");

  const hasContent = !!(
    guidance?.thesis?.trim() ||
    guidance?.addOn?.trim() ||
    guidance?.reduceOn?.trim() ||
    guidance?.notes?.trim()
  );

  const startEditing = () => {
    setThesis(guidance?.thesis ?? "");
    setHorizon(guidance?.horizon ?? "unspecified");
    setAddOn(guidance?.addOn ?? "");
    setReduceOn(guidance?.reduceOn ?? "");
    setNotes(guidance?.notes ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(ticker, {
        thesis: thesis.trim(),
        horizon,
        addOn: addOn.trim(),
        reduceOn: reduceOn.trim(),
        notes: notes.trim(),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        margin: "0 16px 16px",
        padding: "12px",
        borderRadius: "var(--radius-md)",
        background: "rgba(99,102,241,0.06)",
        border: "0.5px solid rgba(99,102,241,0.20)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.10em",
            color: "rgba(99,102,241,0.8)",
          }}
        >
          Your thesis
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "0.5px solid rgba(99,102,241,0.30)",
              borderRadius: "var(--radius-sm)",
              padding: "2px 8px",
              fontSize: "var(--text-2xs)",
              color: "rgba(99,102,241,0.8)",
              cursor: "pointer",
            }}
          >
            <Pencil size={10} />
            {hasContent ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {/* Display mode */}
      {!editing && (
        <>
          {guidance?.thesis ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5, margin: 0 }}>
              {guidance.thesis}
            </p>
          ) : (
            <p
              style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", lineHeight: 1.5, margin: 0, fontStyle: "italic" }}
            >
              Why did you buy this? Add your reasoning.
            </p>
          )}
          {guidance?.horizon && guidance.horizon !== "unspecified" && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              Horizon: <strong style={{ color: "var(--text-secondary)" }}>{guidance.horizon}</strong>
            </p>
          )}
          {guidance?.addOn && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              Add more if:{" "}
              <span style={{ color: "var(--text-secondary)" }}>{guidance.addOn}</span>
            </p>
          )}
          {guidance?.reduceOn && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              Exit if:{" "}
              <span style={{ color: "var(--text-secondary)" }}>{guidance.reduceOn}</span>
            </p>
          )}
          {guidance?.notes && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>
              Notes:{" "}
              <span style={{ color: "var(--text-secondary)" }}>{guidance.notes}</span>
            </p>
          )}
        </>
      )}

      {/* Edit mode */}
      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Why do you own it?
            </div>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Brief thesis — what's your investment case?"
              maxLength={400}
              rows={3}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Horizon
              </div>
              <select
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as PositionGuidanceHorizon)}
                style={{ ...inputStyle, resize: "none" }}
              >
                {HORIZONS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Add more if
              </div>
              <input
                value={addOn}
                onChange={(e) => setAddOn(e.target.value)}
                placeholder="e.g. earnings beat"
                maxLength={300}
                style={{ ...inputStyle, resize: "none" }}
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Exit if
            </div>
            <input
              value={reduceOn}
              onChange={(e) => setReduceOn(e.target.value)}
              placeholder="e.g. margin compression confirmed"
              maxLength={300}
              style={{ ...inputStyle, resize: "none" }}
            />
          </div>

          <div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Notes / Decision log
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you decide? Any context to remember..."
              maxLength={600}
              rows={2}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(99,102,241,0.15)",
                border: "0.5px solid rgba(99,102,241,0.30)",
                color: "rgba(99,102,241,0.9)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-bold)",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save thesis"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                border: "0.5px solid var(--bg-border)",
                color: "var(--text-tertiary)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
