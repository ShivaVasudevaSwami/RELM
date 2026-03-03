import { useState, useEffect, useRef } from 'react';

export default function StatusBadge({ status, size = 'sm' }) {
    const [pulse, setPulse] = useState(false);
    const prevStatus = useRef(status);

    useEffect(() => {
        if (prevStatus.current !== status) {
            setPulse(true);
            const timer = setTimeout(() => setPulse(false), 1500);
            prevStatus.current = status;
            return () => clearTimeout(timer);
        }
    }, [status]);

    const baseClass = {
        'Gold': 'bg-gradient-to-r from-amber-400 to-yellow-500 text-white font-bold px-3 py-1 rounded-full text-xs shadow-md',
        'Ultra Hot': 'bg-gradient-to-r from-purple-500 to-amber-400 text-white font-bold px-3 py-1 rounded-full text-xs shadow-md',
        Hot: 'badge-hot',
        Warm: 'badge-warm',
        Cold: 'badge-cold',
    }[status] || 'badge-cold';

    const label = status === 'Gold' ? '★ VIP' : status;

    const sizeClass = size === 'lg' ? 'text-base px-5 py-2' : '';
    const pulseClass = pulse ? 'animate-pulse' : '';

    return (
        <span className={`${baseClass} ${sizeClass} ${pulseClass} inline-block`}>
            {label}
        </span>
    );
}
