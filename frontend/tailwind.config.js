/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                navy: {
                    900: '#1a2340',
                    800: '#1e2a4a',
                    700: '#243055',
                },
                accent: '#4a6cf7',
                hot: '#e74c3c',
                warm: '#f39c12',
                cold: '#3498db',
                surface: '#f0f2f5',
            },
            boxShadow: {
                card: '0 2px 12px rgba(0,0,0,0.08)',
                'card-hover': '0 8px 24px rgba(0,0,0,0.14)',
            },
        },
    },
    plugins: [],
}
