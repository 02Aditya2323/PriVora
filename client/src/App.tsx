import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthPage } from './pages/AuthPage';
import { RoomsPage } from './pages/RoomsPage';
import { RoomDetailPage } from './pages/RoomDetailPage';
import { PublicSharePage } from './pages/PublicSharePage';

const MainNavigator: React.FC = () => {
  const { user, loading } = useAuth();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // Check if viewing a public share link (e.g. /s/:key)
  const [publicShareKey, setPublicShareKey] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/s\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      setPublicShareKey(match[1]);
    }
  }, []);

  if (publicShareKey) {
    return <PublicSharePage shareKey={publicShareKey} />;
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid var(--border-color)',
              borderTopColor: 'var(--accent-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 1rem',
            }}
          />
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Verifying Vault Session...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (selectedRoomId) {
    return (
      <RoomDetailPage
        roomId={selectedRoomId}
        onBack={() => setSelectedRoomId(null)}
      />
    );
  }

  return <RoomsPage onSelectRoom={(roomId) => setSelectedRoomId(roomId)} />;
};

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
