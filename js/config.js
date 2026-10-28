// ==========================================================
//  НАСТРОЙКИ. Вставь сюда конфиг своего проекта Firebase
//  (Firebase Console → Project settings → Your apps → Web app → Config)
// ==========================================================
export const firebaseConfig = {
  apiKey: "ВСТАВЬ_СЮДА",
  authDomain: "ВСТАВЬ_СЮДА.firebaseapp.com",
  databaseURL: "https://ВСТАВЬ_СЮДА-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ВСТАВЬ_СЮДА",
  storageBucket: "ВСТАВЬ_СЮДА.appspot.com",
  messagingSenderId: "0",
  appId: "ВСТАВЬ_СЮДА"
};

// Размер поля. Максимум 200×100 (так ограничено в правилах базы).
export const W = 128;
export const H = 96;

// Кулдаун по умолчанию, пока админ не задал свой (мс)
export const DEFAULT_COOLDOWN = 5000;

export const PALETTE = [
  '#ffffff','#e4e4e4','#888888','#222222','#ffa7d1','#e50000','#e59500','#a06a42',
  '#e5d900','#94e044','#02be01','#00d3dd','#0083c7','#0000ea','#cf6ee4','#820080'
];

export const isConfigured = () => !firebaseConfig.apiKey.includes('ВСТАВЬ');
