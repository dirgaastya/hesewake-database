import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { api } from './lib/api.js';
import { ThemeProvider } from './lib/theme.jsx';
import { useLocation, matchRoute } from './lib/router.js';
import { ToastProvider } from './components/Toast.jsx';
import { VaultProvider, useVault } from './vault/VaultProvider.jsx';
import { UnlockProvider } from './vault/UnlockDialog.jsx';
import { AuthScreen } from './screens/AuthScreen.jsx';
import { GlobalLayer } from './screens/GlobalLayer.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { DesktopTitlebar } from './components/DesktopTitlebar.jsx';

const Workspace = lazy(() => import('./screens/Workspace.jsx').then(({ Workspace }) => ({ default: Workspace })));
const ImportScreen = lazy(() => import('./screens/ImportScreen.jsx').then(({ ImportScreen }) => ({ default: ImportScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen.jsx').then(({ SettingsScreen }) => ({ default: SettingsScreen })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (count, error) => error?.status >= 500 && count < 2 },
  },
});

function Shell() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<div className="min-h-full bg-canvas" aria-busy="true" />}>
        {route.screen === 'import' && <ImportScreen />}
        {route.screen === 'settings' && <SettingsScreen />}
        {route.screen === 'workspace' && <Workspace route={route} />}
      </Suspense>
      <GlobalLayer route={route} />
    </ErrorBoundary>
  );
}

function AuthGate() {
  const vault = useVault();
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api('/auth/status'), staleTime: 60_000 });

  useEffect(() => {
    const onUnauthorized = () => {
      vault.lock();
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-status' });
      status.refetch();
    };
    window.addEventListener('hdb:unauthorized', onUnauthorized);
    return () => window.removeEventListener('hdb:unauthorized', onUnauthorized);
  }, [vault, client, status]);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return undefined;
    const openInBrowser = (event) => {
      const anchor = event.target.closest('a[target="_blank"]');
      if (!anchor) return;
      event.preventDefault();
      invoke('open_url', { url: anchor.href })
        .catch((error) => console.error('Gagal membuka browser default:', error));
    };
    document.addEventListener('click', openInBrowser);
    return () => document.removeEventListener('click', openInBrowser);
  }, []);

  if (status.isPending) return <div className="min-h-full bg-canvas" aria-busy="true" />;
  if (status.isError) {
    return (
      <main className="grid min-h-full content-start gap-2 bg-canvas px-6 py-16">
        <h1 className="m-0 text-base font-semibold">Server tidak bisa dihubungi</h1>
        <p className="m-0 text-[13px] text-fg-muted">{status.error.message}</p>
      </main>
    );
  }
  if (!status.data.authenticated) return <AuthScreen status={status.data} onDone={() => status.refetch()} />;
  return (
    <UnlockProvider>
      <Shell />
    </UnlockProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <DesktopTitlebar />
          <div className="flex min-h-0 flex-1 flex-col">
            <ToastProvider>
              <VaultProvider>
                <AuthGate />
              </VaultProvider>
            </ToastProvider>
          </div>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
