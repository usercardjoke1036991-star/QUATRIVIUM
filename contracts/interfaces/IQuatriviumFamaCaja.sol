// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IQuatriviumFamaCaja {
    function acreditar(address who, uint256 pts) external;
    function acreditarFamaRed(address deudor) external;
    function wipe(address who) external;
    function onCierrePrestamo(address deudor, address padre) external;
}
