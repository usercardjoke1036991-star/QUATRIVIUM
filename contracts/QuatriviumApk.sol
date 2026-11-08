// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuatriviumApk
/// @notice Historial del hash SHA-256 del APK. Solo la billetera fundadora publica.
///         Vive aparte de Credit para no gastar el margen EIP-170.
contract QuatriviumApk {
    address public immutable fundador;

    struct Version {
        uint256 versionCode;
        bytes32 hash;
        uint256 fecha;
    }

    Version[] private _versiones;

    error SoloFundador();
    error VersionInvalida();

    event VersionPublicada(uint256 indexed versionCode, bytes32 hash, uint256 fecha);

    constructor(address fundador_) {
        if (fundador_ == address(0)) revert SoloFundador();
        fundador = fundador_;
    }

    function publicar(uint256 versionCode, bytes32 hash) external {
        if (msg.sender != fundador) revert SoloFundador();
        if (versionCode == 0 || hash == bytes32(0)) revert VersionInvalida();
        _versiones.push(Version({ versionCode: versionCode, hash: hash, fecha: block.timestamp }));
        emit VersionPublicada(versionCode, hash, block.timestamp);
    }

    function total() external view returns (uint256) {
        return _versiones.length;
    }

    function version(uint256 i) external view returns (uint256 versionCode, bytes32 hash, uint256 fecha) {
        Version memory v = _versiones[i];
        return (v.versionCode, v.hash, v.fecha);
    }
}
