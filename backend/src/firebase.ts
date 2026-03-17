import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

// Load backend/.env when present (Node.js built-in env-file loader).
process.loadEnvFile()

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[firebase] Missing required env var: ${name}`)
  }
  return value
}

const firebaseConfig = {
  apiKey: requireEnv('FIREBASE_API_KEY'),
  authDomain: requireEnv('FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv('FIREBASE_APP_ID'),
  measurementId: process.env['FIREBASE_MEASUREMENT_ID'],
}

export const firebaseApp = initializeApp(firebaseConfig)
export const db = getFirestore(firebaseApp)
