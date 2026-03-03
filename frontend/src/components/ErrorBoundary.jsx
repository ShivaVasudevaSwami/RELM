import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('React Error Boundary caught:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-surface flex items-center justify-center p-8">
                    <div className="bg-white rounded-2xl shadow-card p-8 max-w-md w-full text-center">
                        <div className="text-5xl mb-4">⚠️</div>
                        <h2 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h2>
                        <p className="text-gray-500 text-sm mb-6">
                            An unexpected error occurred on this page.
                        </p>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null });
                                window.history.back();
                            }}
                            className="btn-primary"
                        >
                            ← Go Back
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
