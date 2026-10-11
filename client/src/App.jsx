import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Routes, Route, Navigate, Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, refresh, setToken, setAuthLost, upload, saveBlob, openSocket } from './api.js';

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
const list = (d, k) => (Array.isArray(d) ? d : d?.[k] ?? []);
const uid = (m) => m.userId ?? m.id;
const when = (s) => (s ? new Date(s).toLocaleString() : '—');
const fmt = (n = 0) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const MAX = 25 * 1024 * 1024;
const meOf = (d) => d?.user ?? d;
const fname = (f) => f.name ?? f.filename ?? f.original_name ?? 'file';
const kind = (n = '') => {
  const e = n.split('.').pop().toLowerCase();
  return /^(png|jpe?g|gif|webp|svg)$/.test(e) ? 'img' : e === 'pdf' ? 'pdf'
    : /^(docx?|txt|md|xlsx?|pptx?|csv)$/.test(e) ? 'doc' : /^(zip|rar|7z|tar|gz)$/.test(e) ? 'zip' : 'file';
};

export default function App() {
  const [user, setUser] = useState(undefined);
  const [socket, setSocket] = useState(null);
  const [toasts, setToasts] = useState([]);
  const nav = useNavigate();

  const toast = useCallback((msg, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    setAuthLost(() => setUser(null));
    refresh().then(() => api('/auth/me')).then((d) => setUser(meOf(d))).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    const s = openSocket();
    setSocket(s);
    s.on('notification:new', (n) => toast(n.message));
    s.on('session:revoked', () => { setToken(null); setUser(null); });
    return () => { s.close(); setSocket(null); };
  }, [user?.id]);

  const login = async (body) => {
    const d = await api('/auth/login', { method: 'POST', body });
    setToken(d.accessToken);
    setUser(d.user ?? meOf(await api('/auth/me')));
  };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null); setUser(null); nav('/login');
  };

  if (user === undefined) return <div className="center muted">Loading…</div>;
  const gate = (el) => (user ? el : <Navigate to="/login" replace />);

  return (
    <Ctx.Provider value={{ user, socket, toast, login, logout }}>
      <Routes>
        <Route path="/s/:key" element={<SharePage />} />
        <Route path="/login" element={user ? <Navigate to="/rooms" /> : <AuthForm mode="login" />} />
        <Route path="/register" element={user ? <Navigate to="/rooms" /> : <AuthForm mode="register" />} />
        <Route element={gate(<Shell />)}>
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/rooms/:roomId" element={<Room />} />
          <Route path="/admin/audit" element={<Audit />} />
        </Route>
        <Route path="*" element={<Navigate to="/rooms" />} />
      </Routes>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.type}>{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}

function Shell() {
  const { user, logout } = useApp();
  const admin = user.role === 'admin' || user.isAdmin;
  return (
    <>
      <header className="bar">
        <Link to="/rooms" className="brand">🔒 Privora</Link>
        <nav>
          <NavLink to="/rooms">Rooms</NavLink>
          {admin && <NavLink to="/admin/audit">Audit log</NavLink>}
        </nav>
        <span className="grow" />
        <span className="secure hide-sm">Encrypted session</span>
        <span className="muted hide-sm">{user.username}</span>
        <button className="btn ghost" onClick={logout}>Sign out</button>
      </header>
      <main className="wrap"><Outlet /></main>
    </>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row"><h3 className="grow">{title}</h3><button className="btn ghost" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function AuthForm({ mode }) {
  const { login, toast } = useApp();
  const [f, setF] = useState({ username: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const reg = mode === 'register';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (reg) {
        await api('/auth/register', { method: 'POST', body: f });
        toast('Welcome to Privora', 'ok');
      }
      await login({ identifier: f.email, password: f.password });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="center">
      <div className="split">
        <aside className="hero">
          <h1>Share files without losing control of them.</h1>
          <ul>
            <li>Files are encrypted before they reach storage.</li>
            <li>Share links expire, cap downloads and can be revoked.</li>
            <li>Every room has owners, editors and viewers.</li>
          </ul>
        </aside>
        <form className="card auth" onSubmit={submit}>
          <h1>🔒 Privora</h1>
          <p className="muted">{reg ? 'Create your account' : 'Sign in to your secure rooms'}</p>
          {reg && <label>Username<input required minLength={3} value={f.username} onChange={set('username')} autoComplete="username" /></label>}
          <label>Email<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
          <label>Password<input required type="password" minLength={reg ? 10 : 1} value={f.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} /></label>
          {reg && <small className="muted">Use a long, unique password (10+ characters).</small>}
          {err && <div className="alert">{err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : reg ? 'Create account' : 'Sign in'}</button>
          <p className="muted">{reg ? <>Have an account? <Link to="/login">Sign in</Link></> : <>New here? <Link to="/register">Create account</Link></>}</p>
        </form>
      </div>
    </div>
  );
}

function Rooms() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => {
    api('/rooms').then((d) => setRooms(list(d, 'rooms'))).catch((e) => { toast(e.message, 'err'); setRooms([]); });
  }, []);
  const create = async (e) => {
    e.preventDefault();
    try { const d = await api('/rooms', { method: 'POST', body: { name } }); nav(`/rooms/${(d.room ?? d).id}`); }
    catch (x) { toast(x.message, 'err'); }
  };
  return (
    <>
      <div className="row"><div className="grow"><h2>Your rooms</h2><span className="muted">Private spaces for sharing files with the people you choose.</span></div></div>
      <form className="row card" onSubmit={create}>
        <input className="grow" required maxLength={80} placeholder="New room name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary">Create room</button>
      </form>
      {rooms === null ? <p className="muted">Loading…</p> : rooms.length === 0 ? (
        <div className="empty"><div className="vault">🔒</div><b>Your vault is empty</b><br />Name a room above to create your first one.</div>
      ) : (
        <div className="grid">
          {rooms.map((r) => (
            <Link key={r.id} to={`/rooms/${r.id}`} className="card tile">
              <span className="rico">{r.name[0]?.toUpperCase()}</span><strong>{r.name}</strong>
              <span className="muted">{r.role ? <span className={'pill ' + r.role}>{r.role}</span> : null} {r.createdAt ? `Created ${new Date(r.createdAt).toLocaleDateString()}` : ''}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Room() {
  const { roomId } = useParams();
  const { user, socket, toast } = useApp();
  const nav = useNavigate();
  const [room, setRoom] = useState(null);
  const [files, setFiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [online, setOnline] = useState([]);
  const [share, setShare] = useState(null);
  const [prog, setProg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [tab, setTab] = useState('files');

  const loadFiles = useCallback(() => api(`/rooms/${roomId}/files`).then((d) => setFiles(list(d, 'files'))), [roomId]);
  const loadMembers = useCallback(() => api(`/rooms/${roomId}/members`).then((d) => setMembers(list(d, 'members'))), [roomId]);

  useEffect(() => {
    Promise.all([api(`/rooms/${roomId}`), loadFiles(), loadMembers()])
      .then(([r]) => setRoom(r.room ?? r))
      .catch((e) => { toast(e.message, 'err'); nav('/rooms'); });
  }, [roomId]);

  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('room:join', { roomId });
    const mine = (d) => d.roomId === roomId;
    const on = {
      'presence:snapshot': (d) => mine(d) && setOnline(d.users),
      'presence:update': (d) => mine(d) && setOnline((o) => d.status === 'online' ? [...o.filter((u) => u.userId !== d.userId), d] : o.filter((u) => u.userId !== d.userId)),
      'file:uploaded': (d) => mine(d) && setFiles((f) => f.some((x) => x.id === d.file.id) ? f : [d.file, ...f]),
      'file:deleted': (d) => mine(d) && setFiles((f) => f.filter((x) => x.id !== d.fileId)),
      'member:added': (d) => mine(d) && loadMembers(),
      'member:removed': (d) => mine(d) && loadMembers(),
      'member:role_changed': (d) => mine(d) && loadMembers(),
      'room:access_revoked': (d) => { if (mine(d)) { toast('Your access to this room was removed', 'err'); nav('/rooms'); } },
    };
    join(); socket.on('connect', join);
    Object.entries(on).forEach(([e, f]) => socket.on(e, f));
    return () => {
      socket.emit('room:leave', { roomId }); socket.off('connect', join);
      Object.entries(on).forEach(([e, f]) => socket.off(e, f));
    };
  }, [socket, roomId]);

  const role = members.find((m) => uid(m) === user.id)?.role ?? room?.role;
  const owner = role === 'owner';
  const canEdit = owner || role === 'editor';

  const doUpload = async (fl) => {
    for (const f of fl) {
      if (f.size > MAX) { toast(`${f.name} is over the 25 MB limit`, 'err'); continue; }
      try { setProg({ name: f.name, pct: 0 }); await upload(roomId, f, (pct) => setProg({ name: f.name, pct })); toast(`Uploaded ${f.name}`, 'ok'); }
      catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
    }
    setProg(null); loadFiles();
  };
  const dl = async (f) => {
    try { await saveBlob(await api(`/rooms/${roomId}/files/${f.id}/download`, { raw: true }), fname(f)); }
    catch (e) { toast(e.message, 'err'); }
  };
  const del = async (f) => {
    if (!confirm(`Delete "${fname(f)}"? This cannot be undone.`)) return;
    try { await api(`/rooms/${roomId}/files/${f.id}`, { method: 'DELETE' }); setFiles((x) => x.filter((y) => y.id !== f.id)); }
    catch (e) { toast(e.message, 'err'); }
  };
  const delRoom = async () => {
    if (!confirm('Delete this room and all its files?')) return;
    try { await api(`/rooms/${roomId}`, { method: 'DELETE' }); nav('/rooms'); } catch (e) { toast(e.message, 'err'); }
  };
  const leave = async () => {
    if (!confirm('Leave this room?')) return;
    try { await api(`/rooms/${roomId}/members/${user.id}`, { method: 'DELETE' }); nav('/rooms'); } catch (e) { toast(e.message, 'err'); }
  };

  if (!room) return <p className="muted">Loading…</p>;
  const onlineIds = new Set(online.map((u) => u.userId));
  const used = files.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <>
      <div className="row"><Link to="/rooms" className="muted">← Rooms</Link></div>
      <div className="row">
        <h2 className="grow">{room.name} <span className={'pill ' + role}>{role}</span></h2>
        <div className="avatars" title="Online now">
          {online.map((u) => <span key={u.userId} className="av on" title={u.username}>{(u.username || '?')[0].toUpperCase()}</span>)}
        </div>
        {owner ? <button className="btn danger" onClick={delRoom}>Delete room</button> : <button className="btn ghost" onClick={leave}>Leave</button>}
      </div>

      <div className="stats">
        <div className="stat"><b>{files.length}</b><span>files</span></div>
        <div className="stat"><b>{fmt(used)}</b><span>stored</span></div>
        <div className="stat"><b>{members.length}</b><span>members</span></div>
        <div className="stat live"><b>{online.length}</b><span>online now</span></div>
      </div>
      <div className="tabs">
        <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files ({files.length})</button>
        <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>Members ({members.length})</button>
      </div>

      {tab === 'files' && (
        <>
          {canEdit && (
            <label className={'drop' + (drag ? ' over' : '')}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); doUpload([...e.dataTransfer.files]); }}>
              <input type="file" multiple hidden onChange={(e) => { doUpload([...e.target.files]); e.target.value = ''; }} />
              {prog ? (
                <div className="progw"><span>{prog.name} — {prog.pct}%</span><progress max="100" value={prog.pct} /></div>
              ) : <span><b>Drop files here</b> or click to browse · max 25 MB · encrypted at rest</span>}
            </label>
          )}
          {files.length === 0 ? <div className="empty">No files yet.</div> : (
            <div className="card flush scroll">
              <table>
                <thead><tr><th>Name</th><th>Size</th><th className="hide-sm">Added</th><th /></tr></thead>
                <tbody>
                  {files.map((f) => {
                    const manage = owner || (canEdit && f.uploaderId === user.id);
                    return (
                      <tr key={f.id}>
                        <td className="name"><span className={'ficon ' + kind(fname(f))}>{fname(f).split('.').pop().slice(0, 4).toUpperCase()}</span>{fname(f)}</td>
                        <td>{fmt(f.size)}</td>
                        <td className="hide-sm muted">{when(f.createdAt)}</td>
                        <td className="actions">
                          <button className="btn" onClick={() => dl(f)}>Download</button>
                          {manage && <button className="btn" onClick={() => setShare(f)}>Share</button>}
                          {manage && <button className="btn danger ghost" onClick={() => del(f)}>Delete</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'members' && <Members roomId={roomId} members={members} owner={owner} me={user.id} onlineIds={onlineIds} reload={loadMembers} />}
      {share && <ShareDialog roomId={roomId} file={share} onClose={() => setShare(null)} />}
    </>
  );
}

function Members({ roomId, members, owner, me, onlineIds, reload }) {
  const { toast } = useApp();
  const [who, setWho] = useState('');
  const [role, setRole] = useState('viewer');
  const add = async (e) => {
    e.preventDefault();
    try {
      await api(`/rooms/${roomId}/members`, { method: 'POST', body: { identifier: who.trim(), role } });
      setWho(''); reload(); toast('Member added', 'ok');
    } catch (x) { toast(x.message, 'err'); }
  };
  const act = (fn) => async (...a) => { try { await fn(...a); reload(); } catch (x) { toast(x.message, 'err'); } };
  const setRoleOf = act((id, r) => api(`/rooms/${roomId}/members/${id}`, { method: 'PATCH', body: { role: r } }));
  const remove = act((id) => confirm('Remove this member?') && api(`/rooms/${roomId}/members/${id}`, { method: 'DELETE' }));
  return (
    <>
      {owner && (
        <form className="row card" onSubmit={add}>
          <input className="grow" required placeholder="Username or email of an existing user" value={who} onChange={(e) => setWho(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
          <button className="btn primary">Add member</button>
        </form>
      )}
      <div className="card flush">
        {members.map((m) => (
          <div key={uid(m)} className="row member">
            <span className={'av' + (onlineIds.has(uid(m)) ? ' on' : '')}>{(m.username || '?')[0].toUpperCase()}</span>
            <span className="grow">{m.username}{uid(m) === me && <span className="muted"> (you)</span>}</span>
            {owner && m.role !== 'owner' ? (
              <>
                <select value={m.role} onChange={(e) => setRoleOf(uid(m), e.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
                <button className="btn danger ghost" onClick={() => remove(uid(m))}>Remove</button>
              </>
            ) : <span className={'pill ' + m.role}>{m.role}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function ShareDialog({ roomId, file, onClose }) {
  const { toast } = useApp();
  const [links, setLinks] = useState([]);
  const [created, setCreated] = useState(null);
  const [f, setF] = useState({ expiresInMinutes: 60, maxDownloads: '', password: '' });
  const base = `/rooms/${roomId}/files/${file.id}/share-links`;
  const load = () => api(base).then((d) => setLinks(list(d, 'links'))).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const body = { expiresInMinutes: +f.expiresInMinutes };
    if (f.maxDownloads) body.maxDownloads = +f.maxDownloads;
    if (f.password) body.password = f.password;
    try {
      const d = await api(base, { method: 'POST', body });
      const key = d.key ?? d.shareKey ?? d.token;
      if (!key) throw new Error('The server did not return a share key');
      setCreated(`${location.origin}/s/${key}`); load();
    } catch (x) { toast(x.message, 'err'); }
  };
  const revoke = async (id) => {
    try { await api(`/rooms/${roomId}/share-links/${id}`, { method: 'DELETE' }); load(); toast('Link revoked', 'ok'); }
    catch (x) { toast(x.message, 'err'); }
  };
  const copy = () => navigator.clipboard.writeText(created).then(() => toast('Link copied', 'ok'));

  return (
    <Modal title={`Share “${fname(file)}”`} onClose={onClose}>
      {created ? (
        <div className="stack">
          <div className="alert warn">Copy this link now. For security it can’t be shown again.</div>
          <div className="row"><input className="grow mono" readOnly value={created} onFocus={(e) => e.target.select()} /><button className="btn primary" onClick={copy}>Copy</button></div>
          <button className="btn" onClick={() => setCreated(null)}>Create another</button>
        </div>
      ) : (
        <form className="stack" onSubmit={create}>
          <label>Expires after
            <select value={f.expiresInMinutes} onChange={(e) => setF({ ...f, expiresInMinutes: e.target.value })}>
              <option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={1440}>1 day</option><option value={10080}>7 days</option>
            </select>
          </label>
          <label>Max downloads (optional)<input type="number" min="1" value={f.maxDownloads} onChange={(e) => setF({ ...f, maxDownloads: e.target.value })} /></label>
          <label>Password (optional)<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <button className="btn primary">Create share link</button>
        </form>
      )}
      {links.length > 0 && (
        <>
          <h4>Active links</h4>
          {links.map((l) => (
            <div key={l.id} className="row member">
              <span className="grow muted">
                Expires {when(l.expiresAt)} · {l.downloadCount ?? 0}{l.maxDownloads ? `/${l.maxDownloads}` : ''} downloads{l.requiresPassword ? ' · password' : ''}
              </span>
              <button className="btn danger ghost" onClick={() => revoke(l.id)}>Revoke</button>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

function SharePage() {
  const { key } = useParams();
  const [meta, setMeta] = useState(null);
  const [bad, setBad] = useState(false);
  const [pw, setPw] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/s/${key}/meta`).then((d) => setMeta(d.file ?? d)).catch(() => setBad(true)); }, [key]);

  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await saveBlob(await api(`/s/${key}/download`, { method: 'POST', body: pw ? { password: pw } : {}, raw: true }), meta.name ?? 'file');
    } catch (x) {
      if (x.code === 'PASSWORD_REQUIRED' || x.code === 'INVALID_PASSWORD') setNeedPw(true);
      setErr(x.status === 404 ? 'This link is no longer available.' : x.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="center">
      <form className="card auth" onSubmit={go}>
        <h1>🔒 Privora</h1>
        {bad ? <div className="alert">This link is invalid, expired, or has been revoked.</div> : !meta ? <p className="muted">Checking link…</p> : (
          <>
            <p className="muted">Someone shared a file with you</p>
            <div className="filebox"><span className={'ficon ' + kind(meta.name)}>{(meta.name ?? '').split('.').pop().slice(0, 4).toUpperCase()}</span><b>{meta.name}</b><span className="muted">{fmt(meta.size)}</span></div>
            {(meta.requiresPassword || needPw) && <label>Password<input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
            {err && <div className="alert">{err}</div>}
            <button className="btn primary" disabled={busy}>{busy ? 'Preparing…' : 'Download'}</button>
          </>
        )}
      </form>
    </div>
  );
}

function Audit() {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState({ actor: '', action: '', from: '', to: '' });
  const load = (e) => {
    e?.preventDefault();
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    api('/admin/audit-logs?' + p).then((d) => setRows(list(d, 'logs'))).catch((x) => { toast(x.message, 'err'); setRows([]); });
  };
  useEffect(load, []);
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });
  return (
    <>
      <h2>Audit log</h2>
      <form className="row card wrapx" onSubmit={load}>
        <input placeholder="Actor" value={q.actor} onChange={set('actor')} />
        <input placeholder="Action (e.g. share.redeem)" value={q.action} onChange={set('action')} />
        <input type="date" value={q.from} onChange={set('from')} />
        <input type="date" value={q.to} onChange={set('to')} />
        <button className="btn primary">Filter</button>
      </form>
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="empty">No matching events.</div> : (
        <div className="card flush scroll">
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td className="muted">{when(r.createdAt ?? r.created_at)}</td>
                  <td>{r.actorUsername ?? r.actor ?? r.actorId ?? r.actor_id ?? '—'}</td>
                  <td><code>{r.action}</code> <span className={'pill ' + (r.outcome === 'success' ? 'editor' : 'denied')}>{r.outcome}</span></td>
                  <td className="muted mono">{r.metadata || r.details ? JSON.stringify(r.metadata ?? r.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}