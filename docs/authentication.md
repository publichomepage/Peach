# Authentication Setup

Public Homepage integrates with the **Public Homepage Auth Service** to provide secure, ephemeral, and cryptographic token management. This service is designed for short-lived access tokens and "Omens" (encrypted stored messages). Be an alchemist and share love by sharing your omens https://auth.publichome.page/omen

## 🚀 Key Endpoints

The Authentication Service is available at `https://auth.publichome.page`. All requests should be sent to this base URL.

### 1. Create Token / Omen (`POST /auth/token`)
Generates a short-lived access token or encrypts a message for temporary storage.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `identifier` | string | Yes | Unique user ID or Sigil. |
| `message` | string | No | Content to encrypt and store temporarily. |
| `ttl` | number | No | Time-to-live in seconds (default: 86400). |
| `nonce` | string | No | Custom key for extra security (OTP). |

**Response:**
```json
{
  "access_token": "...",
  "nonce": "...",
  "expiry": "2026-04-17T20:00:00Z"
}
```

### 2. Validate Token (`POST /auth/tokeninfo`)
Validates an existing access token and retrieves its payload to verify identity.

**Parameters:** `access_token` (string, required).

### 3. Retrieve Omen (`GET /auth/omen?id=<nonce>`)
Retrieves a stored encrypted message using its unique nonce ID. Once retrieved, the Omen is often configured for single-use deletion.

### 4. Delete Omen (`DELETE /auth/omen?id=<nonce>`)
Permanently removes a stored Omen from the service.

## 🔑 Configuration & Integration

### OAuth Provider
The service integrates with **GitHub** for identity verification. When performing OAuth flows, ensure you request the `public_repo` scope if your application needs to interact with user repositories.

## 🔒 Security Best Practices
- Always use **HTTPS** for all API calls.
- Short-lived tokens (TTL < 3600s) are recommended for sensitive operations.
- Store nonces securely and never expose them in client-side logs.
