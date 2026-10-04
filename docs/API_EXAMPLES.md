# Privora API Examples & Integration Contract

This document provides sample requests and responses for all implemented endpoints. Ashutosh (Part 2: Frontend) can use these frozen contracts for client typing and MSW mock integration.

All responses use standard HTTP status codes and JSON formatting.
Standard error shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error description"
  }
}
```

---

## 1. Authentication (`/api/auth`)

### 1.1 Register User
- **Method:** `POST /api/auth/register`
- **Auth:** None
- **Request Body:**
```json
{
  "email": "alice@example.com",
  "username": "alice_vault",
  "password": "CorrectHorseBatteryStaple!2026"
}
```
- **Response `201 Created`:**
```json
{
  "user": {
    "id": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "email": "alice@example.com",
    "username": "alice_vault",
    "globalRole": "user",
    "createdAt": "2026-10-04T02:00:00.000Z"
  }
}
```

---

### 1.2 Login
- **Method:** `POST /api/auth/login`
- **Auth:** None
- **Request Body:**
```json
{
  "identifier": "alice@example.com",
  "password": "CorrectHorseBatteryStaple!2026"
}
```
- **Response `200 OK`:**
  - **Set-Cookie:** `privora_refresh_token=<opaque_token>; Path=/api/auth; HttpOnly; SameSite=Strict; Secure`
```json
{
  "user": {
    "id": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "email": "alice@example.com",
    "username": "alice_vault",
    "globalRole": "user"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 1.3 Refresh Access Token
- **Method:** `POST /api/auth/refresh`
- **Auth:** `privora_refresh_token` Cookie
- **Headers:** `X-Requested-With: XMLHttpRequest`
- **Response `200 OK`:**
  - **Set-Cookie:** `privora_refresh_token=<new_rotated_opaque_token>; ...`
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 1.4 Logout
- **Method:** `POST /api/auth/logout`
- **Auth:** `privora_refresh_token` Cookie
- **Headers:** `X-Requested-With: XMLHttpRequest`
- **Response `200 OK`:**
  - **Set-Cookie:** `privora_refresh_token=; Max-Age=0; Path=/api/auth; ...`
```json
{
  "message": "Logged out successfully"
}
```

---

### 1.5 Get Current User Profile
- **Method:** `GET /api/auth/me`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response `200 OK`:**
```json
{
  "user": {
    "id": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "email": "alice@example.com",
    "username": "alice_vault",
    "globalRole": "user",
    "createdAt": "2026-10-04T02:00:00.000Z",
    "lastLoginAt": "2026-10-04T02:05:00.000Z"
  }
}
```

---

## 2. Rooms & Memberships (`/api/rooms`)

### 2.1 Create Room
- **Method:** `POST /api/rooms`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Request Body:**
```json
{
  "name": "Project Alpha Vault"
}
```
- **Response `201 Created`:**
```json
{
  "room": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Project Alpha Vault",
    "ownerId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "createdAt": "2026-10-04T02:10:00.000Z"
  }
}
```

---

### 2.2 List User Rooms
- **Method:** `GET /api/rooms`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Response `200 OK`:**
```json
{
  "rooms": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "name": "Project Alpha Vault",
      "ownerId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
      "createdAt": "2026-10-04T02:10:00.000Z",
      "role": "owner",
      "joinedAt": "2026-10-04T02:10:00.000Z"
    }
  ]
}
```

---

### 2.3 Get Room Details
- **Method:** `GET /api/rooms/:roomId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `viewer` (non-members receive `404 Not Found`)
- **Response `200 OK`:**
```json
{
  "room": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Project Alpha Vault",
    "ownerId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "createdAt": "2026-10-04T02:10:00.000Z",
    "role": "owner",
    "joinedAt": "2026-10-04T02:10:00.000Z"
  }
}
```

---

### 2.4 Delete Room
- **Method:** `DELETE /api/rooms/:roomId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner`
- **Response `200 OK`:**
```json
{
  "message": "Room deleted successfully"
}
```

---

### 2.5 List Room Members
- **Method:** `GET /api/rooms/:roomId/members`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `viewer`
- **Response `200 OK`:**
```json
{
  "members": [
    {
      "userId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
      "username": "alice_vault",
      "email": "alice@example.com",
      "role": "owner",
      "joinedAt": "2026-10-04T02:10:00.000Z",
      "addedBy": "c85d7747-814f-4d37-8f5b-b9fb75630324"
    },
    {
      "userId": "e4f8d9b1-7a2e-4b9c-8d1e-3f5a7b9c1d3e",
      "username": "bob_editor",
      "email": "bob@example.com",
      "role": "editor",
      "joinedAt": "2026-10-04T02:15:00.000Z",
      "addedBy": "c85d7747-814f-4d37-8f5b-b9fb75630324"
    }
  ]
}
```

---

### 2.6 Add Member to Room
- **Method:** `POST /api/rooms/:roomId/members`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner`
- **Request Body:**
```json
{
  "identifier": "bob@example.com",
  "role": "editor"
}
```
- **Response `201 Created`:**
```json
{
  "member": {
    "userId": "e4f8d9b1-7a2e-4b9c-8d1e-3f5a7b9c1d3e",
    "username": "bob_editor",
    "email": "bob@example.com",
    "role": "editor",
    "joinedAt": "2026-10-04T02:15:00.000Z"
  }
}
```

---

### 2.7 Update Member Role
- **Method:** `PATCH /api/rooms/:roomId/members/:userId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner`
- **Request Body:**
```json
{
  "role": "viewer"
}
```
- **Response `200 OK`:**
```json
{
  "member": {
    "userId": "e4f8d9b1-7a2e-4b9c-8d1e-3f5a7b9c1d3e",
    "role": "viewer"
  }
}
```

---

### 2.8 Remove Member or Leave Room
- **Method:** `DELETE /api/rooms/:roomId/members/:userId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner` (can remove anyone except owner) or `viewer` (can remove self to leave room)
- **Response `200 OK`:**
```json
{
  "message": "Member removed successfully"
}
```

---

## 3. Files Pipeline (`/api/rooms/:roomId/files`)

### 3.1 Upload File
- **Method:** `POST /api/rooms/:roomId/files`
- **Headers:** `Authorization: Bearer <accessToken>`, `Content-Type: multipart/form-data`
- **Min Role:** `editor`
- **Body:** `file` (binary, max 25 MB)
- **Response `201 Created`:**
```json
{
  "file": {
    "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "name": "annual_financial_report.pdf",
    "size": 1048576,
    "detectedType": "application/pdf",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "uploaderId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
    "createdAt": "2026-10-04T02:20:00.000Z"
  }
}
```

---

### 3.2 List Room Files
- **Method:** `GET /api/rooms/:roomId/files`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `viewer`
- **Response `200 OK`:**
```json
{
  "files": [
    {
      "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "annual_financial_report.pdf",
      "size": 1048576,
      "detectedType": "application/pdf",
      "uploaderId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
      "uploaderUsername": "alice_vault",
      "createdAt": "2026-10-04T02:20:00.000Z"
    }
  ]
}
```

---

### 3.3 Download File
- **Method:** `GET /api/rooms/:roomId/files/:fileId/download`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `viewer`
- **Response `200 OK`:**
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename*=UTF-8''annual_financial_report.pdf`
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: no-store`
  - Binary file stream body.

---

### 3.4 Delete File
- **Method:** `DELETE /api/rooms/:roomId/files/:fileId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner` (any file) or `editor` (own file only)
- **Response `200 OK`:**
```json
{
  "message": "File deleted successfully"
}
```

---

## 4. Secure Share Links (`/api/rooms/:roomId/files/:fileId/share-links` & `/api/s/:key`)

### 4.1 Create Share Link
- **Method:** `POST /api/rooms/:roomId/files/:fileId/share-links`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `editor`
- **Request Body:**
```json
{
  "expiresInMinutes": 60,
  "maxDownloads": 5,
  "password": "optional_link_password"
}
```
- **Response `201 Created`:**
```json
{
  "shareLink": {
    "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
    "key": "pk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "shareUrl": "/s/pk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "expiresAt": "2026-10-04T03:20:00.000Z",
    "maxDownloads": 5,
    "downloadCount": 0,
    "hasPassword": true,
    "createdAt": "2026-10-04T02:20:00.000Z"
  }
}
```
*(Note: `key` and `shareUrl` are only returned once upon creation! Only the argon2id hash is stored.)*

---

### 4.2 List Share Links for File
- **Method:** `GET /api/rooms/:roomId/files/:fileId/share-links`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `editor`
- **Response `200 OK`:**
```json
{
  "shareLinks": [
    {
      "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
      "fileId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "creatorId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
      "creatorUsername": "alice_vault",
      "expiresAt": "2026-10-04T03:20:00.000Z",
      "maxDownloads": 5,
      "downloadCount": 1,
      "hasPassword": true,
      "revokedAt": null,
      "createdAt": "2026-10-04T02:20:00.000Z"
    }
  ]
}
```

---

### 4.3 Revoke Share Link
- **Method:** `DELETE /api/rooms/:roomId/share-links/:linkId`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Min Role:** `owner` (any link) or `editor` (own link only)
- **Response `200 OK`:**
```json
{
  "message": "Share link revoked successfully"
}
```

---

### 4.4 Get Public Share File Metadata
- **Method:** `GET /api/s/:key/meta`
- **Auth:** None (Public)
- **Rate Limit:** 30 req / 10 min per IP
- **Response `200 OK`:**
```json
{
  "file": {
    "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    "name": "annual_financial_report.pdf",
    "size": 1048576,
    "detectedType": "application/pdf",
    "hasPassword": true,
    "expiresAt": "2026-10-04T03:20:00.000Z",
    "downloadsRemaining": 4
  }
}
```
*(Returns `404 Not Found` uniformly if expired, revoked, max downloads exceeded, or invalid key)*

---

### 4.5 Download Shared File
- **Method:** `POST /api/s/:key/download`
- **Auth:** None (Public)
- **Rate Limit:** 30 req / 10 min per IP
- **Request Body (if password protected):**
```json
{
  "password": "optional_link_password"
}
```
- **Response `200 OK`:**
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename*=UTF-8''annual_financial_report.pdf`
  - `X-Content-Type-Options: nosniff`
  - `Cache-Control: no-store`
  - Binary file stream body.
*(Returns `404 Not Found` if expired/revoked/invalid, `401 Unauthorized` if invalid password)*

---

## 5. Admin & Audit Logs (`/api/admin`)

### 5.1 Query Audit Logs
- **Method:** `GET /api/admin/audit-logs`
- **Headers:** `Authorization: Bearer <accessToken>` (Must have `globalRole === 'admin'`)
- **Query Params:**
  - `actor`: UUID filter for actor ID
  - `action`: Filter by action pattern (e.g. `auth.`, `file.`, `share.`)
  - `outcome`: `success` | `denied` | `failure`
  - `from`: ISO timestamp start range
  - `to`: ISO timestamp end range
  - `limit`: Number of records (1-200, default 50)
  - `offset`: Pagination offset (default 0)
- **Response `200 OK`:**
```json
{
  "logs": [
    {
      "id": "e1f2a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b",
      "ts": "2026-10-04T02:22:00.000Z",
      "actorId": "c85d7747-814f-4d37-8f5b-b9fb75630324",
      "action": "file.upload",
      "targetType": "file",
      "targetId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "roomId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "outcome": "success",
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0 ...",
      "metadata": {
        "fileName": "annual_financial_report.pdf",
        "fileSize": 1048576,
        "mime": "application/pdf"
      }
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

---

### 5.2 Lock / Unlock User Account
- **Method:** `PATCH /api/admin/users/:userId/lock`
- **Headers:** `Authorization: Bearer <accessToken>` (Must have `globalRole === 'admin'`)
- **Request Body (Lock):**
```json
{
  "locked": true,
  "durationMinutes": 1440,
  "reason": "Suspicious brute force activity detected"
}
```
- **Response `200 OK`:**
```json
{
  "message": "User account locked successfully",
  "user": {
    "id": "e4f8d9b1-7a2e-4b9c-8d1e-3f5a7b9c1d3e",
    "username": "bob_editor",
    "email": "bob@example.com",
    "lockedUntil": "2026-10-05T02:25:00.000Z",
    "failedLoginCount": 0
  }
}
```
*(Locking revokes all active sessions for that user immediately and emits a `session:revoked` event).*

