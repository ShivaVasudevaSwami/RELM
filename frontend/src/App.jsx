import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Outlet, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import AdminManagerRoute from './components/AdminManagerRoute';
import ErrorBoundary from './components/ErrorBoundary';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import AddLead from './pages/AddLead';
import LeadDetail from './pages/LeadDetail';
import UpdateStatus from './pages/UpdateStatus';
import AddVisit from './pages/AddVisit';
import ScheduleVisit from './pages/ScheduleVisit';
import VisitFeedback from './pages/VisitFeedback';
import Users from './pages/admin/Users';
import AddUser from './pages/admin/AddUser';
import EditUser from './pages/admin/EditUser';
import Properties from './pages/properties/Properties';
import AddProperty from './pages/properties/AddProperty';
import EditProperty from './pages/properties/EditProperty';
import PropertyDetail from './pages/properties/PropertyDetail';

// Sidebar context
export const SidebarContext = createContext({ open: true, setOpen: () => { } });
export const useSidebar = () => useContext(SidebarContext);

function AppLayout() {
    const [sidebarOpen, setSidebarOpen] = useState(true);

    useEffect(() => {
        if (window.innerWidth < 768) setSidebarOpen(false);
        const handleResize = () => {
            if (window.innerWidth < 768) setSidebarOpen(false);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <SidebarContext.Provider value={{ open: sidebarOpen, setOpen: setSidebarOpen }}>
            <div className="flex min-h-screen bg-surface">
                <Sidebar />
                {/* Mobile backdrop */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black/30 z-10 md:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
                <div className={`flex-1 transition-all duration-300 ease-in-out ${sidebarOpen ? 'md:ml-56' : 'md:ml-16'}`}>
                    <Navbar />
                    <main className="pt-16">
                        <Outlet />
                    </main>
                </div>
            </div>
        </SidebarContext.Provider>
    );
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
                <Route element={<ErrorBoundary><AppLayout /></ErrorBoundary>}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/leads/add" element={<AddLead />} />
                    <Route path="/leads/:id" element={<LeadDetail />} />
                    <Route path="/leads/:id/status" element={<UpdateStatus />} />
                    <Route path="/leads/:id/visit" element={<AddVisit />} />
                    <Route path="/leads/:id/schedule-visit" element={<ScheduleVisit />} />
                    <Route path="/leads/:id/visit-feedback/:visitId" element={<VisitFeedback />} />
                    <Route path="/properties" element={<Properties />} />
                    <Route path="/properties/:id" element={<PropertyDetail />} />
                    <Route element={<AdminManagerRoute />}>
                        <Route path="/properties/add" element={<AddProperty />} />
                        <Route path="/properties/edit/:id" element={<EditProperty />} />
                    </Route>
                    <Route element={<AdminRoute />}>
                        <Route path="/admin/users" element={<Users />} />
                        <Route path="/admin/users/add" element={<AddUser />} />
                        <Route path="/admin/users/edit/:id" element={<EditUser />} />
                    </Route>
                </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
    );
}
