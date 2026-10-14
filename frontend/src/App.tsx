import { lazy, Suspense, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Pos } from './pages/pos/Pos';
import { LoginApproval } from './pages/LoginApproval';
import { useLocation } from 'react-router-dom';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';


const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })));
const Customers = lazy(() => import('./pages/Customers').then((m) => ({ default: m.Customers })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Expenses = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.Expenses })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const Products = lazy(() => import('./pages/Products').then((m) => ({ default: m.Products })));
const Promotions = lazy(() => import('./pages/Promotions').then((m) => ({ default: m.Promotions })));
const Purchases = lazy(() => import('./pages/Purchases').then((m) => ({ default: m.Purchases })));
const Receiving = lazy(() => import('./pages/Receiving').then((m) => ({ default: m.Receiving })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Sales = lazy(() => import('./pages/Sales').then((m) => ({ default: m.Sales })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Shifts = lazy(() => import('./pages/Shifts').then((m) => ({ default: m.Shifts })));
const Suppliers = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.Suppliers })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));

const Guard = ({ any, children }: { any: string[]; children: ReactNode }) => {
  const { canAny } = useAuth();
  return canAny(...any) ? <>{children}</> : <Empty title="You don’t have access to this page" hint="Ask a manager if you need it for your work." />;
};

const Home = () => {
  const { canAny } = useAuth();
  if (canAny('dashboard:read')) return <Dashboard />;
  return <Navigate to={canAny('sale:create') ? '/pos' : canAny('stock:receive') ? '/receiving' : '/products'} replace />;
};

const page = (any: string[], node: ReactNode) => <Guard any={any}>{node}</Guard>;

export const App = () => {
  const { session, loading } = useAuth();
  const location = useLocation();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api<{ needsSetup: boolean }>('/setup/status'), enabled: !session });
  if (loading || (!session && setup.isLoading)) return <Loading />;

  if (
  !session &&
  setup.data?.needsSetup &&
  location.pathname !== '/login-approval'
) {
  return <Setup />;
}
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/login-approval" element={<LoginApproval />} />
      {session ? (
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="pos" element={page(['sale:create'], <Pos />)} />
          <Route path="products" element={page(['product:read'], <Products />)} />
          <Route path="receiving" element={page(['stock:receive'], <Receiving />)} />
          <Route path="inventory" element={page(['stock:read'], <Inventory />)} />
          <Route path="purchases" element={page(['purchase:read'], <Purchases />)} />
          <Route path="suppliers" element={page(['supplier:read'], <Suppliers />)} />
          <Route path="sales" element={page(['sale:read'], <Sales />)} />
          <Route path="shifts" element={page(['session:own'], <Shifts />)} />
          <Route path="promotions" element={page(['promotion:manage'], <Promotions />)} />
          <Route path="customers" element={page(['customer:read'], <Customers />)} />
          <Route path="expenses" element={page(['expense:read'], <Expenses />)} />
          <Route path="reports" element={page(['report:read'], <Reports />)} />
          <Route path="audit" element={page(['audit:read'], <Audit />)} />
          <Route path="users" element={page(['user:manage'], <Users />)} />
          <Route path="settings" element={page(['settings:manage'], <Settings />)} />
          <Route path="*" element={<Empty title="Page not found" />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
    </Suspense>
  );
};
