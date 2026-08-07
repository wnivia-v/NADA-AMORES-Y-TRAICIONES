// =============================================================================
// Internationalization — ES / EN
// All user-facing strings live here. Components must NOT hardcode language.
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
  video: string;
  localMode: string;
  localModeDesc: string;
  analyzeScreenshot: string;
  analyzeScreenshotDesc: string;
  scanning: string;
  active: string;
  inactive: string;
  totalScans: string;
  threatsToday: string;
  // Alerts
  alertsTitle: string;
  noAlerts: string;
  clearAlerts: string;
  exportCsv: string;
  tacticDetected: string;
  share: string;
  copied: string;
  copy: string;
  // Settings
  settingsTitle: string;
  theme: string;
  language: string;
  debugMode: string;
  aiProviders: string;
  multiAiStrategy: string;
  // Analysis
  analyzeBtn: string;
  analyzing: string;
  pasteText: string;
  startListening: string;
  stopListening: string;
  startCamera: string;
  stopCamera: string;
  cameraSourceLabel: string;
  cameraSourceOwn: string;
  cameraSourceCall: string;
  cameraSourceCallHint: string;
  noAudioForLipSync: string;
  deepfakeDetected: string;
  // Image analyzer
  uploadScreenshot: string;
  uploadScreenshotDesc: string;
  extractingOcr: string;
  notEnoughText: string;
  analyzingContent: string;
  analyzeImage: string;
  extractedText: string;
  // Voice
  liveAnalysis: string;
  fragments: string;
  voiceHearingYou: string;
  suspiciousPattern: string;
  transcript: string;
  transcriptPlaceholder: string;
  voiceShieldDesc: string;
  screenNeedsDesktop: string;
  tapToListen: string;
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
  video: 'Video',
  localMode: 'Modo local',
  localModeDesc: 'Sin IA conectada. Configura una API key en Ajustes para mejor deteccion.',
  analyzeScreenshot: 'Analizar captura',
  analyzeScreenshotDesc: 'Sube una imagen de WhatsApp, SMS o email',
  scanning: 'Escaneando...',
  active: 'Activo',
  inactive: 'Inactivo',
  totalScans: 'Escaneos totales',
  threatsToday: 'Amenazas hoy',
  alertsTitle: 'Historial de Alertas',
  noAlerts: 'Sin alertas. Estas a salvo.',
  clearAlerts: 'Limpiar historial',
  exportCsv: 'Exportar CSV',
  tacticDetected: 'Tactica detectada',
  share: 'Compartir',
  copied: 'Copiado',
  copy: 'Copiar',
  settingsTitle: 'Configuracion',
  theme: 'Tema',
  language: 'Idioma',
  debugMode: 'Modo tecnico',
  aiProviders: 'Proveedores de IA',
  multiAiStrategy: 'Estrategia multi-IA',
  analyzeBtn: 'Analizar',
  analyzing: 'Analizando...',
  pasteText: 'Pega aqui el texto sospechoso...',
  startListening: 'Iniciar escucha',
  stopListening: 'Detener',
  startCamera: 'Iniciar camara',
  stopCamera: 'Detener camara',
  cameraSourceLabel: 'Que queres analizar',
  cameraSourceOwn: 'Mi camara',
  cameraSourceCall: 'Videollamada',
  cameraSourceCallHint: 'Comparte la ventana o pestana de tu videollamada (Zoom, Meet, WhatsApp) para analizar a la otra persona',
  noAudioForLipSync: 'Sin audio: no se puede verificar la sincronia labial',
  deepfakeDetected: 'Posible deepfake detectado en videollamada',
  uploadScreenshot: 'Sube una captura de pantalla',
  uploadScreenshotDesc: 'Arrastra o haz clic — WhatsApp, Telegram, SMS, email',
  extractingOcr: 'Extrayendo texto con OCR...',
  notEnoughText: 'No se detecto texto suficiente.',
  analyzingContent: 'Analizando contenido...',
  analyzeImage: 'Analizar imagen',
  extractedText: 'Texto extraido:',
  liveAnalysis: 'Analisis en vivo',
  fragments: 'fragmentos',
  voiceHearingYou: 'Te estamos escuchando ahora',
  suspiciousPattern: 'Patron sospechoso detectado',
  transcript: 'Transcripcion:',
  transcriptPlaceholder: 'Escuchando... habla para ver el texto aqui en vivo.',
  voiceShieldDesc: 'Toca para escuchar tu llamada y detectar estafas en vivo',
  screenNeedsDesktop: 'Instala la app de escritorio (.exe) para vigilar tu pantalla completa',
  tapToListen: 'Toca para activar',
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
  video: 'Video',
  localMode: 'Local mode',
  localModeDesc: 'No AI connected. Set an API key in Settings for better detection.',
  analyzeScreenshot: 'Analyze screenshot',
  analyzeScreenshotDesc: 'Upload a WhatsApp, SMS or email image',
  scanning: 'Scanning...',
  active: 'Active',
  inactive: 'Inactive',
  totalScans: 'Total scans',
  threatsToday: 'Threats today',
  alertsTitle: 'Alert History',
  noAlerts: 'No alerts. You are safe.',
  clearAlerts: 'Clear history',
  exportCsv: 'Export CSV',
  tacticDetected: 'Detected tactic',
  share: 'Share',
  copied: 'Copied',
  copy: 'Copy',
  settingsTitle: 'Settings',
  theme: 'Theme',
  language: 'Language',
  debugMode: 'Technical mode',
  aiProviders: 'AI Providers',
  multiAiStrategy: 'Multi-AI Strategy',
  analyzeBtn: 'Analyze',
  analyzing: 'Analyzing...',
  pasteText: 'Paste suspicious text here...',
  startListening: 'Start listening',
  stopListening: 'Stop',
  startCamera: 'Start camera',
  stopCamera: 'Stop camera',
  cameraSourceLabel: 'What do you want to analyze',
  cameraSourceOwn: 'My camera',
  cameraSourceCall: 'Video call',
  cameraSourceCallHint: 'Share your video call window or tab (Zoom, Meet, WhatsApp) to analyze the other person',
  noAudioForLipSync: 'No audio: lip-sync cannot be verified',
  deepfakeDetected: 'Possible deepfake detected in video call',
  uploadScreenshot: 'Upload a screenshot',
  uploadScreenshotDesc: 'Drag or click — WhatsApp, Telegram, SMS, email',
  extractingOcr: 'Extracting text with OCR...',
  notEnoughText: 'Not enough text detected.',
  analyzingContent: 'Analyzing content...',
  analyzeImage: 'Analyze image',
  extractedText: 'Extracted text:',
  liveAnalysis: 'Live analysis',
  fragments: 'fragments',
  voiceHearingYou: 'We are hearing you right now',
  suspiciousPattern: 'Suspicious pattern detected',
  transcript: 'Transcript:',
  transcriptPlaceholder: 'Listening... speak to see the text appear here live.',
  voiceShieldDesc: 'Tap to listen to your call and detect scams in real time',
  screenNeedsDesktop: 'Install the desktop app (.exe) to monitor your full screen',
  tapToListen: 'Tap to activate',
  safe: 'Safe',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
  riskScore: 'Risk level',
  tactics: 'Detected tactics',
  recommendations: 'Recommendations',
};

export const translations: Record<'es' | 'en', TranslationSet> = { es, en };
