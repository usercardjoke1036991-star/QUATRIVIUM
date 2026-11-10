// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuatriviumApk
/// @notice Historial del APK. Solo la billetera fundadora publica. No se borra.
///         La huella del certificado de firma es la misma en todas las versiones.
///         Vive aparte de Credit para no gastar el margen EIP-170.
contract QuatriviumApk {
    address public immutable fundador;

    struct Version {
        uint256 versionCode;
        bytes32 hash;
        uint256 fecha;
        bytes32 certificado;
    }

    Version[] private _versiones;
    bytes32 public certificadoFirma;

    error SoloFundador();
    error VersionInvalida();
    error CertificadoDistinto();

    event VersionPublicada(
        uint256 indexed versionCode,
        bytes32 hash,
        bytes32 certificado,
        uint256 fecha
    );

    constructor(address fundador_) {
        if (fundador_ == address(0)) revert SoloFundador();
        fundador = fundador_;
    }

    function publicar(uint256 versionCode, bytes32 hash, bytes32 certificado) external {
        if (msg.sender != fundador) revert SoloFundador();
        if (versionCode == 0 || hash == bytes32(0) || certificado == bytes32(0)) revert VersionInvalida();
        if (certificadoFirma == bytes32(0)) {
            certificadoFirma = certificado;
        } else if (certificado != certificadoFirma) {
            revert CertificadoDistinto();
        }
        _versiones.push(
            Version({
                versionCode: versionCode,
                hash: hash,
                fecha: block.timestamp,
                certificado: certificado
            })
        );
        emit VersionPublicada(versionCode, hash, certificado, block.timestamp);
    }

    function total() external view returns (uint256) {
        return _versiones.length;
    }

    function version(uint256 i)
        external
        view
        returns (uint256 versionCode, bytes32 hash, uint256 fecha, bytes32 certificado)
    {
        Version memory v = _versiones[i];
        return (v.versionCode, v.hash, v.fecha, v.certificado);
    }
}
