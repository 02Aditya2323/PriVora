import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../context/ThemeContext';
import { Shield, Lock, Mail, User as UserIcon, AlertCircle } from 'lucide-react';

export const AuthPage: React.FC = () => {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isRegister) {
        await register(email, username, password);
      } else {
        await login(identifier, password);
      }
    } catch (err: any) {
      setError(err?.error?.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
        <ThemeToggle />
      </div>

      <div className="glass-card animate-fade-in" style={{ maxWidth: '440px', width: '100%', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-ring)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
            }}
          >
            <Shield size={28} color="var(--accent-primary)" />
          </div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>PriVora Vault</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {isRegister ? 'Create an encrypted vault identity' : 'Access your secure rooms & encrypted files'}
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'var(--alert-error-bg)',
              border: '1px solid var(--alert-error-border)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              color: 'var(--alert-error-color)',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.5rem',
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {isRegister ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Email Address
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-dim)' }} />
                  <input
                    type="email"
                    required
                    className="input-field"
                    style={{ paddingLeft: '2.5rem' }}
                    placeholder="alice@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Username
                </label>
                <div style={{ position: 'relative' }}>
                  <UserIcon size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-dim)' }} />
                  <input
                    type="text"
                    required
                    className="input-field"
                    style={{ paddingLeft: '2.5rem' }}
                    placeholder="alice_vault"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                Email or Username
              </label>
              <div style={{ position: 'relative' }}>
                <UserIcon size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-dim)' }} />
                <input
                  type="text"
                  required
                  className="input-field"
                  style={{ paddingLeft: '2.5rem' }}
                  placeholder="alice@example.com or alice_vault"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
              Master Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-dim)' }} />
              <input
                type="password"
                required
                className="input-field"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="••••••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {isRegister && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                Must be at least 12 characters with a mix of uppercase, lowercase, numbers, or symbols.
              </p>
            )}
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
            {submitting ? 'Authenticating...' : isRegister ? 'Create Vault Account' : 'Unlock Vault'}
          </button>
        </form>

        <div style={{ marginTop: '1.75rem', textAlign: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}
          >
            {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
};
