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
