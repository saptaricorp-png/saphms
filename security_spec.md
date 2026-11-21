# Security Specification — Saptari Hospital ERP Cloud Backup Vault

## 1. Data Invariants
1. **Identity Ownership**: Every `UserProfile`, `HospitalBackup`, `BackupShard`, and `HospitalSyncConfig` document belongs to a single verified `request.auth.uid` (`ownerUid == request.auth.uid`), with verified Admin override exclusively for `epusaan@gmail.com` (`email_verified == true`) or entries in `/admins/{uid}`.
2. **Master Gate Parent Integrity**: No `BackupShard` under `/backups/{backupId}/shards/{shardId}` may exist or be written unless the parent `/backups/{backupId}` document exists and is owned by `request.auth.uid`.
3. **Immutable Ownership & Temporal Integrity**: `ownerUid`, `uid`, `id`, `backupId`, and `createdAt` can never be reassigned after creation; all `createdAt` and `updatedAt` timestamps must strictly equal `request.time`.
4. **No Shadow Fields / Size Bounding**: Every collection strictly enforces `keys().hasAll(...)` + `keys().hasOnly(...)`, `.size()` limits on all strings, and bounded shard arrays (`<= 100` items per shard).
5. **PII & List Isolation**: `/users/{userId}` forbids blanket `list` access for non-admins; `allow list` on `/backups` and `/backups/{backupId}/shards` strictly checks `resource.data.ownerUid == request.auth.uid || isAdmin()`.

## 2. Adversarial "Dirty Dozen" Rejection Payloads
1. **Identity Spoofing on User Create**: `{ uid: "victim-uid", email: "a@b.com", displayName: "Attacker", role: "hospital_operator", createdAt: serverTime, updatedAt: serverTime }` → `PERMISSION_DENIED` (`uid != request.auth.uid`).
2. **Privilege Self-Escalation on User Create**: `{ uid: auth.uid, email: "x@y.com", displayName: "X", role: "admin", ... }` → `PERMISSION_DENIED` (`role != 'hospital_operator'` when not admin).
3. **Role Mutation on User Update**: Updating `['role']` on `/users/{auth.uid}` as non-admin → `PERMISSION_DENIED` (`affectedKeys().hasOnly(['displayName', 'updatedAt'])`).
4. **Unverified Email Write**: Authenticated token with `email_verified: false` creating `/backups/{id}` → `PERMISSION_DENIED`.
5. **Admin Email Spoof without Verification**: Token with `email: "epusaan@gmail.com"` and `email_verified: false` reading another user's `/users/{otherUid}` → `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: Creating `/backups/{id}` with extra field `isOfficial: true` → `PERMISSION_DENIED` (`hasOnly` rejection).
7. **Orphaned Shard Creation**: Creating `/backups/missing-parent/shards/s1` when parent does not exist → `PERMISSION_DENIED` (`exists()` parent gate failure).
8. **ID Poisoning**: Creating `/backups/a..$invalid` or 500-char ID → `PERMISSION_DENIED` (`isValidId()` regex + length failure).
9. **Timestamp Forgery**: Creating `/backups/{id}` with client backdated `createdAt` instead of `request.time` → `PERMISSION_DENIED`.
10. **Owner Hijack on Update**: Updating `ownerUid` or `createdAt` on `/backups/{id}` → `PERMISSION_DENIED`.
11. **Oversized Array Denial-of-Wallet**: Creating `/backups/{id}/shards/{s}` with `payload.listData` length `> 100` → `PERMISSION_DENIED`.
12. **Blanket List Query Scraping**: Listing `/backups` without filtering to `ownerUid == request.auth.uid` as non-admin → `PERMISSION_DENIED`.
