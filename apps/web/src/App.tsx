import { useEffect, lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Layout } from '@/components/Layout';
import { PageLoader } from '@/components/ui';
import Login from '@/pages/Login';

const Analytics = lazy(() => import('@/pages/Analytics'));
const Accounts = lazy(() => import('@/pages/Accounts'));
const AccountDetail = lazy(() => import('@/pages/AccountDetail'));
const Campaigns = lazy(() => import('@/pages/Campaigns'));
const CampaignPage = lazy(() => import('@/pages/Campaign'));
const Unibox = lazy(() => import('@/pages/Unibox'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

/** Old /campaigns/:id/edit/:tab links keep working. */
function LegacyCampaignRedirect() {
  const { id, tab } = useParams();
  return <Navigate to={`/campaigns/${id}/${tab ?? 'sequence'}`} replace />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['me'], queryFn: () => get<{ email: string }>('/api/auth/me'), retry: false, staleTime: 60_000 });
  const loc = useLocation();
  if (isLoading) return <PageLoader />;
  if (isError || !data) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    const h = () => {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ queryKey: ['me'] });
      nav('/login');
    };
    window.addEventListener('mf:unauthorized', h);
    return () => window.removeEventListener('mf:unauthorized', h);
  }, []);
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Analytics />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:id/:tab?" element={<AccountDetail />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/:id/edit/:tab?" element={<LegacyCampaignRedirect />} />
          <Route path="campaigns/:id/:tab?" element={<CampaignPage />} />
          <Route path="unibox/:threadId?" element={<Unibox />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
