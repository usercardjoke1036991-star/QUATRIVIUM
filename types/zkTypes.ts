/**
 * Tipos seguros para datos Zero-Knowledge
 * Estos tipos aseguran que los datos sensibles estén correctamente tipados
 */

/**
 * Representación segura de valores de campo en circuitos ZK
 * Los valores deben ser strings hexadecimales válidos de 256 bits
 */
export type FieldElement = string & {
  readonly __brand: 'FieldElement';
};

/**
 * Función de tipo para validar que un string es un field element válido
 */
export function asFieldElement(value: string): FieldElement {
  if (!/^0x[0-9a-fA-F]{0,64}$/.test(value)) {
    throw new Error(`Invalid field element: ${value}`);
  }
  return value as FieldElement;
}

/**
 * Prueba ZK con tipos seguros
 */
export interface TypedZKProof {
  readonly pi_a: readonly [FieldElement, FieldElement];
  readonly pi_b: readonly [
    readonly [FieldElement, FieldElement],
    readonly [FieldElement, FieldElement],
  ];
  readonly pi_c: readonly [FieldElement, FieldElement];
  readonly publicSignals: readonly FieldElement[];
}

/**
 * Identidad ZK con tipos seguros
 */
export interface TypedZKIdentity {
  readonly nullifier: FieldElement;
  readonly trapdoor: FieldElement;
  readonly secret: FieldElement;
}

/**
 * Parámetros de entrada para circuitos ZK
 */
export interface ZKInputParameters {
  readonly userId: FieldElement;
  readonly timestamp: FieldElement;
  readonly challenge: FieldElement;
}

/**
 * Resultado de verificación ZK con tipos seguros
 */
export interface TypedZKVerificationResult {
  readonly isValid: boolean;
  readonly error?: string;
  readonly proofHash?: string;
}

/**
 * Utilidades para validación de tipos ZK
 */
export class ZKTypeValidator {
  /**
   * Valida que un valor sea un field element válido
   */
  static validateFieldElement(value: string): boolean {
    return /^0x[0-9a-fA-F]{0,64}$/.test(value);
  }

  /**
   * Valida una prueba ZK completa
   */
  static validateProof(proof: any): proof is TypedZKProof {
    if (!proof || typeof proof !== 'object') {
      return false;
    }

    const { pi_a, pi_b, pi_c, publicSignals } = proof;

    if (!Array.isArray(pi_a) || pi_a.length !== 2) return false;
    if (!Array.isArray(pi_b) || pi_b.length !== 2) return false;
    if (!Array.isArray(pi_c) || pi_c.length !== 2) return false;
    if (!Array.isArray(publicSignals)) return false;

    // Validar cada elemento
    const allValid = [...pi_a, ...pi_b.flat(), ...pi_c, ...publicSignals].every(
      this.validateFieldElement
    );

    return allValid;
  }

  /**
   * Convierte una prueba genérica a una prueba tipada
   */
  static toTypedProof(proof: any): TypedZKProof {
    if (!this.validateProof(proof)) {
      throw new Error('Invalid proof format');
    }

    return {
      pi_a: proof.pi_a.map(asFieldElement) as [FieldElement, FieldElement],
      pi_b: [
        proof.pi_b[0].map(asFieldElement) as [FieldElement, FieldElement],
        proof.pi_b[1].map(asFieldElement) as [FieldElement, FieldElement],
      ],
      pi_c: proof.pi_c.map(asFieldElement) as [FieldElement, FieldElement],
      publicSignals: proof.publicSignals.map(asFieldElement),
    };
  }

  /**
   * Valida una identidad ZK
   */
  static validateIdentity(identity: any): identity is TypedZKIdentity {
    if (!identity || typeof identity !== 'object') {
      return false;
    }

    const { nullifier, trapdoor, secret } = identity;

    return (
      this.validateFieldElement(nullifier) &&
      this.validateFieldElement(trapdoor) &&
      this.validateFieldElement(secret)
    );
  }

  /**
   * Convierte una identidad genérica a una identidad tipada
   */
  static toTypedIdentity(identity: any): TypedZKIdentity {
    if (!this.validateIdentity(identity)) {
      throw new Error('Invalid identity format');
    }

    return {
      nullifier: asFieldElement(identity.nullifier),
      trapdoor: asFieldElement(identity.trapdoor),
      secret: asFieldElement(identity.secret),
    };
  }

  /**
   * Sanitiza datos sensibles para logging (muestra solo prefijo)
   */
  static sanitizeForLogging(value: FieldElement): string {
    return `${value.substring(0, 10)}...${value.substring(value.length - 4)}`;
  }

  /**
   * Genera hash de una prueba para verificación sin exponer datos
   */
  static generateProofHash(proof: TypedZKProof): string {
    const combined = [
      ...proof.pi_a,
      ...proof.pi_b.flat(),
      ...proof.pi_c,
      ...proof.publicSignals,
    ].join('');
    // En producción, usar un hash criptográfico real
    return `0x${combined.substring(0, 32)}`;
  }
}

/**
 * Constantes de seguridad para datos ZK
 */
export const ZK_SECURITY_CONSTANTS = {
  MAX_FIELD_ELEMENT_LENGTH: 64, // caracteres hex
  MIN_FIELD_ELEMENT_LENGTH: 2, // "0x" mínimo
  ALLOWED_HASH_ALGORITHMS: ['sha256', 'keccak256'],
  MAX_PUBLIC_SIGNALS: 10,
  MIN_PUBLIC_SIGNALS: 1,
} as const;
