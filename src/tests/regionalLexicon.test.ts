import { describe, it, expect } from 'vitest';

import { scanLocalPatterns } from '@/utils/scamPatterns';

const score = (text: string, region?: 'es' | 'mx' | 'ar' | '*') =>
  scanLocalPatterns(text, region ? { region } : {}).riskScore;

describe('familias documentadas por INCIBE', () => {
  // La capa regex fallaba 11 de 11 casos INCIBE del corpus, puntuando entre 0 y
  // 29 sobre un umbral de 70: el lexico cubria amenazas entre personas y apenas
  // la suplantacion institucional, que es la mitad del fraude que se denuncia.
  it.each([
    [
      'smishing bancario con cargo falso',
      'Cargo por 2890 EUR pre-aprobado. Si no ha sido usted verifique inmediatamente aqui: https://bbva-seguridad.top/verificar',
    ],
    [
      'paqueteria',
      'Correos: Su paquete no ha podido ser entregado. Confirme sus datos y pague los gastos de envio en: https://correos-reenvio.xyz/pago',
    ],
    [
      'multa de trafico',
      'DGT: Tiene una multa de trafico pendiente de 35 euros. Ultimo dia para pagarla sin recargo: https://dgt-multas.top/pago',
    ],
    [
      'familiar en apuros',
      'Hola mama, se me rompio el movil y este es mi numero nuevo. Necesitaria que me envies dinero urgente.',
    ],
    [
      'empleo falso con fianza por adelantado',
      'Oferta de trabajo: necesitamos socorristas, sueldo 2400/mes. Para formalizar la reserva de plaza envie 150 euros de fianza. Se devuelve el primer dia.',
    ],
    [
      'cambio de cuenta bancaria',
      'Estimado proveedor, hemos cambiado nuestra cuenta bancaria. A partir de hoy todos los pagos deben realizarse a la nueva cuenta: ES91 2100 0418 4502 0005 1332',
    ],
    [
      'foto del DNI y de la tarjeta',
      'Para validar tu registro necesitamos una selfie sosteniendo tu DNI y una foto de tu tarjeta por ambos lados. Es solo un tramite de seguridad.',
    ],
  ])('detecta: %s', (_nombre, texto) => {
    expect(score(texto)).toBeGreaterThanOrEqual(70);
  });

  it('el enlace es la señal mas solida de la familia', () => {
    // Un TLD de los que se usan para fraude aparece en los once casos INCIBE.
    const conEnlace = score('Su cuenta sera bloqueada. Active aqui: https://santander-online.xyz/activar');
    const sinEnlace = score('Su cuenta sera bloqueada. Active el nuevo sistema de seguridad.');
    expect(conEnlace).toBeGreaterThan(sinEnlace);
  });
});

describe('el contexto pesa mas que la palabra suelta', () => {
  it('nombrar una entidad no basta', () => {
    expect(score('Mañana paso por el BBVA a sacar dinero')).toBeLessThan(40);
    expect(score('Correos me ha dejado un aviso en el buzon')).toBeLessThan(40);
  });

  it('un enlace corriente tampoco', () => {
    expect(score('Mira esta receta: https://cocina-facil.es/tortilla')).toBeLessThan(40);
  });

  it('pero entidad + suceso + prisa + enlace juntos si', () => {
    expect(
      score(
        'CaixaBank: se ha detectado un acceso no autorizado. Verifique inmediatamente aqui: https://caixa-verificar.top/mov',
      ),
    ).toBeGreaterThanOrEqual(70);
  });
});

describe('amortiguadores — el contexto puede desmentir a la palabra', () => {
  it('reenviar una estafa para preguntar no es cometerla', () => {
    // El falso positivo mas importante del producto: la victima potencial pega
    // el mensaje para pedir ayuda, y NADA la alarma por hacer justo lo correcto.
    const reenvio = score(
      'Me ha llegado esto del banco diciendo que tengo un cargo de 300 euros, tu que crees, es estafa?',
    );
    expect(reenvio).toBeLessThan(40);
  });

  it('una broma marcada como broma no es una amenaza', () => {
    expect(score('Te mato si no traes el pan, jajaja')).toBeLessThan(40);
  });

  it('pero el amortiguador no silencia una amenaza real', () => {
    // Control: mismo insulto que el modismo complice, intencion opuesta.
    expect(score('Cabron, como no me pagues hoy voy a tu casa y te reviento', 'es')).toBeGreaterThanOrEqual(40);
  });

  it('el amortiguador solo retira lo que explica', () => {
    // "jaja" desactiva la amenaza, no el fraude que haya alrededor.
    const conBroma = scanLocalPatterns(
      'jajaja te mato. Oye, envia dinero urgente por bizum a mi cuenta 600 euros',
    );
    expect(conBroma.riskScore).toBeGreaterThanOrEqual(40);
  });
});

describe('region', () => {
  it('una entrada regional no existe fuera de su region', () => {
    const conRegion = scanLocalPatterns('Tio que cabron, cuanto tiempo', { region: 'es' });
    const sinRegion = scanLocalPatterns('Tio que cabron, cuanto tiempo', { region: '*' });
    expect(conRegion.dampened.length).toBeGreaterThan(0);
    expect(sinRegion.dampened).toHaveLength(0);
  });

  it('vocabulario regional legitimo no alarma', () => {
    expect(score('Che, pasame la guita de la juntada cuando puedas', 'ar')).toBeLessThan(70);
    expect(score('Ya conseguiste chamba? Te paso el contacto de mi primo', 'mx')).toBeLessThan(40);
  });
});

describe('huecos de conjugacion encontrados al medir', () => {
  // Lo que se comprueba aqui es que el patron DISPARE, no que cruce el umbral.
  //
  // El lexico esta calibrado a proposito para que ninguna señal aislada llegue
  // a SOSPECHOSO — "una herramienta que grita '¡lobo!' con 'voy a tu casa'
  // enseña a su usuario a ignorarla". Cruzar el umbral es tarea de los COMBOS y
  // del motor de fusion, que exige corroboracion. Exigir aqui >= 40 seria pedir
  // que el lexico se contradiga a si mismo.
  //
  // Antes de estos arreglos estos textos puntuaban CERO, que es cosa distinta:
  // no es que no llegaran al umbral, es que no existian para el detector.
  const dispara = (texto: string) => expect(score(texto), texto).toBeGreaterThan(0);

  it('sextorsion en presente, no solo en futuro', () => {
    // El patron pedia "publicare"/"difundire". La amenaza real se dice en
    // presente porque suena mas inminente, y esa forma puntuaba 0.
    dispara('o publico tus fotos intimas');
    dispara('mando tus videos a tus contactos');
  });

  it('presencia fisica en singular, no solo en plural', () => {
    // El patron tenia "vamos a tu casa" pero no "voy a tu casa" — la forma que
    // usa un agresor que actua solo.
    dispara('voy a tu casa esta noche');
  });

  it('agresion fisica, no solo amenaza de muerte', () => {
    dispara('te parto la cara como te vea');
  });

  it('transferir estaba en el patron portugues pero no en el español', () => {
    dispara('transfiere 5000 a mi cuenta');
  });

  it('y en combinacion si cruzan el umbral', () => {
    // La amenaza sola no alarma; la amenaza con la extorsion detras, si.
    expect(
      score('transfiere 5000 a mi cuenta hoy mismo o publico tus fotos intimas'),
    ).toBeGreaterThanOrEqual(70);
  });

  it('nada de esto dispara con conversacion normal', () => {
    expect(score('publico mis fotos de las vacaciones en el blog')).toBeLessThan(40);
    expect(score('te transfiero lo de la cena cuando pueda')).toBeLessThan(40);
    expect(score('manda las fotos del cumple al grupo')).toBeLessThan(40);
    expect(score('voy a tu casa a cenar el sabado?')).toBeLessThan(70);
  });
});

describe('la capa regex ya no se evade con caracteres invisibles', () => {
  // Deuda que quedo abierta en la Fase 1: normalizeForMatching no quitaba
  // invisibles ni plegaba homoglifos, asi que la capa de patrones conservaba
  // las dos evasiones que ya se habian cerrado en la capa del LLM. Medido: una
  // amenaza de muerte con un espacio de ancho cero puntuaba 0.
  const limpio = 'te voy a matar';

  it('un espacio de ancho cero no esconde la amenaza', () => {
    expect(score('te voy a ma​tar')).toBe(score(limpio));
  });

  it('un homoglifo cirilico tampoco', () => {
    expect(score('te voy а matar')).toBe(score(limpio));
  });
});

describe('el guion completo de la estafa sentimental', () => {
  // Este es el caso de manual —afecto acelerado, excusa de aduana, cantidad
  // concreta, canal irrastreable y aislamiento— y puntuaba 31: SEGURO. La causa
  // no era una sino cuatro grietas de fraseo, cada una pequeña:
  //
  //   - "necesito 800 dolares": pedir dinero no siempre lleva verbo de envio, y
  //     el patron de cantidad exigia un imperativo justo delante.
  //   - "no se lo cuentes a tu familia": el patron pedia "no cuentes" pegado.
  //   - "hoy mismo": la urgencia solo cubria "ahora mismo".
  //   - "problema con la aduana": la aduana solo contaba si se hablaba de pagar
  //     tasas con esas palabras.
  //
  // Ninguna de las cuatro es rara. Todas juntas eran la diferencia entre ver la
  // estafa y no verla.
  const guion =
    'Mi amor, se que apenas nos conocemos pero siento que eres la persona que ' +
    'esperaba. Tengo un problema con la aduana y necesito 800 dolares hoy mismo, ' +
    'mandalos por Western Union. No se lo cuentes a tu familia, no lo entenderian.';

  it('se ve entero', () => {
    expect(score(guion)).toBeGreaterThanOrEqual(70);
  });

  it('y sus piezas sueltas siguen sin alertar', () => {
    // La otra mitad del trato. Si estas frases alertaran, el arreglo de arriba
    // habria salido carisimo.
    expect(score('Mi amor, me mandas 800 dolares?')).toBeLessThan(40);
    expect(score('Necesito 20 euros para el taxi, te los devuelvo el viernes')).toBeLessThan(40);
    expect(score('No se lo cuentes a nadie todavia, quiero darle la sorpresa')).toBeLessThan(40);
    expect(score('Voy hoy mismo al banco y luego paso por tu casa')).toBeLessThan(40);
  });

  it('el diccionario ya no llama sextorsion a decir "a tu familia"', () => {
    // "a tu familia", "en redes", "por whatsapp" dicen a QUIEN, no QUE. Solos
    // son cualquier frase; en la sextorsion van detras de la amenaza. El
    // diccionario etiquetaba "no se lo cuentes a tu familia" de sextorsion por
    // esas tres palabras, y esa etiqueta la lee la persona.
    const r = scanLocalPatterns('No se lo cuentes a tu familia, es entre nosotros');
    expect(r.tactics.join(' ')).not.toMatch(/[Ss]extorsion/);
  });
});
