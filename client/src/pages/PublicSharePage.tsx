import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { ThemeToggle } from '../context/ThemeContext';
import { Shield, Download, Lock, FileText, AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface PublicSharePageProps {
  shareKey: string;
}

export const PublicSharePage: React.FC<PublicSharePageProps> = ({ shareKey }) => {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  useEffect(() => {
    fetchMetadata();
  }, [shareKey]);

  const fetchMetadata = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getShareMeta(shareKey);
      setMeta(data.file);
    } catch (err: any) {
      setError(err?.error?.message || 'This secure share link is invalid, expired, or download limit was reached.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta) return;

    if (meta.requiresPassword && !password.trim()) {
      setError('Password is required to decrypt this file');
      return;
    }

    setDownloading(true);
    setError(null);

    try {
      await api.downloadSharedFile(shareKey, meta.name, password.trim() || undefined);
      setDownloadSuccess(true);
      // Re-fetch meta in case max downloads reached
      setTimeout(() => {
        fetchMetadata();
      }, 1000);
    } catch (err: any) {
      const code = err?.error?.code;
      if (code === 'INVALID_PASSWORD') {
        setError('Incorrect password. Please verify and try again.');
      } else if (code === 'SHARE_LINK_UNAVAILABLE') {
        setError('This share link has expired or reached its maximum download limit.');
      } else {
        setError(err?.error?.message || 'Download failed');
      }
    } finally {
      setDownloading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
        <ThemeToggle />
      </div>

      <div className="glass-card animate-fade-in" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem 2rem' }}>
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent-ring)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield size={24} color="var(--accent-primary)" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem' }}>PriVora Secure Share</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Zero-Knowledge Cryptographic Vault</p>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-dim)' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                border: '3px solid var(--border-color)',
                borderTopColor: 'var(--accent-primary)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            <p style={{ fontSize: '0.9rem' }}>Verifying secure share link...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error && !meta ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'var(--alert-error-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
              }}
            >
              <AlertCircle size={26} color="var(--alert-error-color)" />
            </div>
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--alert-error-color)' }}>Link Unavailable</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>{error}</p>
            <a href="/" className="btn btn-secondary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
              Go to PriVora Home
            </a>
          </div>
        ) : meta ? (
          <div>
            {/* File Info Box */}
            <div
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: 'var(--accent-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FileText size={24} color="var(--accent-primary)" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h4
                  style={{
                    fontSize: '1rem',
                    color: 'var(--text-main)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginBottom: '0.25rem',
                  }}
                >
                  {meta.name}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  <span>{formatBytes(meta.size)}</span>
                  <span>•</span>
                  <span>{meta.detectedType}</span>
                </div>
              </div>
            </div>

            {meta.expiresAt && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.8rem',
                  color: 'var(--text-dim)',
                  marginBottom: '1.25rem',
                }}
              >
                <Clock size={14} />
                <span>Expires: {new Date(meta.expiresAt).toLocaleString()}</span>
              </div>
            )}

            {error && (
              <div
                style={{
                  background: 'var(--alert-error-bg)',
                  border: '1px solid var(--alert-error-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  color: 'var(--alert-error-color)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1.25rem',
                }}
              >
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {downloadSuccess && (
              <div
                style={{
                  background: 'var(--alert-success-bg)',
                  border: '1px solid var(--alert-success-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  color: 'var(--alert-success-color)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1.25rem',
                }}
              >
                <CheckCircle size={16} />
                <span>Download started! File successfully decrypted.</span>
              </div>
            )}

            <form onSubmit={handleDownload} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {meta.requiresPassword && (
                <div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.85rem',
                      marginBottom: '0.4rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Lock size={14} />
                    <span>Password Required *</span>
                  </label>
                  <input
                    type="password"
                    required
                    autoFocus
                    className="input-field"
                    placeholder="Enter decryption password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={downloading}
                style={{ padding: '0.85rem', width: '100%' }}
              >
                <Download size={18} />
                <span>{downloading ? 'Decrypting & Downloading...' : 'Download Encrypted File'}</span>
              </button>
            </form>

            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <a href="/" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textDecoration: 'none' }}>
                PriVora Zero-Knowledge Vault
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
