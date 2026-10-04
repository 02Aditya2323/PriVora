import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Room, RoomMember, VaultFile, RoomJoinKey, FileShareLink } from '../api/types';
import { useSocket } from '../hooks/useSocket';
import {
  ArrowLeft,
  UploadCloud,
  File as FileIcon,
  Download,
  Trash2,
  Users,
  UserPlus,
  HardDrive,
  AlertTriangle,
  UserMinus,
  CheckCircle,
  Key,
  Copy,
  Check,
  Lock,
  Clock,
  X,
  Share2,
  Shield,
  Ticket,
} from 'lucide-react';

interface RoomDetailPageProps {
  roomId: string;
  onBack: () => void;
}

export const RoomDetailPage: React.FC<RoomDetailPageProps> = ({ roomId, onBack }) => {
  const { user } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [joinKeys, setJoinKeys] = useState<RoomJoinKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active tab in sidebar: 'members' or 'joinKeys'
  const [sidebarTab, setSidebarTab] = useState<'members' | 'joinKeys'>('members');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add member modal state (by username/email)
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMemberIdentifier, setNewMemberIdentifier] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'editor' | 'viewer'>('viewer');
  const [addingMember, setAddingMember] = useState(false);

  // Create Join Key modal state
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [keyRole, setKeyRole] = useState<'editor' | 'viewer'>('viewer');
  const [keyExpiryHours, setKeyExpiryHours] = useState(24);
  const [keyMaxUses, setKeyMaxUses] = useState<string>(''); // empty for unlimited
  const [keyPassword, setKeyPassword] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);

  // Newly Created Key modal display (Plaintext shown only once)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    key: string;
    role: string;
    expiresAt: string;
    requiresPassword: boolean;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // File Share Link Modal state
  const [activeShareFile, setActiveShareFile] = useState<VaultFile | null>(null);
  const [fileShareLinks, setFileShareLinks] = useState<FileShareLink[]>([]);
  const [loadingFileShares, setLoadingFileShares] = useState(false);
  const [shareExpiryMinutes, setShareExpiryMinutes] = useState(1440); // 24h
  const [shareMaxDownloads, setShareMaxDownloads] = useState<string>('');
  const [sharePassword, setSharePassword] = useState('');
  const [creatingShare, setCreatingShare] = useState(false);
  const [newlyCreatedShare, setNewlyCreatedShare] = useState<{ key: string } | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  // Socket.IO real-time hooks
  const { connected, onlineUsers } = useSocket({
    roomId,
    onFileUploaded: (newFile) => {
      setFiles((prev) => [newFile, ...prev.filter((f) => f.id !== newFile.id)]);
      setSuccessMsg(`New file uploaded: ${newFile.name}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onFileDeleted: (fileId) => {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    },
    onMemberChanged: () => {
      fetchMembers();
      if (room?.role === 'owner') fetchJoinKeys();
    },
    onRoomAccessRevoked: () => {
      alert('Your access to this vault room has been revoked.');
      onBack();
    },
  });

  const fetchRoomDetails = async () => {
    try {
      setLoading(true);
      const [roomData, filesData, membersData] = await Promise.all([
        api.getRoom(roomId),
        api.getRoomFiles(roomId),
        api.getRoomMembers(roomId),
      ]);
      setRoom(roomData.room);
      setFiles(filesData.files);
      setMembers(membersData.members);

      // If owner, fetch join keys as well
      if (roomData.room.role === 'owner') {
        const keysData = await api.getRoomJoinKeys(roomId);
        setJoinKeys(keysData.joinKeys);
      }
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to load vault room details');
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      const data = await api.getRoomMembers(roomId);
      setMembers(data.members);
    } catch {
      // Ignore background member poll error
    }
  };

  const fetchJoinKeys = async () => {
    try {
      const data = await api.getRoomJoinKeys(roomId);
      setJoinKeys(data.joinKeys);
    } catch {
      // Ignore background key poll error
    }
  };

  useEffect(() => {
    fetchRoomDetails();
  }, [roomId]);

  // File Upload Handler with client-side verification
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 26214400) {
      setError('File exceeds maximum size limit of 25 MB');
      return;
    }

    const blockedExts = ['exe', 'dll', 'bat', 'sh', 'html', 'htm', 'svg', 'js'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && blockedExts.includes(ext)) {
      setError(`Files with extension .${ext} are prohibited for security reasons`);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const result = await api.uploadFile(roomId, file);
      setFiles((prev) => [result.file, ...prev]);
      setSuccessMsg(`Encrypted and uploaded "${file.name}"`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err?.error?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Download Handler
  const handleDownload = async (file: VaultFile) => {
    try {
      await api.downloadFile(roomId, file.id, file.name);
    } catch (err: any) {
      setError(err?.error?.message || 'Download failed');
    }
  };

  // Delete File Handler
  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this encrypted file?')) return;

    try {
      await api.deleteFile(roomId, fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to delete file');
    }
  };

  // Delete Room Handler
  const handleDeleteRoom = async () => {
    if (!confirm('WARNING: Deleting this room will purge all encrypted files and revoke all memberships. Continue?')) {
      return;
    }

    try {
      await api.deleteRoom(roomId);
      onBack();
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to delete room');
    }
  };

  // Add Member Handler (Direct email/username)
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberIdentifier.trim()) return;
    setAddingMember(true);

    try {
      await api.addRoomMember(roomId, newMemberIdentifier.trim(), newMemberRole);
      setNewMemberIdentifier('');
      setIsAddMemberOpen(false);
      await fetchMembers();
      setSuccessMsg('Member added to room successfully');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  // Remove Member Handler
  const handleRemoveMember = async (memberUserId: string) => {
    const isSelf = memberUserId === user?.id;
    const confirmMsg = isSelf
      ? 'Are you sure you want to leave this room?'
      : 'Are you sure you want to remove this member from the room?';

    if (!confirm(confirmMsg)) return;

    try {
      await api.removeMember(roomId, memberUserId);
      if (isSelf) {
        onBack();
      } else {
        await fetchMembers();
      }
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to remove member');
    }
  };

  // Create Room Join Key Handler
  const handleCreateJoinKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingKey(true);
    setError(null);

    try {
      const maxUsesNum = keyMaxUses ? parseInt(keyMaxUses, 10) : undefined;
      const res = await api.createRoomJoinKey(roomId, {
        role: keyRole,
        expiresInHours: keyExpiryHours,
        maxUses: maxUsesNum,
        password: keyPassword.trim() || undefined,
      });

      setIsCreateKeyOpen(false);
      setKeyPassword('');
      setKeyMaxUses('');
      setNewlyCreatedKey({
        key: res.joinKey.key!,
        role: res.joinKey.role,
        expiresAt: res.joinKey.expiresAt,
        requiresPassword: res.joinKey.requiresPassword,
      });
      await fetchJoinKeys();
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to generate room join key');
    } finally {
      setCreatingKey(false);
    }
  };

  // Revoke Room Join Key Handler
  const handleRevokeJoinKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this join key? Anyone using it will no longer be able to join.')) {
      return;
    }

    try {
      await api.revokeRoomJoinKey(roomId, keyId);
      setJoinKeys((prev) => prev.filter((k) => k.id !== keyId));
      setSuccessMsg('Join key revoked successfully');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to revoke join key');
    }
  };

  // Open Share Links for a file
  const handleOpenShareModal = async (file: VaultFile) => {
    setActiveShareFile(file);
    setNewlyCreatedShare(null);
    setCopiedShareLink(false);
    setSharePassword('');
    setShareMaxDownloads('');
    setLoadingFileShares(true);

    try {
      const data = await api.getFileShareLinks(roomId, file.id);
      setFileShareLinks(data.shareLinks);
    } catch {
      setFileShareLinks([]);
    } finally {
      setLoadingFileShares(false);
    }
  };

  // Create File Share Link Handler
  const handleCreateShareLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShareFile) return;

    setCreatingShare(true);
    try {
      const maxDl = shareMaxDownloads ? parseInt(shareMaxDownloads, 10) : undefined;
      const res = await api.createFileShareLink(roomId, activeShareFile.id, {
        expiresInMinutes: shareExpiryMinutes,
        maxDownloads: maxDl,
        password: sharePassword.trim() || undefined,
      });

      setNewlyCreatedShare({ key: res.shareLink.key! });
      setSharePassword('');
      setShareMaxDownloads('');
      const data = await api.getFileShareLinks(roomId, activeShareFile.id);
      setFileShareLinks(data.shareLinks);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to generate share link');
    } finally {
      setCreatingShare(false);
    }
  };

  // Revoke File Share Link Handler
  const handleRevokeShareLink = async (linkId: string) => {
    if (!confirm('Are you sure you want to revoke this file share link?')) return;
    if (!activeShareFile) return;

    try {
      await api.revokeFileShareLink(roomId, linkId);
      setFileShareLinks((prev) => prev.filter((l) => l.id !== linkId));
      setSuccessMsg('Share link revoked');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.error?.message || 'Failed to revoke share link');
    }
  };

  const isOwner = room?.role === 'owner';
  const isEditor = room?.role === 'editor';
  const canUpload = isOwner || isEditor;

  if (loading) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-dim)' }}>
        Loading encrypted vault room...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Navigation & Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}>
          <ArrowLeft size={16} />
          <span>All Rooms</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            <span className="pulse-dot" style={{ backgroundColor: connected ? '#10b981' : '#f59e0b' }} />
            <span>{connected ? 'Live Sync Active' : 'Connecting Sync...'}</span>
          </div>

          {isOwner && (
            <button onClick={handleDeleteRoom} className="btn btn-danger" style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
              <Trash2 size={16} />
              <span>Delete Room</span>
            </button>
          )}
        </div>
      </div>

      {/* Room Title Banner */}
      <div
        className="glass-card"
        style={{
          padding: '1.75rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h1 style={{ fontSize: '1.75rem' }}>{room?.name}</h1>
            <span className={`badge badge-${room?.role}`}>{room?.role}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Room ID: <code style={{ color: 'var(--accent-cyan)' }}>{roomId}</code>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isOwner && (
            <button
              onClick={() => setIsCreateKeyOpen(true)}
              className="btn btn-secondary"
              title="Generate a cryptographically unguessable join key for this room"
            >
              <Key size={18} color="#06b6d4" />
              <span>Generate Join Key</span>
            </button>
          )}

          {canUpload && (
            <div>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-primary"
                disabled={uploading}
              >
                <UploadCloud size={18} />
                <span>{uploading ? 'Encrypting & Storing...' : 'Upload File (Max 25MB)'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Notification Banners */}
      {error && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            color: '#fda4af',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            color: '#6ee7b7',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Grid: Left = Files Vault, Right = Sidebar (Presence, Members & Join Keys) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2rem' }}>
        {/* Left Column: Files Vault */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <HardDrive size={20} color="#6366f1" />
              <span>Vault Files ({files.length})</span>
            </h2>
          </div>

          {files.length === 0 ? (
            <div
              className="glass-card"
              style={{
                padding: '3rem 2rem',
                textAlign: 'center',
                color: 'var(--text-dim)',
              }}
            >
              <FileIcon size={40} style={{ opacity: 0.5, marginBottom: '0.75rem' }} />
              <p>No files in this vault yet.</p>
              {canUpload && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Click "Upload File" above to deposit encrypted content.
                </p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {files.map((file) => {
                const canDelete = isOwner || (isEditor && file.uploaderId === user?.id);
                const canShare = isOwner || (isEditor && file.uploaderId === user?.id);
                return (
                  <div
                    key={file.id}
                    className="glass-card animate-fade-in"
                    style={{
                      padding: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          background: 'rgba(99, 102, 241, 0.15)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <FileIcon size={22} color="#818cf8" />
                      </div>
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '1rem' }}>
                        <h4
                          style={{
                            fontSize: '1rem',
                            color: 'var(--text-main)',
                            marginBottom: '0.2rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {file.name}
                        </h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                          <span>{(file.size / 1024).toFixed(1)} KB</span>
                          <span>•</span>
                          <span>{file.detectedType}</span>
                          <span>•</span>
                          <span>by {file.uploaderUsername || 'User'}</span>
                          <span>•</span>
                          <span>{new Date(file.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      <button
                        onClick={() => handleDownload(file)}
                        className="btn btn-secondary"
                        style={{ padding: '0.5rem 0.85rem' }}
                        title="Download decrypted file"
                      >
                        <Download size={16} />
                        <span>Download</span>
                      </button>

                      {canShare && (
                        <button
                          onClick={() => handleOpenShareModal(file)}
                          className="btn btn-secondary"
                          style={{ padding: '0.5rem 0.85rem' }}
                          title="Generate public share link"
                        >
                          <Share2 size={16} color="#06b6d4" />
                          <span>Share</span>
                        </button>
                      )}

                      {canDelete && (
                        <button
                          onClick={() => handleDeleteFile(file.id)}
                          className="btn btn-danger"
                          style={{ padding: '0.5rem 0.7rem' }}
                          title="Delete file"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Sidebar (Presence, Members & Keys Tabs) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Live Presence Panel */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="pulse-dot" />
              <h3 style={{ fontSize: '0.95rem' }}>Live in Room ({onlineUsers.length})</h3>
            </div>

            {onlineUsers.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>Waiting for users...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {onlineUsers.map((u) => (
                  <div
                    key={u.userId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.35rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(255, 255, 255, 0.03)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                    <span style={{ fontWeight: 500 }}>{u.username}</span>
                    {u.userId === user?.id && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>(you)</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tab Switcher: Members vs Join Keys */}
          <div className="glass-card" style={{ padding: '1.25rem' }}>
            <div
              style={{
                display: 'flex',
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '0.25rem',
                marginBottom: '1rem',
              }}
            >
              <button
                onClick={() => setSidebarTab('members')}
                style={{
                  flex: 1,
                  padding: '0.45rem',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: sidebarTab === 'members' ? 'var(--accent-primary)' : 'transparent',
                  color: sidebarTab === 'members' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
              >
                <Users size={15} />
                <span>Members ({members.length})</span>
              </button>

              {isOwner && (
                <button
                  onClick={() => setSidebarTab('joinKeys')}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    background: sidebarTab === 'joinKeys' ? 'var(--accent-primary)' : 'transparent',
                    color: sidebarTab === 'joinKeys' ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <Key size={15} />
                  <span>Join Keys ({joinKeys.length})</span>
                </button>
              )}
            </div>

            {/* Content for Tab: Members */}
            {sidebarTab === 'members' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Room members list</span>
                  {isOwner && (
                    <button
                      onClick={() => setIsAddMemberOpen(true)}
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                    >
                      <UserPlus size={14} />
                      <span>Add</span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {members.map((m) => {
                    const isMemberSelf = m.userId === user?.id;
                    return (
                      <div
                        key={m.userId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 0',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{m.username}</span>
                            {isMemberSelf && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>(you)</span>}
                          </div>
                          <span className={`badge badge-${m.role}`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', marginTop: '0.2rem' }}>
                            {m.role}
                          </span>
                        </div>

                        <div>
                          {isOwner && m.role !== 'owner' ? (
                            <button
                              onClick={() => handleRemoveMember(m.userId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#fda4af',
                                cursor: 'pointer',
                                padding: '0.25rem',
                              }}
                              title="Remove member"
                            >
                              <UserMinus size={16} />
                            </button>
                          ) : !isOwner && isMemberSelf ? (
                            <button
                              onClick={() => handleRemoveMember(m.userId)}
                              className="btn btn-danger"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            >
                              Leave
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Content for Tab: Join Keys (Owner Only) */}
            {sidebarTab === 'joinKeys' && isOwner && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Active invite keys</span>
                  <button
                    onClick={() => setIsCreateKeyOpen(true)}
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                  >
                    <Key size={14} color="#06b6d4" />
                    <span>Create</span>
                  </button>
                </div>

                {joinKeys.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    <Ticket size={24} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
                    <p>No active join keys.</p>
                    <button
                      onClick={() => setIsCreateKeyOpen(true)}
                      className="btn btn-secondary"
                      style={{ marginTop: '0.75rem', fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                    >
                      Generate Key
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {joinKeys.map((k) => (
                      <div
                        key={k.id}
                        style={{
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.75rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.4rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span className={`badge badge-${k.role}`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem' }}>
                            {k.role}
                          </span>
                          <button
                            onClick={() => handleRevokeJoinKey(k.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#fda4af',
                              cursor: 'pointer',
                              padding: '0.2rem',
                            }}
                            title="Revoke join key immediately"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                          <span>Uses: {k.useCount} {k.maxUses ? `/ ${k.maxUses}` : '(unlimited)'}</span>
                          {k.requiresPassword && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: '#f59e0b' }}>
                              <Lock size={12} />
                              <span>Pass Protected</span>
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                          <Clock size={12} />
                          <span>Expires: {new Date(k.expiresAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 1. Modal: Add Member Direct (username/email) */}
      {isAddMemberOpen && (
        <div className="modal-overlay" onClick={() => setIsAddMemberOpen(false)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3>Add Member to Vault</h3>
              <button onClick={() => setIsAddMemberOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddMember} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  User Email or Username
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  className="input-field"
                  placeholder="e.g. bob@example.com or bob_editor"
                  value={newMemberIdentifier}
                  onChange={(e) => setNewMemberIdentifier(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Vault Role
                </label>
                <select
                  className="input-field"
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as 'editor' | 'viewer')}
                >
                  <option value="viewer">Viewer (Can view and download files)</option>
                  <option value="editor">Editor (Can upload, download, and delete own files)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsAddMemberOpen(false)}
                  className="btn btn-secondary"
                  disabled={addingMember}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={addingMember}>
                  {addingMember ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Create Room Join Key */}
      {isCreateKeyOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateKeyOpen(false)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Key size={20} color="#06b6d4" />
                <h3>Generate Room Join Key</h3>
              </div>
              <button onClick={() => setIsCreateKeyOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Creates a cryptographically unguessable 256-bit CSPRNG invite key. PriVora only stores the SHA-256 hash.
            </p>

            <form onSubmit={handleCreateJoinKey} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  Assigned Member Role
                </label>
                <select
                  className="input-field"
                  value={keyRole}
                  onChange={(e) => setKeyRole(e.target.value as 'editor' | 'viewer')}
                >
                  <option value="viewer">Viewer (Can view and download files)</option>
                  <option value="editor">Editor (Can upload and manage files)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                    Key Expiration
                  </label>
                  <select
                    className="input-field"
                    value={keyExpiryHours}
                    onChange={(e) => setKeyExpiryHours(parseInt(e.target.value, 10))}
                  >
                    <option value={1}>1 Hour</option>
                    <option value={6}>6 Hours</option>
                    <option value={24}>24 Hours (1 Day)</option>
                    <option value={72}>3 Days</option>
                    <option value={168}>7 Days (Max)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                    Usage Limit
                  </label>
                  <select
                    className="input-field"
                    value={keyMaxUses}
                    onChange={(e) => setKeyMaxUses(e.target.value)}
                  >
                    <option value="">Unlimited uses</option>
                    <option value="1">Single-use (Burn after join)</option>
                    <option value="5">5 uses</option>
                    <option value="10">10 uses</option>
                    <option value="25">25 uses</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  <Lock size={14} />
                  <span>Optional Key Password (Argon2id)</span>
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Leave empty if open to anyone with the key"
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsCreateKeyOpen(false)}
                  className="btn btn-secondary"
                  disabled={creatingKey}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingKey}>
                  {creatingKey ? 'Generating Key...' : 'Generate Join Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal: Newly Created Key Display (Shown ONCE) */}
      {newlyCreatedKey && (
        <div className="modal-overlay" onClick={() => setNewlyCreatedKey(null)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={22} color="#10b981" />
                <h3>Room Join Key Generated</h3>
              </div>
              <button onClick={() => setNewlyCreatedKey(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '0.85rem 1rem',
                color: '#fcd34d',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                marginBottom: '1.25rem',
              }}
            >
              <Shield size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Security Notice:</strong> PriVora never stores plaintext keys. This 256-bit key will <em>never</em> be displayed again. Please copy and share it now.
              </div>
            </div>

            {/* Raw Join Key */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                Raw Join Key
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  readOnly
                  value={newlyCreatedKey.key}
                  className="input-field"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newlyCreatedKey.key);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2500);
                  }}
                  className="btn btn-secondary"
                  style={{ flexShrink: 0 }}
                >
                  {copiedKey ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* One-Click Shareable Invite Link */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                Direct Invite Link
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/?joinKey=${newlyCreatedKey.key}`}
                  className="input-field"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/?joinKey=${newlyCreatedKey.key}`);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2500);
                  }}
                  className="btn btn-primary"
                  style={{ flexShrink: 0 }}
                >
                  {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copiedLink ? 'Link Copied' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setNewlyCreatedKey(null)} className="btn btn-secondary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal: File Share Link Generation & Management */}
      {activeShareFile && (
        <div className="modal-overlay" onClick={() => setActiveShareFile(null)}>
          <div className="modal-content animate-fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Share2 size={20} color="#06b6d4" />
                <h3 style={{ fontSize: '1.15rem' }}>Public Share Link</h3>
              </div>
              <button onClick={() => setActiveShareFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              File: <strong style={{ color: 'var(--text-main)' }}>{activeShareFile.name}</strong>
            </p>

            {newlyCreatedShare && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#6ee7b7', marginBottom: '0.5rem', fontWeight: 500, fontSize: '0.9rem' }}>
                  <CheckCircle size={16} />
                  <span>Public Download Link Created!</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    readOnly
                    className="input-field"
                    style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                    value={`${window.location.origin}/s/${newlyCreatedShare.key}`}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/s/${newlyCreatedShare.key}`);
                      setCopiedShareLink(true);
                      setTimeout(() => setCopiedShareLink(false), 2500);
                    }}
                    className="btn btn-primary"
                    style={{ flexShrink: 0 }}
                  >
                    {copiedShareLink ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copiedShareLink ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateShareLink} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                    Link Expiry
                  </label>
                  <select
                    className="input-field"
                    value={shareExpiryMinutes}
                    onChange={(e) => setShareExpiryMinutes(parseInt(e.target.value, 10))}
                  >
                    <option value={60}>1 Hour</option>
                    <option value={360}>6 Hours</option>
                    <option value={1440}>24 Hours</option>
                    <option value={4320}>3 Days</option>
                    <option value={10080}>7 Days</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                    Max Downloads
                  </label>
                  <select
                    className="input-field"
                    value={shareMaxDownloads}
                    onChange={(e) => setShareMaxDownloads(e.target.value)}
                  >
                    <option value="">Unlimited</option>
                    <option value="1">1 (Burn after download)</option>
                    <option value="5">5 downloads</option>
                    <option value="10">10 downloads</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>
                  <Lock size={14} />
                  <span>Optional Download Password</span>
                </label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Required only if you want password protection"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button type="submit" className="btn btn-primary" disabled={creatingShare}>
                  {creatingShare ? 'Creating Link...' : 'Create Share Link'}
                </button>
              </div>
            </form>

            {/* Active share links for this file */}
            <div>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-dim)' }}>
                Active Share Links ({fileShareLinks.length})
              </h4>
              {loadingFileShares ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Loading active links...</div>
              ) : fileShareLinks.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No active share links for this file.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {fileShareLinks.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.6rem 0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.8rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span>Downloads: {l.downloadCount} {l.maxDownloads ? `/ ${l.maxDownloads}` : '(unlimited)'}</span>
                        {l.requiresPassword && <Lock size={12} color="#f59e0b" />}
                        <span style={{ color: 'var(--text-dim)' }}>Expires: {new Date(l.expiresAt).toLocaleDateString()}</span>
                      </div>
                      <button
                        onClick={() => handleRevokeShareLink(l.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#fda4af',
                          cursor: 'pointer',
                        }}
                        title="Revoke share link"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
