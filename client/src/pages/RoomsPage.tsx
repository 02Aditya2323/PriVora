import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Room } from '../api/types';
import { Shield, Plus, LogOut, FolderLock, Users, ArrowRight, X, Key, Lock, AlertCircle, CheckCircle } from 'lucide-react';

interface RoomsPageProps {
  onSelectRoom: (roomId: string) => void;
}

export const RoomsPage: React.FC<RoomsPageProps> = ({ onSelectRoom }) => {
  const { user, logout } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create room modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creating, setCreating] = useState(false);

  // Join room by key modal state
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinKeyInput, setJoinKeyInput] = useState('');
  const [joinPasswordInput, setJoinPasswordInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const fetchRooms = async () => {
    try {
      setLoading(true);
      const data = await api.getRooms();
      setRooms(data.rooms);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();

    // Check for invite key in URL parameters (e.g., ?joinKey=xyz)
    const params = new URLSearchParams(window.location.search);
    const keyParam = params.get('joinKey') || params.get('key');
    if (keyParam) {
      setJoinKeyInput(keyParam.trim());
      setIsJoinModalOpen(true);
      // Clean query string from URL without full reload
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setCreating(true);

    try {
      const data = await api.createRoom(newRoomName.trim());
      setIsModalOpen(false);
      setNewRoomName('');
      await fetchRooms();
      onSelectRoom(data.room.id);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinWithKey = async (e: React.FormEvent) => {
    e.preventDefault();
    let keyToUse = joinKeyInput.trim();

    // Support pasting full invite URLs (e.g., http://localhost:5173/?joinKey=abc)
    if (keyToUse.includes('joinKey=')) {
      try {
        const parsed = new URL(keyToUse);
        keyToUse = parsed.searchParams.get('joinKey') || keyToUse;
      } catch {
        const match = keyToUse.match(/joinKey=([^&]+)/);
        if (match) keyToUse = match[1];
      }
    }

    if (!keyToUse) {
      setJoinError('Please enter a room join key');
      return;
    }

    setJoining(true);
    setJoinError(null);
    setJoinSuccess(null);

    try {
      const res = await api.joinRoomWithKey(keyToUse, joinPasswordInput.trim() || undefined);
      setJoinSuccess(res.alreadyMember ? `Welcome back! Opening "${res.room.name}"...` : `Successfully joined "${res.room.name}"!`);

      setTimeout(async () => {
        setIsJoinModalOpen(false);
        setJoinKeyInput('');
        setJoinPasswordInput('');
        setJoinSuccess(null);
        await fetchRooms();
        onSelectRoom(res.room.id);
      }, 700);
    } catch (err: any) {
      const code = err?.error?.code;
      if (code === 'PASSWORD_REQUIRED') {
        setJoinError('This room key is password protected. Please enter the password.');
      } else if (code === 'INVALID_KEY_PASSWORD') {
        setJoinError('Incorrect room key password. Please verify and try again.');
      } else if (code === 'INVALID_JOIN_KEY' || code === 'JOIN_KEY_EXHAUSTED') {
        setJoinError('This join key is invalid, expired, or has reached its maximum uses.');
      } else {
        setJoinError(err?.error?.message || 'Failed to join room with key');
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header Bar */}
      <header
        className="glass-card"
        style={{
          padding: '1.25rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield size={22} color="#6366f1" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', lineHeight: 1.2 }}>PriVora Secure Vault</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Logged in as <strong style={{ color: 'var(--text-main)' }}>{user?.username}</strong> ({user?.email})
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => {
              setJoinError(null);
              setJoinSuccess(null);
              setIsJoinModalOpen(true);
            }}
            className="btn btn-secondary"
            title="Join an encrypted room using an invite key"
          >
            <Key size={18} color="#06b6d4" />
            <span>Join with Key</span>
          </button>
          <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
            <Plus size={18} />
            <span>New Room</span>
          </button>
          <button onClick={logout} className="btn btn-secondary">
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Your Secure Rooms</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Private rooms with role-based access control, cryptographic join keys, and isolated storage.
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            color: '#fda4af',
            marginBottom: '1.5rem',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-dim)' }}>
          Loading your secure rooms...
        </div>
      ) : rooms.length === 0 ? (
        <div
          className="glass-card"
          style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <FolderLock size={48} color="#6366f1" style={{ opacity: 0.7 }} />
          <h3>No Vault Rooms Found</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: '420px', fontSize: '0.9rem' }}>
            You haven't created or joined any secure rooms yet. Create a room or join an existing room with an invite key.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button onClick={() => setIsModalOpen(true)} className="btn btn-primary">
              <Plus size={18} />
              <span>Create Room</span>
            </button>
            <button onClick={() => setIsJoinModalOpen(true)} className="btn btn-secondary">
              <Key size={18} color="#06b6d4" />
              <span>Join with Key</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {rooms.map((room) => (
            <div
              key={room.id}
              className="glass-card animate-fade-in"
              style={{
                padding: '1.5rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              onClick={() => onSelectRoom(room.id)}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span className={`badge badge-${room.role}`}>
                    {room.role}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {new Date(room.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                  {room.name}
                </h3>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '1.5rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)',
                  color: 'var(--text-dim)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Users size={16} />
                  <span>Encrypted Room</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-primary)' }}>
                  <span>Enter</span>
                  <ArrowRight size={16} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Room Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3>Create Secure Vault Room</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Room Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  className="input-field"
                  placeholder="e.g. Financial Audit 2026"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  maxLength={100}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room by Key Modal */}
      {isJoinModalOpen && (
        <div className="modal-overlay" onClick={() => setIsJoinModalOpen(false)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'rgba(6, 182, 212, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Key size={18} color="#06b6d4" />
                </div>
                <h3>Join Vault Room</h3>
              </div>
              <button
                onClick={() => setIsJoinModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Enter a 256-bit cryptographic room invite key or paste the full invite link.
            </p>

            {joinError && (
              <div
                style={{
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  color: '#fda4af',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
              >
                <AlertCircle size={16} />
                <span>{joinError}</span>
              </div>
            )}

            {joinSuccess && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  color: '#6ee7b7',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
              >
                <CheckCircle size={16} />
                <span>{joinSuccess}</span>
              </div>
            )}

            <form onSubmit={handleJoinWithKey} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Room Join Key or Invite Link *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  className="input-field"
                  placeholder="e.g. 43-character base64url key or ?joinKey=..."
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                  value={joinKeyInput}
                  onChange={(e) => {
                    setJoinKeyInput(e.target.value);
                    if (joinError) setJoinError(null);
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  <Lock size={14} />
                  <span>Key Password (optional)</span>
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Required only if key is password-protected"
                  value={joinPasswordInput}
                  onChange={(e) => {
                    setJoinPasswordInput(e.target.value);
                    if (joinError) setJoinError(null);
                  }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.3rem', display: 'block' }}>
                  If the room creator secured this key with an Argon2id password, enter it here.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsJoinModalOpen(false)}
                  className="btn btn-secondary"
                  disabled={joining}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={joining}>
                  {joining ? 'Verifying & Joining...' : 'Join Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
