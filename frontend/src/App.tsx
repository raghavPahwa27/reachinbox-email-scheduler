import { Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "./context/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
export function App() {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div className="page-loading" role="status">
        <LoaderCircle className="spin" size={24} />
        <span>Opening your workspace…</span>
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={session ? <Dashboard /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/dashboard"
        element={session ? <Dashboard /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
