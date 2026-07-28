// =============================================================================
// Internationalization — ES / EN
// =============================================================================

export interface TranslationSet {
  // Tabs
  tabHome: string;
  tabAlerts: string;
  tabSettings: string;
  // Home
  homeTitle: string;
  homeSubtitle: string;
  protectionOn: string;
  protectionOff: string;
  activateProtection: string;
  deactivateProtection: string;
  shields: string;
  clipboard: string;
  screen: string;
  voice: string;
  // Alerts
  alertsTitle: string;
  noAlerts: string;
  clearAlerts: string;
  // Settings
  settingsTitle: string;
  theme: string;
  language: string;
  debugMode: string;
  // Analysis
  analyzeBtn: string;
  analyzing: string;
  pasteText: string;
  startListening: string;
  stopListening: string;
  startCamera: string;
  stopCamera: string;
  // Results
  safe: string;
  suspicious: string;
  dangerous: string;
  riskScore: string;
  tactics: string;
  recommendations: string;
}

const es: TranslationSet = {
  tabHome: 'Inicio',
  tabAlerts: 'Alertas',
  tabSettings: 'Ajustes',
  homeTitle: 'NADA te protege',
  homeSubtitle: 'Deteccion de fraude en tiempo real con IA',
  protectionOn: 'Proteccion activa',
  protectionOff: 'Proteccion inactiva',
  activateProtection: 'Activar Proteccion',
  deactivateProtection: 'Desactivar',
  shields: 'Escudos',
  clipboard: 'Portapapeles',
  screen: 'Pantalla',
  voice: 'Voz',
  alertsTitle: 'Historial de Alertas',
  noAlerts: 'Sin alertas. Estas seguro/a.',
  clearAlerts: 'Limpiar historial',
  settingsTitle: 'Configuracion',
  theme: 'Tema',
  language: 'Idioma',
  debugMode: 'Modo tecnico',
  analyzeBtn: 'Analizar',
  analyzing: 'Analizando...',
  pasteText: 'Pega aqui el texto sospechoso...',
  startListening: 'Iniciar escucha',
  stopListening: 'Detener',
  startCamera: 'Iniciar camara',
  stopCamera: 'Detener camara',
  safe: 'Seguro',
  suspicious: 'Sospechoso',
  dangerous: 'Peligroso',
  riskScore: 'Nivel de riesgo',
  tactics: 'Tacticas detectadas',
  recommendations: 'Recomendaciones',
};

const en: TranslationSet = {
  tabHome: 'Home',
  tabAlerts: 'Alerts',
  tabSettings: 'Settings',
  homeTitle: 'NADA protects you',
  homeSubtitle: 'Real-time AI fraud detection',
  protectionOn: 'Protection active',
  protectionOff: 'Protection inactive',
  activateProtection: 'Activate Protection',
  deactivateProtection: 'Deactivate',
  shields: 'Shields',
  clipboard: 'Clipboard',
  screen: 'Screen',
  voice: 'Voice',
  alertsTitle: 'Alert History',
  noAlerts: 'No alerts. You are safe.',
  clearAlerts: 'Clear history',
  settingsTitle: 'Settings',
  theme: 'Theme',
  language: 'Language',
  debugMode: 'Technical mode',
  analyzeBtn: 'Analyze',
  analyzing: 'Analyzing...',
  pasteText: 'Paste suspicious text here...',
  startListening: 'Start listening',
  stopListening: 'Stop',
  startCamera: 'Start camera',
  stopCamera: 'Stop camera',
  safe: 'Safe',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
  riskScore: 'Risk level',
  tactics: 'Detected tactics',
  recommendations: 'Recommendations',
};

export const translations: Record<'es' | 'en', TranslationSet> = { es, en };
