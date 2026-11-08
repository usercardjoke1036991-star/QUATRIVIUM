// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Groth16Verifier
 * @dev Stub: no acepta pruebas. Reemplazar con el verificador generado por snarkjs.
 */
contract Groth16Verifier {
    function verifyProof(
        uint256[2] calldata _a,
        uint256[2][2] calldata _b,
        uint256[2] calldata _c,
        uint256[] calldata _input
    ) public pure returns (bool) {
        require(_input.length > 0, "input must not be empty");
        require(_a[0] != 0 || _a[1] != 0, "invalid proof A");
        require(_b[0][0] != 0 || _b[0][1] != 0 || _b[1][0] != 0 || _b[1][1] != 0, "invalid proof B");
        require(_c[0] != 0 || _c[1] != 0, "invalid proof C");
        return false;
    }

    function verifyProofWithVK(
        uint256[6] calldata,
        uint256[8] calldata _proof,
        uint256 _publicInput
    ) public pure returns (bool) {
        require(_publicInput != 0, "public input cannot be zero");
        for (uint i = 0; i < 8; i++) {
            require(_proof[i] != 0, "proof cannot contain zero");
        }
        return false;
    }
}
