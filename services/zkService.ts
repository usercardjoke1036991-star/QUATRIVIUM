/**
 * Zero-Knowledge Proof Service
 * Implementación real de generación y verificación de pruebas ZK para validación de identidad
 *
 * Este servicio utiliza:
 * - expo-crypto para generación criptográfica segura de identidad
 * - snarkjs para generación y verificación de pruebas ZK Groth16
 * - circomlibjs para operaciones criptográficas ZK
 */

import * as Crypto from 'expo-crypto';
import { ZKTypeValidator, FieldElement } from '../types/zkTypes';

// Importaciones condicionales para snarkjs y circomlibjs
// Estas librerías se cargan dinámicamente para evitar errores de carga en React Native
let snarkjs: any = null;
let circomlibjs: any = null;

// Tipos para las pruebas ZK
export interface ZKProof {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
  publicSignals: string[];
}

export interface ZKIdentity {
  nullifier: string;
  trapdoor: string;
  secret: string;
}

export interface ZKVerificationResult {
  isValid: boolean;
  error?: string;
  proofHash?: string;
}

/**
 * Configuración de seguridad ZK
 */
const ZK_SECURITY_CONFIG = {
  // Tamaño de la identidad en bytes
  IDENTITY_SIZE_BYTES: 32,
  // Tamaño del nullifier en bytes
  NULLIFIER_SIZE_BYTES: 32,
  // Tamaño del trapdoor en bytes
  TRAPDOOR_SIZE_BYTES: 32,
  // Timeout para operaciones ZK (ms)
  ZK_OPERATION_TIMEOUT: 30000,
  // Máximo de reintentos para operaciones ZK
  MAX_ZK_RETRIES: 3,
} as const;

/**
 * Logger condicional para operaciones ZK
 */
const logError = __DEV__ ? console.error : () => {};
const logWarn = __DEV__ ? console.warn : () => {};
const logInfo = __DEV__ ? console.log : () => {};

/**
 * Carga dinámica de librerías ZK para evitar errores de carga
 */
async function loadZKLibraries(): Promise<void> {
  if (snarkjs && circomlibjs) {
    return; // Ya cargadas
  }

  try {
    // Importación dinámica de snarkjs
    if (!snarkjs) {
      snarkjs = await import('snarkjs');
      logInfo('✅ snarkjs cargado exitosamente');
    }

    // Importación dinámica de circomlibjs
    if (!circomlibjs) {
      circomlibjs = await import('circomlibjs');
      logInfo('✅ circomlibjs cargado exitosamente');
    }
  } catch (error) {
    logError('❌ Error cargando librerías ZK:', error);
    throw new Error(
      `Error loading ZK libraries: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Convierte bytes a string hexadecimal
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convierte string hexadecimal a bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convierte un bigint a string hexadecimal con padding
 */
function _bigintToHex(value: bigint, padding: number = 64): string {
  const hex = value.toString(16).padStart(padding, '0');
  return `0x${hex}`;
}

function _hexToBigint(hex: string): bigint {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + cleanHex);
}

void _bigintToHex;
void _hexToBigint;

/**
 * Genera un número aleatorio criptográficamente seguro usando expo-crypto
 */
async function generateSecureRandomBytes(size: number): Promise<Uint8Array> {
  try {
    const randomBytes = await Crypto.getRandomBytesAsync(size);
    return randomBytes;
  } catch (error) {
    logError('Error generando bytes aleatorios seguros:', error);
    throw new Error(
      `Error generating secure random bytes: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Deriva un nullifier desde la identidad usando un algoritmo criptográfico
 */
async function deriveNullifier(identity: ZKIdentity): Promise<string> {
  try {
    // Combinar identidad components
    const combined = identity.trapdoor + identity.secret;
    const combinedBytes = hexToBytes(combined);

    // Usar SHA-256 para derivar nullifier
    const hashBuffer = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new Uint8Array(combinedBytes) as BufferSource
    );

    const nullifierHex = bytesToHex(new Uint8Array(hashBuffer));
    return `0x${nullifierHex}`;
  } catch (error) {
    logError('Error derivando nullifier:', error);
    throw new Error(
      `Error deriving nullifier: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Servicios de prueba ZK - Implementación real con criptografía segura
 */
export class ZKService {
  /**
   * Genera una identidad ZK criptográficamente segura usando expo-crypto
   *
   * Esta implementación usa:
   * - expo-crypto.getRandomBytesAsync para entropía criptográfica real
   * - Derivación criptográfica para el nullifier
   * - Validación de tipos seguros
   */
  static async generateIdentity(): Promise<ZKIdentity> {
    try {
      // Generar trapdoor aleatorio criptográficamente seguro
      const trapdoorBytes = await generateSecureRandomBytes(ZK_SECURITY_CONFIG.TRAPDOOR_SIZE_BYTES);
      const trapdoor = `0x${bytesToHex(trapdoorBytes)}`;

      // Generar secret aleatorio criptográficamente seguro
      const secretBytes = await generateSecureRandomBytes(ZK_SECURITY_CONFIG.IDENTITY_SIZE_BYTES);
      const secret = `0x${bytesToHex(secretBytes)}`;

      // Crear identidad temporal
      const tempIdentity: ZKIdentity = {
        trapdoor,
        secret,
        nullifier: '', // Se derivará después
      };

      // Derivar nullifier criptográficamente
      const nullifier = await deriveNullifier(tempIdentity);

      const identity: ZKIdentity = {
        nullifier,
        trapdoor,
        secret,
      };

      // Validar identidad con tipos seguros
      if (!ZKTypeValidator.validateIdentity(identity)) {
        throw new Error('Generated invalid ZK identity');
      }

      logInfo('✅ Identidad ZK generada criptográficamente');
      return identity;
    } catch (error) {
      logError('Error generando identidad ZK:', error);
      throw new Error(
        `Error generating ZK identity: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Genera una prueba ZK real usando snarkjs y circuitos Circom
   *
   * Esta implementación:
   * - Carga dinámicamente snarkjs para evitar errores de carga
   * - Usa archivos .wasm y .zkey reales para generar pruebas
   * - Implementa reintentos y timeouts robustos
   * - Valida el formato de la prueba generada
   */
  static async generateIdentityProof(
    identity: ZKIdentity,
    wasmPath: string,
    zkeyPath: string
  ): Promise<ZKProof> {
    try {
      // Validar identidad
      if (!ZKTypeValidator.validateIdentity(identity)) {
        throw new Error('Invalid ZK identity format');
      }

      // Cargar librerías ZK dinámicamente
      await loadZKLibraries();

      // Verificar que las rutas de los archivos existan
      if (!wasmPath || !zkeyPath) {
        throw new Error('Circuit file paths are required for ZK proof generation');
      }

      logInfo('🔄 Generando prueba ZK con circuitos reales...');

      // Preparar input para el circuito
      const circuitInput = {
        nullifier: identity.nullifier,
        trapdoor: identity.trapdoor,
        secret: identity.secret,
      };

      // Implementar generación de prueba con reintentos
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= ZK_SECURITY_CONFIG.MAX_ZK_RETRIES; attempt++) {
        try {
          logInfo(
            `🔄 Intento ${attempt}/${ZK_SECURITY_CONFIG.MAX_ZK_RETRIES} para generar prueba ZK`
          );

          // Generar prueba usando snarkjs
          const { proof, publicSignals } = await Promise.race([
            snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('ZK proof generation timeout')),
                ZK_SECURITY_CONFIG.ZK_OPERATION_TIMEOUT
              )
            ),
          ]);

          // Convertir prueba al formato esperado
          const zkProof: ZKProof = {
            pi_a: [proof.pi_a[0].toString(), proof.pi_a[1].toString()] as [string, string],
            pi_b: [
              [proof.pi_b[0][0].toString(), proof.pi_b[0][1].toString()],
              [proof.pi_b[1][0].toString(), proof.pi_b[1][1].toString()],
            ] as [[string, string], [string, string]],
            pi_c: [proof.pi_c[0].toString(), proof.pi_c[1].toString()] as [string, string],
            publicSignals: publicSignals.map((signal: any) => signal.toString()),
          };

          // Validar formato de la prueba
          if (!ZKTypeValidator.validateProof(zkProof)) {
            throw new Error('Generated invalid proof format');
          }

          logInfo('✅ Prueba ZK generada exitosamente');
          return zkProof;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unknown error');
          logWarn(`⚠️ Intento ${attempt} falló: ${lastError.message}`);

          if (attempt < ZK_SECURITY_CONFIG.MAX_ZK_RETRIES) {
            // Esperar antes de reintentar (exponential backoff)
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      throw new Error(
        `Failed to generate ZK proof after ${ZK_SECURITY_CONFIG.MAX_ZK_RETRIES} attempts: ${lastError?.message}`
      );
    } catch (error) {
      logError('Error generando prueba ZK:', error);
      throw new Error(
        `Error generating ZK proof: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Verifica una prueba ZK usando snarkjs
   *
   * Esta implementación:
   * - Carga dinámicamente snarkjs
   * - Usa la verification key real para verificar pruebas
   * - Implementa validación robusta del formato
   */
  static async verifyProof(proof: ZKProof, verificationKey: any): Promise<ZKVerificationResult> {
    try {
      // Validar formato de la prueba
      if (!ZKTypeValidator.validateProof(proof)) {
        return {
          isValid: false,
          error: 'Invalid proof format',
        };
      }

      // Cargar librerías ZK dinámicamente
      await loadZKLibraries();

      // Verificar que se proporcionó la verification key
      if (!verificationKey) {
        return {
          isValid: false,
          error: 'Verification key is required for ZK proof verification',
        };
      }

      logInfo('🔄 Verificando prueba ZK...');

      // Generar hash de la prueba para logging seguro
      const proofHash = ZKTypeValidator.generateProofHash(ZKTypeValidator.toTypedProof(proof));

      // Convertir prueba al formato esperado por snarkjs
      const snarkjsProof = {
        pi_a: proof.pi_a.map((val) => BigInt(val)),
        pi_b: proof.pi_b.map((row) => row.map((val) => BigInt(val))),
        pi_c: proof.pi_c.map((val) => BigInt(val)),
        protocol: 'groth16',
        curve: 'bn128',
      };

      const publicSignals = proof.publicSignals.map((signal) => BigInt(signal));

      // Verificar prueba usando snarkjs
      const isValid = await snarkjs.groth16.verify(verificationKey, publicSignals, snarkjsProof);

      if (isValid) {
        logInfo('✅ Prueba ZK verificada exitosamente');
        return {
          isValid: true,
          proofHash,
        };
      } else {
        logWarn('⚠️ Prueba ZK inválida');
        return {
          isValid: false,
          error: 'Invalid ZK proof',
          proofHash,
        };
      }
    } catch (error) {
      logError('Error verificando prueba ZK:', error);
      return {
        isValid: false,
        error: `Error verifying ZK proof: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Serializa una prueba ZK para enviar al contrato inteligente
   *
   * Convierte el formato interno al formato esperado por el contrato
   */
  static serializeProofForContract(proof: ZKProof): {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
    input: string[];
  } {
    return {
      a: proof.pi_a,
      b: proof.pi_b,
      c: proof.pi_c,
      input: proof.publicSignals,
    };
  }

  /**
   * Valida que los datos ZK estén correctamente formateados
   *
   * Usa el validador de tipos seguros para garantizar integridad
   */
  static validateProofFormat(proof: any): ZKVerificationResult {
    try {
      const validation = ZKTypeValidator.validateProof(proof);

      if (!validation) {
        return {
          isValid: false,
          error: 'Formato de prueba inválido según tipos seguros',
        };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: `Error validando formato: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Sanitiza datos sensibles para logging seguro
   * 
   Muestra solo prefijo y sufijo para evitar exposición de datos
   */
  static sanitizeForLogging(value: string): string {
    return ZKTypeValidator.sanitizeForLogging(value as FieldElement);
  }

  /**
   * Carga la verification key desde un archivo JSON
   *
   * Esta función carga la verification key necesaria para verificar pruebas ZK
   */
  static async loadVerificationKey(_verificationKeyPath: string): Promise<any> {
    throw new Error('No hay circuitos ZK empaquetados. Esta función requiere wasm/zkey reales.');
  }

  static async generateIdentityHash(identity: ZKIdentity): Promise<string> {
    try {
      const combinedBytes = new Uint8Array([
        ...hexToBytes(identity.nullifier),
        ...hexToBytes(identity.trapdoor),
        ...hexToBytes(identity.secret),
      ]);

      const hashBuffer = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        new Uint8Array(combinedBytes) as BufferSource
      );

      return `0x${bytesToHex(new Uint8Array(hashBuffer))}`;
    } catch (error) {
      logError('Error generando hash de identidad:', error);
      throw new Error(
        `Error generating identity hash: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Valida que una identidad ZK sea consistente
   *
   * Verifica que el nullifier derive correctamente de trapdoor y secret
   */
  static async validateIdentityConsistency(identity: ZKIdentity): Promise<boolean> {
    try {
      if (!ZKTypeValidator.validateIdentity(identity)) {
        return false;
      }

      const derivedNullifier = await deriveNullifier(identity);
      return derivedNullifier.toLowerCase() === identity.nullifier.toLowerCase();
    } catch (error) {
      logError('Error validando consistencia de identidad:', error);
      return false;
    }
  }
}

/**
 * Paths predeterminados para archivos de circuito ZK
 *
 * Estos paths deben apuntar a los archivos reales de circuito generados
 */
export const ZK_CIRCUIT_PATHS = {
  identityWasm: '/assets/circuits/identity.wasm',
  identityZkey: '/assets/circuits/identity_final.zkey',
  identityVerificationKey: '/assets/circuits/verification_key.json',
} as const;

/**
 * Estado del servicio ZK para monitoreo
 */
export class ZKServiceStatus {
  static isReady: boolean = false;
  static lastError: string | null = null;
  static libraryVersions: { snarkjs?: string; circomlibjs?: string } = {};

  static async initialize(): Promise<void> {
    try {
      await loadZKLibraries();

      if (snarkjs) {
        this.libraryVersions.snarkjs = snarkjs.version || 'unknown';
      }

      if (circomlibjs) {
        this.libraryVersions.circomlibjs = 'unknown'; // circomlibjs no expone versión fácilmente
      }

      this.isReady = true;
      this.lastError = null;
      logInfo('✅ ZK Service inicializado exitosamente');
    } catch (error) {
      this.isReady = false;
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logError('❌ Error inicializando ZK Service:', this.lastError);
      throw error;
    }
  }

  static getStatus(): {
    isReady: boolean;
    lastError: string | null;
    libraryVersions: typeof ZKServiceStatus.libraryVersions;
  } {
    return {
      isReady: this.isReady,
      lastError: this.lastError,
      libraryVersions: this.libraryVersions,
    };
  }
}
