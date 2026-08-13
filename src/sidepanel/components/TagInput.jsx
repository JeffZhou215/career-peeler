import { useRef, useState } from "react";
import { TECH_KEYWORD_SUGGESTIONS, normalizeNoMatchKeywords } from "../lib/profile";

// Controlled tag input for the "No-matching keywords" field -- value is the current keyword array,
// onChange is called with the new array on every add/remove. Ports the old sidepanel.js's
// noMatchKeywords* functions (suggestion filtering, keyboard nav, add/remove) into one component.
export function TagInput({ value, onChange, inputId }) {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);

  function computeSuggestions(query) {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return [];
    }

    const selected = new Set(value.map((keyword) => keyword.toLowerCase()));
    return TECH_KEYWORD_SUGGESTIONS.filter(
      (term) => !selected.has(term.toLowerCase()) && term.toLowerCase().includes(normalizedQuery)
    ).slice(0, 8);
  }

  function addKeyword(rawValue) {
    const term = String(rawValue || "").trim();
    if (term) {
      onChange(normalizeNoMatchKeywords([...value, term]));
    }
  }

  function removeKeyword(keyword) {
    const key = keyword.toLowerCase();
    onChange(value.filter((item) => item.toLowerCase() !== key));
  }

  function resetSuggestions() {
    setSuggestions([]);
    setActiveIndex(-1);
  }

  function commitInput() {
    const chosen = activeIndex >= 0 && suggestions[activeIndex] ? suggestions[activeIndex] : inputValue;
    addKeyword(chosen);
    setInputValue("");
    resetSuggestions();
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length) {
        setActiveIndex((activeIndex + 1) % suggestions.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length) {
        setActiveIndex((activeIndex - 1 + suggestions.length) % suggestions.length);
      }
      return;
    }

    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitInput();
      return;
    }

    if (event.key === "Backspace" && !inputValue && value.length) {
      removeKeyword(value[value.length - 1]);
      return;
    }

    if (event.key === "Escape") {
      resetSuggestions();
    }
  }

  return (
    <div className="tag-field">
      <div className="tag-list">
        {value.map((keyword) => (
          <span className="tag-chip" key={keyword}>
            <span>{keyword}</span>
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove ${keyword}`}
              onClick={() => removeKeyword(keyword)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        className="tag-input"
        placeholder="Type to search or add a keyword"
        autoComplete="off"
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.target.value);
          setSuggestions(computeSuggestions(event.target.value));
          setActiveIndex(-1);
        }}
        onFocus={() => setSuggestions(computeSuggestions(inputValue))}
        onBlur={() => setTimeout(resetSuggestions, 100)}
        onKeyDown={handleKeyDown}
      />
      <ul className={`tag-suggestions${suggestions.length ? "" : " hidden"}`}>
        {suggestions.map((term, index) => (
          <li
            key={term}
            className={index === activeIndex ? "active" : ""}
            onMouseDown={(event) => {
              event.preventDefault();
              addKeyword(term);
              setInputValue("");
              resetSuggestions();
              inputRef.current?.focus();
            }}
          >
            {term}
          </li>
        ))}
      </ul>
    </div>
  );
}
