import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSidebar } from '../App';

export default function Sidebar() {
    const { user, isAdmin, isAdminOrManager } = useAuth();
    const { open, setOpen } = useSidebar();

    const linkClass = ({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${isActive
            ? 'bg-navy-800 text-white font-semibold'
            : 'text-gray-300 hover:bg-navy-800 hover:text-white'
        } ${!open ? 'justify-center' : ''}`;

    return (
        <aside className={`bg-navy-900 text-white fixed top-0 left-0 h-full flex flex-col py-6 z-20
      transition-all duration-300 ease-in-out
      ${open ? 'w-56 px-4' : 'w-16 px-2'}
      ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>

            {/* Logo + Toggle */}
            <div className={`flex items-center mb-6 ${open ? 'justify-between px-2' : 'justify-center'}`}>
                <div className={`flex items-center gap-2 ${!open ? 'justify-center' : ''}`}>
                    <span className="text-xl">🏠</span>
                    {open && <span className="text-xl font-bold text-white">RE-LM</span>}
                </div>
                <button
                    onClick={() => setOpen(!open)}
                    className={`text-gray-400 hover:text-white transition-colors text-lg ${!open ? 'hidden md:block mt-2' : ''}`}
                    title={open ? 'Collapse sidebar' : 'Expand sidebar'}
                >
                    {open ? '◀' : '▶'}
                </button>
            </div>

            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    className="text-gray-400 hover:text-white text-lg mb-4 mx-auto"
                    title="Expand sidebar"
                >
                    ▶
                </button>
            )}

            {/* Navigation */}
            <nav className="flex flex-col gap-1 flex-1">
                {open && <span className="text-xs text-gray-500 uppercase tracking-wider px-3 mb-2">Main</span>}
                <NavLink to="/dashboard" className={linkClass} title="Dashboard">
                    <span>📊</span>
                    {open && <span>Dashboard</span>}
                </NavLink>
                <NavLink to="/leads" className={linkClass} title="Leads">
                    <span>📋</span>
                    {open && <span>Leads</span>}
                </NavLink>
                <NavLink to="/leads/add" className={linkClass} title="Add Lead">
                    <span>👤</span>
                    {open && <span>Add Lead</span>}
                </NavLink>

                {open && <span className="text-xs text-gray-500 uppercase tracking-wider px-3 mt-6 mb-2">Properties</span>}
                {!open && <div className="border-t border-navy-700 my-3" />}
                <NavLink to="/properties" className={linkClass} title="Properties">
                    <span>🏠</span>
                    {open && <span>Properties</span>}
                </NavLink>
                {isAdminOrManager && (
                    <NavLink to="/properties/add" className={linkClass} title="Add Property">
                        <span>➕</span>
                        {open && <span>Add Property</span>}
                    </NavLink>
                )}

                {isAdmin && (
                    <>
                        {open && <span className="text-xs text-gray-500 uppercase tracking-wider px-3 mt-6 mb-2">Admin</span>}
                        {!open && <div className="border-t border-navy-700 my-3" />}
                        <NavLink to="/admin/users" className={linkClass} title="Manage Users">
                            <span>👥</span>
                            {open && <span>Manage Users</span>}
                        </NavLink>
                    </>
                )}
            </nav>

            {/* User info (expanded only) */}
            {open && (
                <div className="border-t border-navy-700 pt-4 mt-4">
                    <p className="text-sm text-gray-300 px-2">Signed in as</p>
                    <p className="text-sm font-semibold text-white px-2 mt-1">{user?.username}</p>
                    <p className="text-xs text-gray-500 px-2 mt-3">RE-LM v4.1.0</p>
                </div>
            )}
        </aside>
    );
}
