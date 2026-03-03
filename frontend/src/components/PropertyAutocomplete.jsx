import { useState, useEffect, useRef } from 'react';
import api from '../api/axios';

/**
 * PropertyAutocomplete — Search and select from available properties.
 *
 * Props:
 *   onSelect(name, propertyId, isSelected, hasSuggestions) — callback
 *   placeholder — input placeholder
 *   initialValue — initial text
 *   strictMode — if true, user MUST select a property (no manual typing allowed)
 */
export default function PropertyAutocomplete({
    onSelect,
    placeholder = 'Search property...',
    initialValue = '',
    strictMode = false
}) {
    const [query, setQuery] = useState(initialValue || '');
    const [properties, setProperties] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isPropertySelected, setIsPropertySelected] = useState(false);
    const containerRef = useRef(null);

    // Fetch available properties on mount
    useEffect(() => {
        const fetchProperties = async () => {
            try {
                const res = await api.get('/properties?available=1');
                const data = res.data;
                if (Array.isArray(data)) setProperties(data);
                else if (data && Array.isArray(data.properties)) setProperties(data.properties);
                else setProperties([]);
            } catch (err) {
                console.error('Failed to fetch properties:', err);
                setProperties([]);
            }
        };
        fetchProperties();
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Parse extra_details JSON safely
    const parseExtra = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return {}; }
    };

    // Safe filter
    const getFiltered = () => {
        if (!Array.isArray(properties) || properties.length === 0) return [];
        if (!query || query.trim().length < 2) return properties.slice(0, 8); // Show all in strict mode
        const searchTerm = query.toLowerCase().trim();
        return properties.filter(p => {
            if (!p || typeof p !== 'object') return false;
            const name = (p.property_name || '').toLowerCase();
            const city = (p.city || '').toLowerCase();
            const type = (p.property_type || '').toLowerCase();
            return name.includes(searchTerm) || city.includes(searchTerm) || type.includes(searchTerm);
        }).slice(0, 8);
    };

    const filtered = getFiltered();
    const hasSuggestions = filtered.length > 0;

    const handleChange = (e) => {
        const val = e.target.value || '';

        // In strict mode, if user already selected, clear and start fresh
        if (strictMode && isPropertySelected) {
            setQuery('');
            setIsPropertySelected(false);
            setShowDropdown(true);
            if (onSelect) onSelect('', null, false, hasSuggestions);
            return;
        }

        setQuery(val);
        setIsPropertySelected(false);
        setShowDropdown(val.trim().length >= 1 || strictMode);

        if (onSelect) {
            const suggestionsExist = Array.isArray(properties) && properties.length > 0;
            onSelect(val, null, false, suggestionsExist);
        }
    };

    const handleSelect = (property) => {
        if (!property) return;
        const name = property.property_name || '';
        setQuery(name);
        setIsPropertySelected(true);
        setShowDropdown(false);
        if (onSelect) onSelect(name, property.id || null, true, true);
    };

    const handleFocus = () => {
        if (strictMode && !isPropertySelected) {
            setShowDropdown(true);
        } else if (query.trim().length >= 2) {
            setShowDropdown(true);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') setShowDropdown(false);
        // In strict mode, prevent typing if already selected
        if (strictMode && isPropertySelected && e.key !== 'Backspace' && e.key !== 'Delete') {
            // Allow backspace to clear, block other keys
        }
    };

    const handleClear = () => {
        setQuery('');
        setIsPropertySelected(false);
        setShowDropdown(true);
        if (onSelect) onSelect('', null, false, hasSuggestions);
    };

    const formatLakhs = (price) => {
        if (!price || isNaN(price)) return '0.00';
        return (price / 100000).toFixed(2);
    };

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                <input
                    type="text"
                    className={`input-field ${isPropertySelected ? 'bg-green-50 border-green-300 pr-10' : ''} ${strictMode && !isPropertySelected ? 'border-blue-300' : ''}`}
                    value={query}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onKeyDown={handleKeyDown}
                    placeholder={strictMode ? '🔍 Click to search available properties...' : placeholder}
                    autoComplete="off"
                    readOnly={strictMode && isPropertySelected}
                />
                {/* Selected checkmark or clear button */}
                {isPropertySelected && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 hover:text-red-500 transition-colors text-lg"
                        title="Clear selection"
                    >
                        ✕
                    </button>
                )}
            </div>

            {strictMode && !isPropertySelected && (
                <p className="text-xs text-blue-500 mt-1">⚠️ You must select a property from the list below.</p>
            )}

            {showDropdown && filtered.length > 0 && (
                <div className="absolute w-full bg-white rounded-xl shadow-card-hover border border-gray-100 z-50 max-h-56 overflow-y-auto mt-1">
                    {filtered.map((p, index) => {
                        if (!p || !p.id) return null;
                        const name = p.property_name || 'Unknown';
                        const type = p.property_type || '';
                        const city = p.city || '';
                        const price = formatLakhs(p.price_inr);
                        const extra = parseExtra(p.extra_details);
                        const bhk = extra.bhk || extra.configuration || '';
                        const sizeSqft = extra.size_sqft || p.size_sqft || '';

                        return (
                            <div
                                key={p.id || index}
                                onClick={() => handleSelect(p)}
                                className={`px-4 py-3 hover:bg-surface cursor-pointer text-sm border-b border-gray-50 last:border-0 flex flex-col gap-0.5
                                    ${isPropertySelected && query === name ? 'bg-accent/10' : ''}`}
                            >
                                <span className="font-semibold text-gray-800">{name}</span>
                                <span className="text-xs text-gray-400">
                                    {[type, city, bhk ? `${bhk} BHK` : '', sizeSqft ? `${sizeSqft} sq.ft` : '', price ? `₹${price} Lakhs` : ''].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {showDropdown && filtered.length === 0 && query.trim().length >= 2 && (
                <div className="absolute w-full bg-white rounded-xl shadow-card-hover border border-gray-100 z-50 mt-1 px-4 py-3 text-sm text-gray-400">
                    No matching properties found.
                </div>
            )}
        </div>
    );
}
