import { useAuth } from '../context/AuthContext';
import { useSidebar } from '../App';

export default function Navbar() {
    const { user, logout } = useAuth();
    const { open, setOpen } = useSidebar();

    const initials = user?.username
        ? user.username.slice(0, 2).toUpperCase()
        : '??';

    const roleBadge = user?.role === 'admin'
        ? 'bg-blue-100 text-blue-600'
        : user?.role === 'manager'
            ? 'bg-purple-100 text-purple-600'
            : 'bg-green-100 text-green-600';

    return (
        <nav className="bg-white shadow-sm px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
                {/* Hamburger toggle for mobile / collapsed sidebar */}
                <button
                    onClick={() => setOpen(!open)}
                    className="text-gray-500 hover:text-gray-800 text-xl md:hidden"
                    title="Toggle sidebar"
                >
                    ☰
                </button>
                <h1 className="text-lg font-semibold text-gray-800 hidden sm:block">
                    RE-LM
                </h1>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-semibold text-sm">
                        {initials}
                    </div>
                    <div className="hidden sm:block">
                        <p className="text-sm font-medium text-gray-700">{user?.username}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${roleBadge}`}>
                            {user?.role}
                        </span>
                    </div>
                </div>
                <button
                    onClick={logout}
                    className="text-sm text-gray-500 hover:text-red-500 transition-colors duration-150 font-medium"
                >
                    <span className="hidden sm:inline">Logout</span>
                    <span className="sm:hidden">Out</span>
                </button>
            </div>
        </nav>
    );
}
