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
  // Feedback — "¿acerto?"
  feedbackQuestion: string;
  feedbackCorrect: string;
  feedbackWasLegit: string;
  feedbackWasScam: string;
  feedbackWhatHappened: string;
  feedbackNotePlaceholder: string;
  feedbackSend: string;
  feedbackSaved: string;
  feedbackFailed: string;
  // Consentimiento (§4.4)
  consentTitle: string;
  consentIntro: string;
  consentProtectionTitle: string;
  consentProtectionBody: string;
  consentReportsTitle: string;
  consentReportsBody: string;
  consentThirdParty: string;
  consentTelemetryTitle: string;
  consentTelemetryBody: string;
  consentAge: string;
  consentPrivacyNotice: string;
  consentAuthority: string;
  consentContinue: string;
  consentChangeLater: string;
  // Ajustes de privacidad
  privacyTitle: string;
  privacyReportsOn: string;
  privacyReportsOff: string;
  privacyStopSharing: string;
  privacyDeleteLocal: string;
  privacyDeleted: string;
  privacyRights: string;
  privacyRegion: string;
  privacyRetention: string;
  privacyRetentionNone: string;
  // Cuenta
  accountTitle: string;
  accountWhy: string;
  accountEmail: string;
  accountPassword: string;
  accountRegister: string;
  accountSignIn: string;
  accountSignOut: string;
  accountDelete: string;
  accountDeleted: string;
  accountHaveOne: string;
  accountNeedOne: string;
  accountCheckEmail: string;
  accountNotVerified: string;
  accountNeedsConsent: string;
  accountSendPending: string;
  accountSent: string;
  accountNothingPending: string;
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
  feedbackQuestion: '¿Acerto?',
  feedbackCorrect: 'Si',
  feedbackWasLegit: 'No, era legitimo',
  feedbackWasScam: 'No, era una estafa',
  feedbackWhatHappened: '¿Que paso?',
  feedbackNotePlaceholder: 'Cuentanos brevemente (opcional)',
  feedbackSend: 'Enviar',
  // Dice donde queda, no "gracias por enviarlo": hoy no se envia a ningun sitio.
  feedbackSaved: 'Guardado en este dispositivo. Gracias.',
  feedbackFailed: 'No se pudo guardar en este dispositivo.',
  consentTitle: 'Antes de empezar',
  consentIntro: 'NADA te avisa de señales de riesgo en tus conversaciones. No dice quien es un estafador: enseña indicadores y tu decides.',
  consentProtectionTitle: 'Analisis en tu dispositivo',
  consentProtectionBody: 'El analisis de camara y voz ocurre en tu movil y no sale de el. Ningun frame de video ni audio se envia ni se guarda, nunca.',
  consentReportsTitle: 'Ayudar a mejorar la deteccion (opcional)',
  consentReportsBody: 'Cuando marques que nos hemos equivocado, enviarnos ese caso para corregirlo. Puedes usar la app sin activarlo.',
  consentThirdParty: 'Incluye el texto analizado, que puede contener mensajes escritos por otras personas.',
  consentTelemetryTitle: 'Incluir datos de este aparato',
  consentTelemetryBody:
    'Plataforma, sistema, modelo y un numero aleatorio que identifica esta instalacion. El servidor anota ademas la IP de la conexion. Sirve solo para distinguir un fallo real de alguien mandando informacion falsa a mano, y se puede desactivar despues en Ajustes.',
  consentAge: 'Declaro que tengo al menos {age} años.',
  consentPrivacyNotice: 'Aviso de privacidad',
  consentAuthority: 'Autoridad de control: {authority}',
  consentContinue: 'Continuar',
  consentChangeLater: 'Puedes cambiarlo cuando quieras en Ajustes.',
  privacyTitle: 'Privacidad y datos',
  privacyReportsOn: 'Envio de reportes activado',
  privacyReportsOff: 'Envio de reportes desactivado',
  privacyStopSharing: 'Dejar de enviar reportes',
  privacyDeleteLocal: 'Borrar mis datos de este dispositivo',
  privacyDeleted: 'Borrado.',
  privacyRights: 'Ejercer tus derechos',
  privacyRegion: 'Region aplicada',
  privacyRetention: 'Historial conservado: {days} dias',
  privacyRetentionNone: 'El historial no se conserva entre sesiones',
  accountTitle: 'Cuenta',
  accountWhy: 'Solo hace falta para enviar reportes. La proteccion funciona igual sin registrarse. La cuenta existe para que nadie pueda mandar mil correcciones falsas y estropear la deteccion de todos.',
  accountEmail: 'Correo',
  accountPassword: 'Contraseña (minimo 10 caracteres)',
  accountRegister: 'Crear cuenta',
  accountSignIn: 'Entrar',
  accountSignOut: 'Salir',
  accountDelete: 'Borrar mi cuenta y mis reportes',
  accountDeleted: 'Cuenta y reportes borrados.',
  accountHaveOne: 'Ya tengo cuenta',
  accountNeedOne: 'No tengo cuenta',
  accountCheckEmail: 'Si el correo es valido, recibiras un enlace de verificacion.',
  accountNotVerified: 'Verifica tu correo para poder enviar reportes.',
  accountNeedsConsent: 'Activa el envio de reportes en Privacidad.',
  accountSendPending: 'Enviar reportes pendientes',
  accountSent: '{n} reporte(s) enviado(s).',
  accountNothingPending: 'No hay nada pendiente de enviar.',
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
  feedbackQuestion: 'Did we get it right?',
  feedbackCorrect: 'Yes',
  feedbackWasLegit: 'No, it was legitimate',
  feedbackWasScam: 'No, it was a scam',
  feedbackWhatHappened: 'What happened?',
  feedbackNotePlaceholder: 'Tell us briefly (optional)',
  feedbackSend: 'Send',
  feedbackSaved: 'Saved on this device. Thank you.',
  feedbackFailed: 'Could not save on this device.',
  consentTitle: 'Before we start',
  consentIntro: 'NADA flags risk signals in your conversations. It never says who is a scammer: it shows indicators and you decide.',
  consentProtectionTitle: 'Analysis on your device',
  consentProtectionBody: 'Camera and voice analysis happen on your phone and stay there. No video frame or audio is ever sent or stored.',
  consentReportsTitle: 'Help improve detection (optional)',
  consentReportsBody: 'When you mark that we got it wrong, send us that case so we can fix it. You can use the app without this.',
  consentThirdParty: 'This includes the analysed text, which may contain messages written by other people.',
  consentTelemetryTitle: 'Include this device data',
  consentTelemetryBody:
    'Platform, OS, model and a random number identifying this install. The server also records the connection IP. Used only to tell a real failure from someone feeding false information, and it can be turned off later in Settings.',
  consentAge: 'I declare that I am at least {age} years old.',
  consentPrivacyNotice: 'Privacy notice',
  consentAuthority: 'Supervisory authority: {authority}',
  consentContinue: 'Continue',
  consentChangeLater: 'You can change this any time in Settings.',
  privacyTitle: 'Privacy and data',
  privacyReportsOn: 'Report sharing is on',
  privacyReportsOff: 'Report sharing is off',
  privacyStopSharing: 'Stop sharing reports',
  privacyDeleteLocal: 'Delete my data from this device',
  privacyDeleted: 'Deleted.',
  privacyRights: 'Exercise your rights',
  privacyRegion: 'Applied region',
  privacyRetention: 'History kept for {days} days',
  privacyRetentionNone: 'History is not kept between sessions',
  accountTitle: 'Account',
  accountWhy: 'Only needed to send reports. Protection works the same without signing up. The account exists so nobody can send a thousand fake corrections and wreck detection for everyone.',
  accountEmail: 'Email',
  accountPassword: 'Password (at least 10 characters)',
  accountRegister: 'Create account',
  accountSignIn: 'Sign in',
  accountSignOut: 'Sign out',
  accountDelete: 'Delete my account and reports',
  accountDeleted: 'Account and reports deleted.',
  accountHaveOne: 'I already have an account',
  accountNeedOne: "I don't have an account",
  accountCheckEmail: 'If the email is valid, you will receive a verification link.',
  accountNotVerified: 'Verify your email to send reports.',
  accountNeedsConsent: 'Turn on report sharing in Privacy.',
  accountSendPending: 'Send pending reports',
  accountSent: '{n} report(s) sent.',
  accountNothingPending: 'Nothing pending.',
};

export const translations: Record<'es' | 'en', TranslationSet> = { es, en };
