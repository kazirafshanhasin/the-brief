"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, LANGUAGES, TOPICS, countryName, type TopicId } from "@brief/core";

export function TopicChips({ value, onChange }: { value: TopicId[]; onChange: (v: TopicId[]) => void }) {
  return (
    <ul className="chips">
      {TOPICS.map((t) => {
        const on = value.includes(t.id);
        return (
          <li key={t.id}>
            <button
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            >
              {t.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CountryPicker({ value, onChange, max = 30 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) : COUNTRIES;
    // Selected countries first, so they're easy to remove.
    return [...matches.filter((c) => value.includes(c.code)), ...matches.filter((c) => !value.includes(c.code))];
  }, [query, value]);

  return (
    <div>
      <input
        className="input"
        type="search"
        placeholder="Search countries"
        aria-label="Search countries"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="selected-line" aria-live="polite">
        {value.length === 0 ? "No countries chosen — you'll get worldwide news." : `Following ${value.map(countryName).join(", ")}.`}
      </p>
      <ul className="country-list">
        {list.map((c) => {
          const on = value.includes(c.code);
          return (
            <li key={c.code}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && value.length >= max}
                  onChange={() => onChange(on ? value.filter((x) => x !== c.code) : [...value, c.code])}
                />
                {c.name}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Reading language">
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native === l.name ? l.name : `${l.native} — ${l.name}`}
        </option>
      ))}
    </select>
  );
}
