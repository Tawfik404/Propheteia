import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { searchLocations, ApiError } from '../services/api';
import type { GeocodeResult } from '../types';

interface MapSearchBarProps {
  onSelect: (result: GeocodeResult) => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export default function MapSearchBar({ onSelect }: MapSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    },
    []
  );

  const runSearch = (trimmed: string, seq: number) => {
    debounceTimerRef.current = window.setTimeout(async () => {
      debounceTimerRef.current = null;
      try {
        const { results: found } = await searchLocations(trimmed);
        if (requestSeqRef.current !== seq) return;
        setResults(found);
        setActiveIndex(found.length > 0 ? 0 : -1);
        setOpen(true);
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        setResults([]);
        setError(err instanceof ApiError ? err.message : 'Search failed. Try again.');
        setOpen(true);
      } finally {
        if (requestSeqRef.current === seq) setLoading(false);
      }
    }, DEBOUNCE_MS);
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestSeqRef.current += 1;
      setResults([]);
      setOpen(false);
      setLoading(false);
      setError(null);
      setActiveIndex(-1);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    runSearch(trimmed, seq);
  };

  const handleSelect = (result: GeocodeResult) => {
    setOpen(false);
    setQuery(result.name);
    setResults([]);
    onSelect(result);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (event.key === 'Escape') setOpen(false);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
    }
  };

  const handleBlur = () => {
    blurTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className="map-search">
      <div className="map-search-input-wrap">
        <Search className="map-search-icon" size={16} aria-hidden="true" />
        <input
          className="map-search-input"
          type="search"
          value={query}
          placeholder="Search for a place…"
          aria-label="Search for a place"
          role="combobox"
          aria-expanded={open}
          aria-controls="map-search-list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `map-search-item-${activeIndex}` : undefined
          }
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => {
            if (results.length > 0 || error) setOpen(true);
          }}
        />
        {loading && (
          <Loader2 className="map-search-spinner" size={15} aria-hidden="true" />
        )}
      </div>

      {open && (
        <ul className="map-search-list" id="map-search-list" role="listbox">
          {loading && (
            <li className="map-search-status" role="status">
              Searching…
            </li>
          )}
          {!loading && error && (
            <li className="map-search-status map-search-error" role="alert">
              {error}
            </li>
          )}
          {!loading && !error && results.length === 0 && (
            <li className="map-search-status">No locations found.</li>
          )}
            {!loading &&
              !error &&
              results.map((result, index) => (
                <li key={result.id ?? `${result.latitude},${result.longitude}`}>
                  <button
                    type="button"
                    id={`map-search-item-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`map-search-item${index === activeIndex ? ' map-search-item-active' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(result);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                  <MapPin className="map-search-item-icon" size={14} aria-hidden="true" />
                  <span className="map-search-item-text">
                    <span className="map-search-item-name">{result.name}</span>
                    {result.formatted !== result.name && (
                      <span className="map-search-item-region">{result.formatted}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
