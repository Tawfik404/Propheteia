import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';

// The map pulls in Leaflet + marker clustering (~160 kB gzipped); load it
// only when the user actually opens the map page.
const MapPage = lazy(() => import('./pages/Map'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/alerts" replace />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route
          path="/map"
          element={
            <Suspense fallback={<div className="page-loading">Loading map…</div>}>
              <MapPage />
            </Suspense>
          }
        />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
