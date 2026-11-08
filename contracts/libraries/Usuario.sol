// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Nodo Unilevel. Layout compartido entre el núcleo y el hermano de fama.
struct Usuario {
    address padre;
    bool bonoActivacionCobrado;
}
