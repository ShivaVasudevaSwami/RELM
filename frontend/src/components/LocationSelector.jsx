import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
    'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
    'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir',
    'Ladakh', 'Puducherry', 'Chandigarh', 'Dadra and Nagar Haveli', 'Lakshadweep',
    'Andaman and Nicobar Islands'
];

/**
 * LocationSelector — FULLY CONTROLLED component.
 *
 * The parent owns the state/city/area values via props.
 * This component has NO internal state for those values — it only
 * manages the fetched cities list and loading status internally.
 *
 * Props:
 *   selectedState  — current state value (from parent form state)
 *   selectedCity   — current city value
 *   selectedArea   — current area value
 *   onLocationChange(state, city, area) — called on any change
 *   label          — optional section label
 */
export default function LocationSelector({
    onLocationChange,
    selectedState = '',
    selectedCity = '',
    selectedArea = '',
    label = 'Location'
}) {
    // Only cities list is internal — it's API-derived, not form state
    const [cities, setCities] = useState([]);
    const [loadingCities, setLoadingCities] = useState(false);
    const [cityError, setCityError] = useState(false);

    // Fetch cities when selectedState prop changes
    useEffect(() => {
        if (!selectedState) {
            setCities([]);
            return;
        }

        setLoadingCities(true);
        setCityError(false);

        axios.post('https://countriesnow.space/api/v0.1/countries/state/cities', {
            country: 'India',
            state: selectedState
        })
            .then(res => {
                if (res.data && res.data.data) {
                    setCities(res.data.data);
                } else {
                    setCities([]);
                    setCityError(true);
                }
            })
            .catch(() => {
                setCities([]);
                setCityError(true);
            })
            .finally(() => setLoadingCities(false));
    }, [selectedState]);

    // ── Handlers: update parent directly ──
    const handleStateChange = useCallback((newState) => {
        if (onLocationChange) onLocationChange(newState, '', '');
    }, [onLocationChange]);

    const handleCityChange = useCallback((newCity) => {
        if (onLocationChange) onLocationChange(selectedState, newCity, selectedArea);
    }, [onLocationChange, selectedState, selectedArea]);

    const handleAreaChange = useCallback((newArea) => {
        if (onLocationChange) onLocationChange(selectedState, selectedCity, newArea);
    }, [onLocationChange, selectedState, selectedCity]);

    return (
        <div>
            {label && (
                <p className="text-sm font-semibold text-gray-700 mb-3">{label}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* State */}
                <div>
                    <label className="form-label">State</label>
                    <select
                        className="input-field"
                        value={selectedState}
                        onChange={(e) => handleStateChange(e.target.value)}
                    >
                        <option value="">Select State</option>
                        {INDIAN_STATES.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>

                {/* City */}
                <div>
                    <label className="form-label">City</label>
                    {loadingCities ? (
                        <div className="input-field flex items-center gap-2 text-gray-400">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-accent border-t-transparent"></div>
                            Loading cities...
                        </div>
                    ) : cityError ? (
                        <input
                            type="text"
                            className="input-field"
                            value={selectedCity}
                            onChange={(e) => handleCityChange(e.target.value)}
                            placeholder="Type city name"
                        />
                    ) : (
                        <select
                            className="input-field"
                            value={selectedCity}
                            onChange={(e) => handleCityChange(e.target.value)}
                            disabled={!selectedState}
                        >
                            <option value="">Select City</option>
                            {cities.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    )}
                    {cityError && (
                        <p className="text-xs text-orange-400 mt-1">API unavailable — type city manually</p>
                    )}
                </div>

                {/* Area */}
                <div>
                    <label className="form-label">Area / Locality</label>
                    <input
                        type="text"
                        className="input-field"
                        value={selectedArea}
                        onChange={(e) => handleAreaChange(e.target.value)}
                        placeholder="Enter area name"
                    />
                </div>
            </div>
        </div>
    );
}
