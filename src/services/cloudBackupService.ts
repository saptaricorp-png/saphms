import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { firebaseAuth, firestoreDb, googleAuthProvider } from '../lib/firebase';
import type { LimsDatabase } from '../types/lims';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface CloudBackupCounts {
  patients: number;
  orders: number;
  pharmacyInvoices: number;
  opdVisits: number;
  ipdAdmissions: number;
  emergencyCases: number;
  services: number;
  medicines: number;
}

export interface CloudBackupSummary {
  id: string;
  ownerUid: string;
  label: string;
  hospitalName: string;
  fiscalYear: string;
  backupType: 'MANUAL' | 'AUTO_SYNC' | 'PRE_RESTORE';
  totalShards: number;
  counts: CloudBackupCounts;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface CloudSyncConfig {
  id: string;
  ownerUid: string;
  hospitalName: string;
  autoCloudBackupEnabled: boolean;
  backupIntervalMinutes: number;
  lastSyncedAt: string;
  lastBackupId: string;
}

const ADMIN_EMAIL = 'epusaan@gmail.com';

// Native recursive sanitizer so Firestore never receives undefined values (zero JSON.stringify usage)
function sanitizeForFirestore<T>(val: T): T {
  if (val === undefined) return null as unknown as T;
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = sanitizeForFirestore(v);
    }
  }
  return out as T;
}

export async function ensureUserProfile(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const ref = doc(firestoreDb, 'users', user.uid);
  const role = user.email === ADMIN_EMAIL && user.emailVerified ? 'admin' : 'hospital_operator';
  const displayName = (user.displayName || user.email || 'Hospital Operator').slice(0, 120);
  const email = (user.email || 'operator@saptarihospital.com').slice(0, 254);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function signInWithGoogleForBackup(): Promise<User> {
  const result = await signInWithPopup(firebaseAuth, googleAuthProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function signOutGoogleBackup(): Promise<void> {
  await signOut(firebaseAuth);
}

type SectionName = 'core' | 'patients' | 'orders' | 'pharmacy' | 'clinical' | 'finance' | 'catalog';

interface PendingShard {
  sectionName: SectionName;
  payload: {
    sectionKey: string;
    mapData?: Record<string, unknown>;
    listData?: Record<string, unknown>[];
  };
}

const ARRAY_SECTION_CONFIG: Array<{ key: keyof LimsDatabase; sectionName: SectionName }> = [
  { key: 'staff', sectionName: 'core' },
  { key: 'roles', sectionName: 'core' },
  { key: 'services', sectionName: 'catalog' },
  { key: 'analyzers', sectionName: 'catalog' },
  { key: 'radiologyTemplates', sectionName: 'catalog' },
  { key: 'reagents', sectionName: 'catalog' },
  { key: 'inventoryMovements', sectionName: 'catalog' },
  { key: 'storeRequisitions', sectionName: 'catalog' },
  { key: 'documentDesigns', sectionName: 'core' },
  { key: 'patients', sectionName: 'patients' },
  { key: 'orders', sectionName: 'orders' },
  { key: 'analyzerQueue', sectionName: 'orders' },
  { key: 'opdVisits', sectionName: 'clinical' },
  { key: 'ipdAdmissions', sectionName: 'clinical' },
  { key: 'emergencyCases', sectionName: 'clinical' },
  { key: 'otRooms', sectionName: 'clinical' },
  { key: 'otCases', sectionName: 'clinical' },
  { key: 'hospitalBeds', sectionName: 'clinical' },
  { key: 'gatepasses', sectionName: 'clinical' },
  { key: 'birthCertificates', sectionName: 'clinical' },
  { key: 'deathCertificates', sectionName: 'clinical' },
  { key: 'marketingVisits', sectionName: 'clinical' },
  { key: 'pharmacyMedicines', sectionName: 'pharmacy' },
  { key: 'pharmacyBatches', sectionName: 'pharmacy' },
  { key: 'pharmacyInvoices', sectionName: 'pharmacy' },
  { key: 'pharmacyDeposits', sectionName: 'pharmacy' },
  { key: 'pharmacyMovements', sectionName: 'pharmacy' },
  { key: 'pharmacySuppliers', sectionName: 'pharmacy' },
  { key: 'pharmacyManufacturers', sectionName: 'pharmacy' },
  { key: 'accounts', sectionName: 'finance' },
  { key: 'financialLedger', sectionName: 'finance' },
  { key: 'counterCloses', sectionName: 'finance' },
  { key: 'financeApprovalRequests', sectionName: 'finance' },
  { key: 'discountCreditApprovals', sectionName: 'finance' },
  { key: 'hospitalAssets', sectionName: 'finance' },
  { key: 'referrals', sectionName: 'finance' },
  { key: 'referralPayoutRequests', sectionName: 'finance' },
  { key: 'payrollRuns', sectionName: 'finance' },
  { key: 'dartaChalani', sectionName: 'core' },
  { key: 'dhis2Reports', sectionName: 'core' },
  { key: 'tenants', sectionName: 'core' },
  { key: 'auditLogs', sectionName: 'core' },
  { key: 'securityAlerts', sectionName: 'core' },
  { key: 'attendanceLogs', sectionName: 'core' },
  { key: 'shiftHandovers', sectionName: 'core' },
  { key: 'whatsappLogs', sectionName: 'core' },
  { key: 'emailNotifications', sectionName: 'core' },
  { key: 'apiDispatches', sectionName: 'core' },
];

export async function createCloudBackupSnapshot(
  dbSnapshot: LimsDatabase,
  label: string,
  backupType: 'MANUAL' | 'AUTO_SYNC' | 'PRE_RESTORE' = 'MANUAL'
): Promise<CloudBackupSummary> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('Sign in with Google Backup Account before saving a cloud snapshot.');
  }
  await ensureUserProfile(user);

  const backupId = `bkp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const shards: PendingShard[] = [
    {
      sectionName: 'core',
      payload: {
        sectionKey: '__settings_saas',
        mapData: sanitizeForFirestore({
          settings: dbSnapshot.settings,
          saas: dbSnapshot.saas,
          dashboardLayoutConfigs: dbSnapshot.dashboardLayoutConfigs || {},
          fiscalYear: dbSnapshot.settings?.activeFiscalYear || 'FY 2083/84',
        }) as Record<string, unknown>,
      },
    },
  ];

  // Chunk each database array cleanly into bounded shards (max 45 items per shard -> safe < 1MB)
  const CHUNK_SIZE = 45;
  for (const { key, sectionName } of ARRAY_SECTION_CONFIG) {
    const arr = dbSnapshot[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (let idx = 0; idx < arr.length; idx += CHUNK_SIZE) {
      const slice = arr.slice(idx, idx + CHUNK_SIZE);
      shards.push({
        sectionName,
        payload: {
          sectionKey: String(key),
          listData: sanitizeForFirestore(slice) as unknown as Record<string, unknown>[],
        },
      });
    }
  }

  const counts: CloudBackupCounts = {
    patients: (dbSnapshot.patients || []).length,
    orders: (dbSnapshot.orders || []).length,
    pharmacyInvoices: (dbSnapshot.pharmacyInvoices || []).length,
    opdVisits: (dbSnapshot.opdVisits || []).length,
    ipdAdmissions: (dbSnapshot.ipdAdmissions || []).length,
    emergencyCases: (dbSnapshot.emergencyCases || []).length,
    services: (dbSnapshot.services || []).length,
    medicines: (dbSnapshot.pharmacyMedicines || []).length,
  };

  const cleanLabel = (label || `Hospital Snapshot (${new Date().toLocaleDateString()})`).slice(0, 160);
  const hospitalName = (dbSnapshot.settings?.labName || 'Saptari Hospital Pvt Ltd').slice(0, 160);
  const fiscalYear = (dbSnapshot.settings?.activeFiscalYear || 'FY 2083/84').slice(0, 40);

  const parentPath = `backups/${backupId}`;
  try {
    await setDoc(doc(firestoreDb, 'backups', backupId), {
      id: backupId,
      ownerUid: user.uid,
      label: cleanLabel,
      hospitalName,
      fiscalYear,
      backupType,
      totalShards: shards.length,
      counts,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, parentPath);
  }

  // Write bounded shard documents in batches of 20
  const BATCH_LIMIT = 20;
  for (let start = 0; start < shards.length; start += BATCH_LIMIT) {
    const batch = writeBatch(firestoreDb);
    const slice = shards.slice(start, start + BATCH_LIMIT);
    slice.forEach((s, offset) => {
      const shardIdx = start + offset;
      const shardId = `shd_${String(shardIdx).padStart(4, '0')}`;
      batch.set(doc(firestoreDb, 'backups', backupId, 'shards', shardId), {
        id: shardId,
        backupId,
        ownerUid: user.uid,
        sectionName: s.sectionName,
        shardIndex: shardIdx,
        totalShards: shards.length,
        payload: s.payload,
        createdAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `backups/${backupId}/shards`);
    }
  }

  // Update syncState preference
  const syncPath = `syncState/${user.uid}`;
  try {
    const syncRef = doc(firestoreDb, 'syncState', user.uid);
    const existingSync = await getDoc(syncRef);
    const prevData = existingSync.exists() ? existingSync.data() : null;
    await setDoc(syncRef, {
      id: user.uid,
      ownerUid: user.uid,
      hospitalName,
      autoCloudBackupEnabled: prevData?.autoCloudBackupEnabled ?? false,
      backupIntervalMinutes: prevData?.backupIntervalMinutes ?? 10,
      lastSyncedAt: new Date().toISOString(),
      lastBackupId: backupId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, syncPath);
  }

  return {
    id: backupId,
    ownerUid: user.uid,
    label: cleanLabel,
    hospitalName,
    fiscalYear,
    backupType,
    totalShards: shards.length,
    counts,
  };
}

export function subscribeCloudBackups(
  user: User,
  onData: (items: CloudBackupSummary[]) => void,
  onError: (err: Error) => void
): () => void {
  const isAdmin = user.email === ADMIN_EMAIL && user.emailVerified;
  const colRef = collection(firestoreDb, 'backups');
  const q = isAdmin
    ? query(colRef, orderBy('createdAt', 'desc'))
    : query(colRef, where('ownerUid', '==', user.uid), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as CloudBackupSummary);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'backups');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function restoreCloudBackupSnapshot(backupId: string): Promise<LimsDatabase> {
  const shardsPath = `backups/${backupId}/shards`;
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Google sign-in required to restore cloud backup.');

  const isAdmin = user.email === ADMIN_EMAIL && user.emailVerified;
  const shardsCol = collection(firestoreDb, 'backups', backupId, 'shards');
  const q = isAdmin
    ? query(shardsCol, orderBy('shardIndex', 'asc'))
    : query(shardsCol, where('ownerUid', '==', user.uid), orderBy('shardIndex', 'asc'));

  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, shardsPath);
  }

  const reconstructed: Record<string, unknown> = {
    patients: [],
    orders: [],
    analyzers: [],
    analyzerQueue: [],
    staff: [],
    roles: [],
    services: [],
    radiologyTemplates: [],
    reagents: [],
    inventoryMovements: [],
    storeRequisitions: [],
    documentDesigns: [],
    opdVisits: [],
    ipdAdmissions: [],
    emergencyCases: [],
    otRooms: [],
    otCases: [],
    hospitalBeds: [],
    gatepasses: [],
    birthCertificates: [],
    deathCertificates: [],
    marketingVisits: [],
    pharmacyMedicines: [],
    pharmacyBatches: [],
    pharmacyInvoices: [],
    pharmacyDeposits: [],
    pharmacyMovements: [],
    pharmacySuppliers: [],
    pharmacyManufacturers: [],
    accounts: [],
    financialLedger: [],
    counterCloses: [],
    financeApprovalRequests: [],
    discountCreditApprovals: [],
    hospitalAssets: [],
    referrals: [],
    referralPayoutRequests: [],
    payrollRuns: [],
    dartaChalani: [],
    dhis2Reports: [],
    tenants: [],
    auditLogs: [],
    securityAlerts: [],
    attendanceLogs: [],
    shiftHandovers: [],
    whatsappLogs: [],
    emailNotifications: [],
    apiDispatches: [],
    centers: [],
    centerAwards: [],
    riders: [],
    riderTasks: [],
  };

  for (const docSnap of snap.docs) {
    const shardData = docSnap.data();
    const payload = shardData?.payload as {
      sectionKey?: string;
      mapData?: Record<string, unknown>;
      listData?: Record<string, unknown>[];
    };
    if (!payload?.sectionKey) continue;
    if (payload.sectionKey === '__settings_saas' && payload.mapData) {
      reconstructed.settings = payload.mapData.settings;
      reconstructed.saas = payload.mapData.saas;
      reconstructed.dashboardLayoutConfigs = payload.mapData.dashboardLayoutConfigs;
    } else if (Array.isArray(payload.listData)) {
      const existingArr = Array.isArray(reconstructed[payload.sectionKey])
        ? (reconstructed[payload.sectionKey] as unknown[])
        : [];
      reconstructed[payload.sectionKey] = [...existingArr, ...payload.listData];
    }
  }

  return reconstructed as unknown as LimsDatabase;
}

export async function deleteCloudBackupSnapshot(backupId: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Google sign-in required.');
  const isAdmin = user.email === ADMIN_EMAIL && user.emailVerified;
  const shardsCol = collection(firestoreDb, 'backups', backupId, 'shards');
  const q = isAdmin ? query(shardsCol) : query(shardsCol, where('ownerUid', '==', user.uid));

  try {
    const snap = await getDocs(q);
    for (let i = 0; i < snap.docs.length; i += 20) {
      const batch = writeBatch(firestoreDb);
      snap.docs.slice(i, i + 20).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(firestoreDb, 'backups', backupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `backups/${backupId}`);
  }
}

export async function loadCloudSyncConfig(user: User): Promise<CloudSyncConfig | null> {
  const syncPath = `syncState/${user.uid}`;
  try {
    const snap = await getDoc(doc(firestoreDb, 'syncState', user.uid));
    return snap.exists() ? (snap.data() as CloudSyncConfig) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, syncPath);
  }
}

export async function saveCloudSyncConfig(
  user: User,
  params: {
    hospitalName: string;
    autoCloudBackupEnabled: boolean;
    backupIntervalMinutes: number;
    lastSyncedAt?: string;
    lastBackupId?: string;
  }
): Promise<CloudSyncConfig> {
  const syncPath = `syncState/${user.uid}`;
  const ref = doc(firestoreDb, 'syncState', user.uid);
  try {
    const existing = await getDoc(ref);
    const prev = existing.exists() ? existing.data() : null;
    const payload = {
      id: user.uid,
      ownerUid: user.uid,
      hospitalName: (params.hospitalName || 'Saptari Hospital Pvt Ltd').slice(0, 160),
      autoCloudBackupEnabled: Boolean(params.autoCloudBackupEnabled),
      backupIntervalMinutes: Math.max(1, Math.min(1440, Math.round(params.backupIntervalMinutes || 10))),
      lastSyncedAt: (params.lastSyncedAt ?? prev?.lastSyncedAt ?? '').slice(0, 64),
      lastBackupId: (params.lastBackupId ?? prev?.lastBackupId ?? '').slice(0, 128),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    return {
      id: payload.id,
      ownerUid: payload.ownerUid,
      hospitalName: payload.hospitalName,
      autoCloudBackupEnabled: payload.autoCloudBackupEnabled,
      backupIntervalMinutes: payload.backupIntervalMinutes,
      lastSyncedAt: payload.lastSyncedAt,
      lastBackupId: payload.lastBackupId,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, syncPath);
  }
}
