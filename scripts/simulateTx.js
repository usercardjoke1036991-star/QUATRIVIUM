const { Interface } = require('ethers');

const CONTRACT_ABI = [
  'function depositarLiquidez(address token, uint256 _monto)',
  'function registrarHumanoConPadre(address _padre)',
];

const iface = new Interface(CONTRACT_ABI);
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const depositData = iface.encodeFunctionData('depositarLiquidez', [usdt, '1000000000000000000']);
const regData = iface.encodeFunctionData('registrarHumanoConPadre', [
  '0x0000000000000000000000000000000000000000',
]);

console.log(
  'Deposit payload:',
  JSON.stringify(
    { to: process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET, data: depositData, value: '0x0' },
    null,
    2
  )
);
console.log(
  'Registrar payload:',
  JSON.stringify(
    { to: process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET, data: regData, value: '0x0' },
    null,
    2
  )
);
