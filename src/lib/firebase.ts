import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// CRITICAL: Pass firebaseConfig.firestoreDatabaseId so Firestore connects to the provisioned database instance
export const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

let connectionTested = false;

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
    connectionTested = true;
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    // Even permission-denied confirms live server reachability
    connectionTested = true;
    return true;
  }
}

export function hasVerifiedFirestoreConnection(): boolean {
  return connectionTested;
}
